export interface AuthUser {
  id: string;
  privy_user_id: string;
  embedded_signer_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  user_id: string;
  smart_account_address: string | null;
  setup_status: "incomplete" | "wallet_created";
  status: "active" | "paused" | "revoked";
  execution_signer_id: string | null;
  execution_signer_provider: "none" | "privy_authorization_key";
  execution_key_expires_at: string | null;
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
  | "error"
  | "complete";
