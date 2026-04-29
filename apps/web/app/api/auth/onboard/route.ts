import { NextResponse } from "next/server";
import { getAuthenticatedUserId, AuthError } from "@/lib/auth/server";
import { getPrivyServerClient } from "@/lib/auth/privy-server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthUser, Agent } from "@/lib/types/auth";
import type { LinkedAccount } from "@privy-io/node";
import { isAddress } from "viem";

function hasAddress(
  account: LinkedAccount,
): account is LinkedAccount & { address: string } {
  return (
    "address" in account &&
    typeof (account as { address?: unknown }).address === "string"
  );
}

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

function isSmartWallet(account: LinkedAccount): boolean {
  return account.type === "smart_wallet";
}

function includesAddress(
  linkedAccounts: LinkedAccount[],
  address: string,
  predicate: (account: LinkedAccount) => boolean,
): boolean {
  const normalizedAddress = address.toLowerCase();

  return linkedAccounts
    .filter(predicate)
    .filter(hasAddress)
    .some((account) => account.address.toLowerCase() === normalizedAddress);
}

function invalidAddressResponse(label: string) {
  return NextResponse.json(
    { error: `Invalid ${label} address` },
    { status: 400 },
  );
}

export async function POST(request: Request) {
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

  let body: {
    embeddedSignerAddress?: string;
    smartAccountAddress?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.embeddedSignerAddress && !isAddress(body.embeddedSignerAddress)) {
    return invalidAddressResponse("embedded signer");
  }

  if (body.smartAccountAddress && !isAddress(body.smartAccountAddress)) {
    return invalidAddressResponse("smart account");
  }

  let linkedAccounts: LinkedAccount[];
  try {
    const privyUser = await getPrivyServerClient().users()._get(privyUserId);
    linkedAccounts = privyUser.linked_accounts;
  } catch {
    return NextResponse.json(
      { error: "Failed to verify wallet ownership" },
      { status: 500 },
    );
  }

  if (
    body.embeddedSignerAddress &&
    !includesAddress(linkedAccounts, body.embeddedSignerAddress, isEmbeddedWallet)
  ) {
    return NextResponse.json(
      { error: "Embedded signer address does not belong to this user" },
      { status: 403 },
    );
  }

  if (
    body.smartAccountAddress &&
    !includesAddress(linkedAccounts, body.smartAccountAddress, isSmartWallet)
  ) {
    return NextResponse.json(
      { error: "Smart account address does not belong to this user" },
      { status: 403 },
    );
  }

  const supabase = createAdminClient();
  const updatedAt = new Date().toISOString();
  const userUpsert: {
    privy_user_id: string;
    embedded_signer_address?: string;
    updated_at: string;
  } = {
    privy_user_id: privyUserId,
    updated_at: updatedAt,
  };

  if (body.embeddedSignerAddress) {
    userUpsert.embedded_signer_address = body.embeddedSignerAddress;
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .upsert(userUpsert, { onConflict: "privy_user_id", ignoreDuplicates: false })
    .select()
    .single();

  if (userError || !user) {
    if (userError?.code !== "23505") {
      return NextResponse.json(
        { error: "Failed to create or fetch user" },
        { status: 500 },
      );
    }

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
    return NextResponse.json(agentResult.json, { status: agentResult.status });
  }

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
  const { data: existingAgent } = await supab
    .from("agents")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (existingAgent) {
    if (
      smartAccountAddress &&
      existingAgent.smart_account_address &&
      smartAccountAddress.toLowerCase() !==
        existingAgent.smart_account_address.toLowerCase()
    ) {
      return agentErr(
        user,
        "Smart account address mismatch",
        409,
        existingAgent as Agent,
      );
    }

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
      return agentErr(user, "Failed to update agent", 500, existingAgent as Agent);
    }

    return agentOk(user, updated as Agent);
  }

  const { data: inserted, error: insertError } = await supab
    .from("agents")
    .insert({
      user_id: user.id,
      smart_account_address: smartAccountAddress ?? null,
      setup_status: smartAccountAddress ? "wallet_created" : "incomplete",
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced } = await supab
        .from("agents")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      if (raced) {
        return agentOk(user, raced as Agent);
      }
    }

    return agentErr(user, "Failed to create agent", 500);
  }

  return agentOk(user, inserted as Agent);
}
