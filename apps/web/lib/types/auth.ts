export interface AuthUser {
  id: string;
  privy_user_id: string;
  embedded_signer_address: string | null;
  ens_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  user_id: string;
  smart_account_address: string | null;
  setup_status: "incomplete" | "wallet_created";
  ens_name: string | null;
  status: "active" | "paused" | "revoked";
  created_at: string;
  updated_at: string;
}

export interface OnboardResponse {
  user: AuthUser;
  agent: Agent;
}

export type SetupStatus =
  | "unauthenticated"
  | "loading"
  | "onboarding"
  | "complete";
