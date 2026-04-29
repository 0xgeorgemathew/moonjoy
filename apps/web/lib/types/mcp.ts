export type McpApprovalStatus = "active" | "revoked";

export type McpApproval = {
  id: string;
  agent_id: string;
  user_id: string;
  client_name: string;
  mcp_subject: string;
  token_prefix: string;
  scopes: string[];
  status: McpApprovalStatus;
  approved_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  execution_signer_id: string | null;
  execution_wallet_id?: string | null;
  execution_key_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type McpEventType =
  | "approval.created"
  | "approval.revoked"
  | "bootstrap.tx_submitted"
  | "bootstrap.tx_confirmed"
  | "session.initialized"
  | "session.closed"
  | "tool.called"
  | "tool.failed";

export type McpRuntimeContext = {
  approvalId: string;
  agentId: string;
  userId: string;
  privyUserId: string;
  clientName: string;
  subject: string;
  scopes: string[];
  smartAccountAddress: string;
  executionSignerId: string | null;
  executionKeyExpiresAt: string | null;
  requestOrigin?: string;
};
