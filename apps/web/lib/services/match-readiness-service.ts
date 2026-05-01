import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUser } from "@/lib/services/ens-resolution-service";
import { getFullNameForAddress } from "@/lib/services/ens-service";
import type { Address } from "viem";
import type { ArenaReadiness } from "@/lib/types/arena";

export class MatchReadinessError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

export type MatchReadinessResult = {
  ready: boolean;
  readiness: ArenaReadiness;
  userId: string;
  agentId: string;
  smartAccountAddress: string;
  userEnsName: string;
  agentEnsName: string;
};

export async function checkMatchReadiness(
  privyUserId: string,
): Promise<MatchReadinessResult> {
  const supabase = createAdminClient();

  const { data: userRow } = await supabase
    .from("users")
    .select("id, privy_user_id, embedded_signer_address")
    .eq("privy_user_id", privyUserId)
    .maybeSingle();

  if (!userRow) {
    throw new MatchReadinessError("User not found.", 404);
  }

  const userId = (userRow as { id: string }).id;
  const signerAddress = (userRow as { embedded_signer_address: string | null }).embedded_signer_address;

  const { data: agentRow } = await supabase
    .from("agents")
    .select("id, user_id, smart_account_address, setup_status, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  const agent = agentRow as {
    id: string;
    user_id: string;
    smart_account_address: string | null;
    setup_status: string;
    status: string;
  } | null;

  if (!agent) {
    throw new MatchReadinessError("Agent not found or inactive.", 404);
  }

  if (!agent.smart_account_address) {
    throw new MatchReadinessError("Agent smart account is missing.", 409);
  }

  const { data: approvalRow } = await supabase
    .from("mcp_approvals")
    .select("id")
    .eq("agent_id", agent.id)
    .eq("status", "active")
    .maybeSingle();

  const hasMcpApproval = Boolean(approvalRow);

  let userEnsName: string | null = null;
  let agentEnsName: string | null = null;

  if (signerAddress) {
    const userResolution = await resolveUser(userId);
    userEnsName = userResolution.ensName ?? null;
  }

  agentEnsName = await getFullNameForAddress(agent.smart_account_address as Address);

  const readiness = buildMatchReadiness({
    hasUser: true,
    hasAgent: true,
    hasSmartAccount: Boolean(agent.smart_account_address),
    hasMcpApproval,
    hasUserEns: Boolean(userEnsName),
    hasAgentEns: Boolean(agentEnsName),
  });

  return {
    ready: readiness.ready,
    readiness,
    userId,
    agentId: agent.id,
    smartAccountAddress: agent.smart_account_address,
    userEnsName: userEnsName ?? "",
    agentEnsName: agentEnsName ?? "",
  };
}

export function requireMatchReadiness(
  result: MatchReadinessResult,
): void {
  if (!result.ready) {
    const blockerList = result.readiness.blockers.join("; ");
    throw new MatchReadinessError(
      `Match readiness blocked: ${blockerList}`,
      409,
    );
  }
}

export function buildMatchReadiness(flags: {
  hasUser: boolean;
  hasAgent: boolean;
  hasSmartAccount: boolean;
  hasMcpApproval: boolean;
  hasUserEns: boolean;
  hasAgentEns: boolean;
}): ArenaReadiness {
  const blockers: string[] = [];
  if (!flags.hasUser) blockers.push("Sign in with Privy");
  if (!flags.hasAgent) blockers.push("Complete onboarding to create agent");
  if (!flags.hasSmartAccount) blockers.push("Agent smart account is missing");
  if (!flags.hasMcpApproval) blockers.push("Authorize an MCP client");
  if (!flags.hasUserEns) blockers.push("Claim your ENS name");
  if (!flags.hasAgentEns) blockers.push("Agent ENS identity bootstrap required");

  return {
    ...flags,
    ready: blockers.length === 0,
    blockers,
  };
}
