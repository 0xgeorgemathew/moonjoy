export type EnsClaimStatus = "pending" | "confirmed" | "failed" | "expired";

export interface EnsClaim {
  id: string;
  user_id: string;
  label: string;
  claim_type: "user";
  owner_address: string;
  transaction_hash: string | null;
  status: EnsClaimStatus;
  failure_reason: string | null;
  expires_at: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const ALLOWED_USER_TEXT_RECORD_KEYS: readonly string[] = [
  "moonjoy:match_preference",
] as const;

export type AllowedUserTextRecordKey =
  (typeof ALLOWED_USER_TEXT_RECORD_KEYS)[number];

export function extractEnsLabel(ensName: string): string {
  return ensName.replace(/\.moonjoy\.eth$/i, "");
}
