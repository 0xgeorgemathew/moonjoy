import { NextResponse } from "next/server";
import { getAuthenticatedUserId, AuthError } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getEnsPublicClient,
  resolveTextRecord,
  resolveAddress,
  validateUserTextRecord,
} from "@/lib/services/ens-service";
import { extractEnsLabel } from "@/lib/types/ens";

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
    ensName?: string;
    key?: string;
    value?: string;
    transactionHash?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { ensName, key, value, transactionHash } = body;

  if (!ensName || typeof ensName !== "string") {
    return NextResponse.json(
      { error: "ENS name is required" },
      { status: 400 },
    );
  }

  if (!key || typeof key !== "string") {
    return NextResponse.json(
      { error: "Record key is required" },
      { status: 400 },
    );
  }

  if (!value || typeof value !== "string") {
    return NextResponse.json(
      { error: "Record value is required" },
      { status: 400 },
    );
  }

  if (!transactionHash || typeof transactionHash !== "string") {
    return NextResponse.json(
      { error: "Transaction hash is required" },
      { status: 400 },
    );
  }

  const recordValidation = validateUserTextRecord(key, value);
  if (!recordValidation.valid) {
    return NextResponse.json(
      { error: recordValidation.error },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data: user } = await supabase
    .from("users")
    .select("embedded_signer_address")
    .eq("privy_user_id", privyUserId)
    .single();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (!user.embedded_signer_address) {
    return NextResponse.json(
      { error: "Embedded signer address is required before setting ENS records" },
      { status: 409 },
    );
  }

  const label = extractEnsLabel(ensName);

  try {
    const publicClient = getEnsPublicClient();
    const resolvedOwner = await resolveAddress(label);
    if (
      !resolvedOwner ||
      resolvedOwner.toLowerCase() !== user.embedded_signer_address.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "ENS name does not resolve to your embedded signer" },
        { status: 403 },
      );
    }

    const receipt = await publicClient.getTransactionReceipt({
      hash: transactionHash as `0x${string}`,
    });

    if (receipt.status !== "success") {
      return NextResponse.json(
        { error: "Transaction reverted onchain" },
        { status: 400 },
      );
    }

    const onchainValue = await resolveTextRecord(label, key);
    if (onchainValue !== value) {
      return NextResponse.json(
        { error: "Onchain text record does not match submitted value" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      confirmed: true,
      ensName,
      key,
      transactionHash,
    });
  } catch (err) {
    console.error("[ens/set-user-text-record] Verification error:", err);
    return NextResponse.json(
      { error: "Failed to verify transaction" },
      { status: 502 },
    );
  }
}
