import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AgentExecutionError,
  prepareSessionSignerExecutionAuthorization,
  type PreparedExecutionAuthorization,
  provisionPrivyExecutionAuthorization,
  type ProvisionedExecutionAuthorization,
} from "@/lib/services/agent-execution-service";
import { resolveUser } from "@/lib/services/ens-resolution-service";
import { recordMcpEvent } from "@/lib/services/mcp-event-service";
import type { McpApproval, McpRuntimeContext } from "@/lib/types/mcp";

const MCP_TOKEN_BYTES = 32;
const DEFAULT_SCOPES = ["moonjoy:read", "moonjoy:agent"];

export type UserAgentRecord = {
  user: {
    id: string;
    privy_user_id: string;
    embedded_signer_address: string | null;
  };
  agent: {
    id: string;
    user_id: string;
    smart_account_address: string | null;
    setup_status: string;
    status: string;
  };
};

export class McpAuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export async function approveMcpClientForUser(
  privyUserId: string,
  clientName: string,
  executionAuthorization?: ProvisionedExecutionAuthorization,
): Promise<{ approval: McpApproval; token: string }> {
  const record = await requirePhaseThreeReadyUser(privyUserId);
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const token = generateMcpToken();
  const tokenHash = hashMcpToken(token);
  const tokenPrefix = token.slice(0, 18);
  const subject = `moonjoy:agent:${record.agent.id}`;

  await supabase
    .from("mcp_approvals")
    .update({
      status: "revoked",
      revoked_at: now,
      updated_at: now,
    })
    .eq("agent_id", record.agent.id)
    .eq("status", "active");

  const { data, error } = await supabase
    .from("mcp_approvals")
    .insert({
      agent_id: record.agent.id,
      user_id: record.user.id,
      client_name: normalizeClientName(clientName),
      mcp_subject: subject,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      scopes: DEFAULT_SCOPES,
      execution_signer_id: executionAuthorization?.executionSignerId ?? null,
      execution_wallet_id: executionAuthorization?.executionWalletId ?? null,
      execution_key_ciphertext:
        executionAuthorization?.executionKeyCiphertext ?? null,
      execution_key_expires_at:
        executionAuthorization?.executionKeyExpiresAt ?? null,
    })
    .select(publicApprovalColumns)
    .single();

  if (error || !data) {
    throw new McpAuthError("Failed to approve MCP client", 500);
  }

  const approval = data as McpApproval;

  await supabase
    .from("agents")
    .update({
      execution_signer_id: executionAuthorization?.executionSignerId ?? null,
      execution_signer_provider: executionAuthorization
        ? "privy_authorization_key"
        : "none",
      execution_key_expires_at:
        executionAuthorization?.executionKeyExpiresAt ?? null,
      updated_at: now,
    })
    .eq("id", approval.agent_id);

  await recordMcpEvent(
    {
      agentId: approval.agent_id,
      userId: approval.user_id,
      approvalId: approval.id,
    },
    "approval.created",
    { clientName: approval.client_name, tokenPrefix: approval.token_prefix },
  );

  return { approval, token };
}

export async function verifyMcpBearerToken(
  authorizationHeader: string | null,
): Promise<McpRuntimeContext> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new McpAuthError("Missing MCP bearer token", 401);
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new McpAuthError("Missing MCP bearer token", 401);
  }

  const supabase = createAdminClient();
  const tokenHash = hashMcpToken(token);
  const { data, error } = await supabase
    .from("mcp_approvals")
    .select(
      "id, agent_id, user_id, client_name, mcp_subject, scopes, status, execution_signer_id, execution_key_expires_at",
    )
    .eq("token_hash", tokenHash)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    throw new McpAuthError("Invalid or revoked MCP bearer token", 401);
  }

  const row = data as {
    id: string;
    agent_id: string;
    user_id: string;
    client_name: string;
    mcp_subject: string;
    scopes: string[];
    status: string;
    execution_signer_id: string | null;
    execution_key_expires_at: string | null;
  };

  const { data: agent } = await supabase
    .from("agents")
    .select("id, smart_account_address, status")
    .eq("id", row.agent_id)
    .single();

  if (agent?.status !== "active" || !agent.smart_account_address) {
    throw new McpAuthError("Agent is not active or wallet-ready", 403);
  }

  const { data: user } = await supabase
    .from("users")
    .select("privy_user_id")
    .eq("id", row.user_id)
    .single();

  if (!user?.privy_user_id) {
    throw new McpAuthError("MCP approval user is missing", 403);
  }

  await supabase
    .from("mcp_approvals")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id);

  return {
    approvalId: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    privyUserId: user.privy_user_id,
    clientName: row.client_name,
    subject: row.mcp_subject,
    scopes: row.scopes,
    smartAccountAddress: agent.smart_account_address,
    executionSignerId: row.execution_signer_id,
    executionKeyExpiresAt: row.execution_key_expires_at,
  };
}

export async function requirePhaseThreeReadyUser(
  privyUserId: string,
): Promise<UserAgentRecord> {
  const record = await getUserAgentRecord(privyUserId);
  if (!record) {
    throw new McpAuthError("Moonjoy onboarding is incomplete", 409);
  }

  if (!record.user.embedded_signer_address) {
    throw new McpAuthError("Embedded signer is required before MCP approval", 409);
  }

  if (
    record.agent.status !== "active" ||
    record.agent.setup_status !== "wallet_created" ||
    !record.agent.smart_account_address
  ) {
    throw new McpAuthError("Agent smart account is required before MCP approval", 409);
  }

  const resolved = await resolveUser(record.user.id);
  if (!resolved.ensName) {
    throw new McpAuthError("Moonjoy ENS name is required before MCP approval", 409);
  }

  return record;
}

async function getUserAgentRecord(
  privyUserId: string,
): Promise<UserAgentRecord | null> {
  const supabase = createAdminClient();
  const { data: user } = await supabase
    .from("users")
    .select("id, privy_user_id, embedded_signer_address")
    .eq("privy_user_id", privyUserId)
    .maybeSingle();

  if (!user) return null;

  const { data: agent } = await supabase
    .from("agents")
    .select("id, user_id, smart_account_address, setup_status, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!agent) return null;

  return {
    user: user as UserAgentRecord["user"],
    agent: agent as UserAgentRecord["agent"],
  };
}

function generateMcpToken(): string {
  return `mj_mcp_${randomBytes(MCP_TOKEN_BYTES).toString("base64url")}`;
}

function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeClientName(clientName: string): string {
  const trimmed = clientName.trim();
  if (!trimmed) return "Moonjoy MCP Client";
  return trimmed.slice(0, 80);
}

const publicApprovalColumns =
  "id, agent_id, user_id, client_name, mcp_subject, token_prefix, scopes, status, approved_at, revoked_at, last_used_at, created_at, updated_at, execution_signer_id, execution_wallet_id, execution_key_expires_at";

export async function provisionExecutionAuthorizationForUser(
  privyUserId: string,
  accessToken: string,
): Promise<ProvisionedExecutionAuthorization> {
  const record = await requirePhaseThreeReadyUser(privyUserId);
  return provisionPrivyExecutionAuthorization({
    accessToken,
    smartAccountAddress: record.agent.smart_account_address!,
  });
}

export async function prepareExecutionAuthorizationForUser(
  privyUserId: string,
): Promise<PreparedExecutionAuthorization> {
  const record = await requirePhaseThreeReadyUser(privyUserId);

  if (!record.user.embedded_signer_address) {
    throw new McpAuthError(
      "Embedded signer is required before MCP approval",
      409,
    );
  }

  return prepareSessionSignerExecutionAuthorization({
    privyUserId,
    embeddedSignerAddress: record.user.embedded_signer_address,
  });
}

export async function tryProvisionExecutionAuthorizationForUser(
  privyUserId: string,
  accessToken: string,
): Promise<ProvisionedExecutionAuthorization | null> {
  try {
    return await provisionExecutionAuthorizationForUser(privyUserId, accessToken);
  } catch (error) {
    if (error instanceof AgentExecutionError) {
      console.error(
        "[mcp-auth] execution authorization bootstrap failed during OAuth approval:",
        error.message,
      );
      return null;
    }

    throw error;
  }
}
