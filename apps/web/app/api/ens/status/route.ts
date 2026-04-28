import { NextResponse } from "next/server";
import { getAuthenticatedUserId, AuthError } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getFullNameForAddress,
  resolveTextRecord,
} from "@/lib/services/ens-service";
import { extractEnsLabel } from "@/lib/types/ens";
import type { Address } from "viem";

const MATCH_PREFERENCE_KEY = "moonjoy:match_preference";

export async function GET(request: Request) {
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

  const supabase = createAdminClient();

  const { data: user } = await supabase
    .from("users")
    .select("embedded_signer_address")
    .eq("privy_user_id", privyUserId)
    .single();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userEnsName = user.embedded_signer_address
    ? await getFullNameForAddress(user.embedded_signer_address as Address)
    : null;

  const textRecords: { record_key: string; record_value: string }[] = [];
  if (userEnsName) {
    const label = extractEnsLabel(userEnsName);
    try {
      const value = await resolveTextRecord(label, MATCH_PREFERENCE_KEY);
      if (value) {
        textRecords.push({
          record_key: MATCH_PREFERENCE_KEY,
          record_value: value,
        });
      }
    } catch {
      // Text records are convenience reads from chain; identity still works.
    }
  }

  return NextResponse.json({
    userEnsName,
    embeddedSignerAddress: user.embedded_signer_address,
    textRecords,
  });
}
