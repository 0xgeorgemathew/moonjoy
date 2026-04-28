/**
 * Onboard Route — POST /api/auth/onboard
 *
 * Links a Privy user's wallets to their Moonjoy user and agent records.
 * The client calls this after Privy signup with:
 *   - embeddedSignerAddress: the user's embedded EOA (Privy embedded wallet)
 *   - smartAccountAddress: the agent's smart account (Privy smart wallet)
 *
 * Both addresses are optional — the client may call incrementally as wallets
 * are created. All addresses are verified against the authenticated user's
 * Privy linked accounts before being stored.
 */
import { NextResponse } from "next/server";
import { getAuthenticatedUserId, AuthError } from "@/lib/auth/server";
import { getPrivyServerClient } from "@/lib/auth/privy-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEvmAddress } from "@/lib/services/agent-wallet-service";
import type { AuthUser, Agent } from "@/lib/types/auth";
import type { LinkedAccount } from "@privy-io/node";

// ---------------------------------------------------------------------------
// Privy linked-account type guards
// ---------------------------------------------------------------------------

/** Narrow a LinkedAccount to ones that carry an `address` string field. */
function hasAddress(
	account: LinkedAccount,
): account is LinkedAccount & { address: string } {
	return (
		"address" in account &&
		typeof (account as { address?: unknown }).address === "string"
	);
}

/** True for Privy embedded wallets (the user's EOA signer). */
function isEmbeddedWallet(account: LinkedAccount): boolean {
	return (
		account.type === "wallet" &&
		"wallet_client_type" in account &&
		(account as { wallet_client_type?: string }).wallet_client_type ===
			"privy" &&
		"chain_type" in account &&
		(account as { chain_type?: string }).chain_type === "ethereum"
	);
}

/** True for Privy smart wallets (the agent's smart account). */
function isSmartWallet(account: LinkedAccount): boolean {
	return account.type === "smart_wallet";
}

// ---------------------------------------------------------------------------
// Address ownership verification
// ---------------------------------------------------------------------------

/**
 * Fetch the user's linked accounts from Privy and confirm that `address`
 * belongs to one of their accounts matching `predicate`.
 */
async function verifyAddressBelongsToUser(
	privyUserId: string,
	address: string,
	predicate: (account: LinkedAccount) => boolean,
): Promise<boolean> {
	const privy = getPrivyServerClient();
	const privyUser = await privy.users()._get(privyUserId);
	const matchingAddresses = privyUser.linked_accounts
		.filter(predicate)
		.filter(hasAddress)
		.map((a) => a.address.toLowerCase());
	return matchingAddresses.includes(address.toLowerCase());
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
	// 1. Authenticate the request via Privy
	let privyUserId: string;
	try {
		privyUserId = await getAuthenticatedUserId(request);
	} catch (err) {
		const status = err instanceof AuthError ? err.statusCode : 401;
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Unauthorized" },
			{ status },
		);
	}

	// 2. Parse and validate the request body
	let body: {
		embeddedSignerAddress?: string;
		smartAccountAddress?: string;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	// Validate EVM address format for each provided field
	if (body.embeddedSignerAddress && !isEvmAddress(body.embeddedSignerAddress)) {
		return NextResponse.json(
			{ error: "Invalid embedded signer address" },
			{ status: 400 },
		);
	}

	if (body.smartAccountAddress && !isEvmAddress(body.smartAccountAddress)) {
		return NextResponse.json(
			{ error: "Invalid smart account address" },
			{ status: 400 },
		);
	}

	// 3. Verify that each address actually belongs to this Privy user
	if (body.embeddedSignerAddress) {
		try {
			const verified = await verifyAddressBelongsToUser(
				privyUserId,
				body.embeddedSignerAddress,
				isEmbeddedWallet,
			);
			if (!verified) {
				return NextResponse.json(
					{ error: "Embedded signer address does not belong to this user" },
					{ status: 403 },
				);
			}
		} catch {
			return NextResponse.json(
				{ error: "Failed to verify wallet ownership" },
				{ status: 500 },
			);
		}
	}

	if (body.smartAccountAddress) {
		try {
			const verified = await verifyAddressBelongsToUser(
				privyUserId,
				body.smartAccountAddress,
				isSmartWallet,
			);
			if (!verified) {
				return NextResponse.json(
					{ error: "Smart account address does not belong to this user" },
					{ status: 403 },
				);
			}
		} catch {
			return NextResponse.json(
				{ error: "Failed to verify smart account ownership" },
				{ status: 500 },
			);
		}
	}

	// 4. Upsert the user record
	const supabase = createAdminClient();

	const { data: user, error: userError } = await supabase
		.from("users")
		.upsert(
			{
				privy_user_id: privyUserId,
				embedded_signer_address: body.embeddedSignerAddress || null,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "privy_user_id", ignoreDuplicates: false },
		)
		.select()
		.single();

	// Handle unique-constraint race: another request may have inserted first.
	// Fall back to fetching the existing row by privy_user_id.
	if (userError || !user) {
		if (userError?.code === "23505") {
			const { data: existing, error: fetchErr } = await supabase
				.from("users")
				.select("*")
				.eq("privy_user_id", privyUserId)
				.single();
			if (fetchErr || !existing) {
				return NextResponse.json(
					{ error: "Failed to resolve user after conflict" },
					{ status: 500 },
				);
			}
			const agentResult = await upsertAgent(
				supabase,
				existing,
				body.smartAccountAddress,
			);
			return NextResponse.json(agentResult.json, {
				status: agentResult.status,
			});
		}
		return NextResponse.json(
			{ error: "Failed to create or fetch user" },
			{ status: 500 },
		);
	}

	// 5. Upsert the agent record for this user
	const agentResult = await upsertAgent(
		supabase,
		user,
		body.smartAccountAddress,
	);
	return NextResponse.json(agentResult.json, { status: agentResult.status });
}

// ---------------------------------------------------------------------------
// Agent upsert helpers
// ---------------------------------------------------------------------------

/** Shaped result returned by agent upsert operations. */
type AgentResult = {
	status: number;
	json: { error?: string; user: AuthUser; agent: Agent | null };
};

function agentOk(user: AuthUser, agent: Agent): AgentResult {
	return { status: 200, json: { user, agent } };
}

function agentErr(
	user: AuthUser,
	message: string,
	statusCode: number,
	agent: Agent | null = null,
): AgentResult {
	return { status: statusCode, json: { error: message, user, agent } };
}

/**
 * Ensure the user has exactly one active agent row.
 *
 * - If an active agent exists, optionally update its smart account address.
 *   Rejects if the address conflicts with the stored one.
 * - If no active agent exists, creates one.
 * - Handles the insert race (unique constraint violation) by fetching the
 *   concurrent winner.
 */
async function upsertAgent(
	supab: ReturnType<typeof createAdminClient>,
	user: AuthUser,
	smartAccountAddress: string | undefined,
): Promise<AgentResult> {
	// Look for an existing active agent for this user
	const { data: existingAgent } = await supab
		.from("agents")
		.select("*")
		.eq("user_id", user.id)
		.eq("status", "active")
		.maybeSingle();

	if (existingAgent) {
		// Reject if the provided address differs from what's already stored
		if (
			smartAccountAddress &&
			existingAgent.smart_account_address &&
			smartAccountAddress.toLowerCase() !==
				existingAgent.smart_account_address.toLowerCase()
		) {
			return {
				status: 409,
				json: {
					error: "Smart account address mismatch",
					user,
					agent: existingAgent as Agent,
				},
			};
		}

		// Patch in the smart account address if the agent doesn't have one yet
		const updates: Record<string, string> = {
			updated_at: new Date().toISOString(),
		};
		if (smartAccountAddress && !existingAgent.smart_account_address) {
			updates.smart_account_address = smartAccountAddress;
			updates.setup_status = "wallet_created";
		}

		const { data: updated, error: updateError } = await supab
			.from("agents")
			.update(updates)
			.eq("id", existingAgent.id)
			.select()
			.single();

		if (updateError || !updated) {
			return agentErr(
				user,
				"Failed to update agent",
				500,
				existingAgent as Agent,
			);
		}
		return agentOk(user, updated as Agent);
	}

	// No active agent — create one
	const { data: inserted, error: insertError } = await supab
		.from("agents")
		.insert({
			user_id: user.id,
			smart_account_address: smartAccountAddress || null,
			setup_status: smartAccountAddress ? "wallet_created" : "incomplete",
		})
		.select()
		.single();

	if (insertError) {
		// Handle race: another request may have inserted between our select and insert
		if (insertError.code === "23505") {
			const { data: raced } = await supab
				.from("agents")
				.select("*")
				.eq("user_id", user.id)
				.eq("status", "active")
				.maybeSingle();
			if (raced) return { status: 200, json: { user, agent: raced as Agent } };
		}
		return {
			status: 500,
			json: { error: "Failed to create agent", user, agent: null },
		};
	}

	return agentOk(user, inserted as Agent);
}
