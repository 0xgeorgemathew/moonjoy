import { NextResponse } from "next/server";
import { getAuthenticatedUserId, AuthError } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getEnsPublicClient,
  resolveAddress,
  validateEnsLabel,
} from "@/lib/services/ens-service";
import { DURIN_L2_REGISTRAR_ADDRESS, durinRegistrarAbi } from "@moonjoy/contracts";
import type { Address } from "viem";
import { decodeFunctionData } from "viem";

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

  let body: { label?: string; transactionHash?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { label, transactionHash } = body;

  if (!label || typeof label !== "string") {
    return NextResponse.json(
      { error: "Label is required" },
      { status: 400 },
    );
  }

  if (!transactionHash || typeof transactionHash !== "string") {
    return NextResponse.json(
      { error: "Transaction hash is required" },
      { status: 400 },
    );
  }

  const validation = validateEnsLabel(label);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: user } = await supabase
    .from("users")
    .select("id, embedded_signer_address")
    .eq("privy_user_id", privyUserId)
    .single();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (!user.embedded_signer_address) {
    return NextResponse.json(
      { error: "Embedded signer address is required before claiming ENS" },
      { status: 409 },
    );
  }

  try {
    const publicClient = getEnsPublicClient();

    const receipt = await publicClient.getTransactionReceipt({
      hash: transactionHash as `0x${string}`,
    });

    if (receipt.status !== "success") {
      return NextResponse.json(
        { error: "Transaction reverted onchain" },
        { status: 400 },
      );
    }

    const tx = await publicClient.getTransaction({
      hash: transactionHash as `0x${string}`,
    });

    if (tx.to?.toLowerCase() !== DURIN_L2_REGISTRAR_ADDRESS.toLowerCase()) {
      return NextResponse.json(
        { error: "Transaction target is not the Durin L2 Registrar" },
        { status: 400 },
      );
    }

    let functionName: string;
    let args: readonly unknown[];
    try {
      const decoded = decodeFunctionData({
        abi: durinRegistrarAbi,
        data: tx.input,
      });
      functionName = decoded.functionName;
      args = decoded.args ?? [];
    } catch {
      return NextResponse.json(
        { error: "Could not decode transaction calldata as registerUser()" },
        { status: 400 },
      );
    }

    if (functionName !== "registerUser") {
      return NextResponse.json(
        { error: "Transaction is not a registerUser() call" },
        { status: 400 },
      );
    }

    const [txLabel] = args as [string, string];
    const [, , txAgentBootstrapWallet] = args as [string, string, Address];

    if (txLabel.toLowerCase() !== label.toLowerCase()) {
      return NextResponse.json(
        { error: "Transaction label does not match claim" },
        { status: 400 },
      );
    }

    if (tx.from.toLowerCase() !== user.embedded_signer_address.toLowerCase()) {
      return NextResponse.json(
        { error: "Transaction sender does not match your embedded signer EOA" },
        { status: 400 },
      );
    }

    const { data: agent } = await supabase
      .from("agents")
      .select("smart_account_address")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!agent?.smart_account_address) {
      return NextResponse.json(
        { error: "Active agent smart wallet is missing" },
        { status: 409 },
      );
    }

    if (
      txAgentBootstrapWallet.toLowerCase() !==
      agent.smart_account_address.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error:
            "Transaction bootstrap wallet does not match your active agent smart wallet",
        },
        { status: 400 },
      );
    }

    const resolvedAddress = await resolveAddress(label);
    if (
      !resolvedAddress ||
      resolvedAddress.toLowerCase() !== user.embedded_signer_address.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "Onchain resolution does not match expected owner address" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      confirmed: true,
      ensName: `${label}.moonjoy.eth`,
      transactionHash,
    });
  } catch (err) {
    console.error("[ens/confirm-claim] Verification error:", err);
    return NextResponse.json(
      { error: "Failed to verify transaction" },
      { status: 502 },
    );
  }
}
