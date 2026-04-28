import { NextResponse } from "next/server";
import { getAuthenticatedUserId, AuthError } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkAvailability,
  getFullNameForAddress,
  validateEnsLabel,
} from "@/lib/services/ens-service";
import { isEvmAddress } from "@/lib/services/agent-wallet-service";
import type { Address } from "viem";

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

  let body: { label?: string; ownerAddress?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { label, ownerAddress } = body;

  if (!label || typeof label !== "string") {
    return NextResponse.json({ error: "Label is required" }, { status: 400 });
  }

  if (!ownerAddress || !isEvmAddress(ownerAddress)) {
    return NextResponse.json(
      { error: "Valid owner address is required" },
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
    .select("embedded_signer_address")
    .eq("privy_user_id", privyUserId)
    .single();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (
    user.embedded_signer_address?.toLowerCase() !==
    (ownerAddress as Address).toLowerCase()
  ) {
    return NextResponse.json(
      { error: "Owner address must match your embedded signer address" },
      { status: 403 },
    );
  }

  const existingName = await getFullNameForAddress(ownerAddress as Address);
  if (existingName) {
    return NextResponse.json(
      { error: "You already have a Moonjoy ENS name", ensName: existingName },
      { status: 409 },
    );
  }

  let onchainAvailable: boolean;
  try {
    onchainAvailable = await checkAvailability(label);
  } catch {
    return NextResponse.json(
      { error: "Failed to check onchain availability" },
      { status: 502 },
    );
  }

  if (!onchainAvailable) {
    return NextResponse.json(
      { error: "This name is already registered onchain" },
      { status: 409 },
    );
  }

  const ensName = `${label}.moonjoy.eth`;

  return NextResponse.json({
    ensName,
    label,
  });
}
