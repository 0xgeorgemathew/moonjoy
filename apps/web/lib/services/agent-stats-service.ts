import { encodeFunctionData, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import {
  durinRegistryAbi,
  DURIN_L2_REGISTRY_ADDRESS,
} from "@moonjoy/contracts";
import { getPrivyServerClient } from "@/lib/auth/privy-server";
import { loadExecutionAuthorization } from "@/lib/services/agent-execution-service";
import {
  getFullNameForAddress,
  getNameNode,
  getNameOwner,
  invalidateLabelCaches,
  resolveTextRecord,
} from "@/lib/services/ens-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractEnsLabel } from "@/lib/types/ens";

const AGENT_MATCHES_PLAYED_KEY = "moonjoy:matches_played";
const AGENT_STREAK_KEY = "moonjoy:streak";

type AgentStats = {
  matchesPlayed: number;
  streak: number;
};

type AgentSyncTarget = {
  agentId: string;
  userId: string;
  smartAccountAddress: string;
  approvalId: string | null;
};

type PrivySendTransactionResponse = {
  hash?: string;
  user_operation_hash?: string;
  transaction_id?: string;
};

export type PublicAgentStats = AgentStats & {
  source: "ens" | "database";
  syncing: boolean;
};

type AgentStatsRecord = {
  key: string;
  value: string;
};

type AgentStatsSyncOutcome = {
  key: string;
  expectedValue: string;
  currentValue: string | null;
  resolvedValue: string | null;
  status: "verified" | "pending" | "failed";
  reason: string | null;
  txHash: string | null;
  userOperationHash: string | null;
  transactionId: string | null;
};

export async function getPublicAgentStats(
  agentId: string | null,
  agentEnsName: string | null,
): Promise<PublicAgentStats | null> {
  if (!agentId) return null;

  const databaseStats = await computeAgentStats(agentId);
  const ensStats = agentEnsName
    ? await readAgentStatsFromEns(agentEnsName)
    : null;

  return resolvePublicAgentStats(databaseStats, ensStats);
}

export function resolvePublicAgentStats(
  databaseStats: AgentStats,
  ensStats: AgentStats | null,
): PublicAgentStats {
  if (
    ensStats &&
    ensStats.matchesPlayed === databaseStats.matchesPlayed &&
    ensStats.streak === databaseStats.streak
  ) {
    return {
      ...ensStats,
      source: "ens",
      syncing: false,
    };
  }

  return {
    ...databaseStats,
    source: "database",
    syncing: true,
  };
}

export async function syncMatchAgentStats(matchId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id, creator_agent_id, opponent_agent_id")
    .eq("id", matchId)
    .eq("status", "settled")
    .maybeSingle();

  if (!match) return;

  const rows = match as Record<string, unknown>;
  const agentIds = [
    rows.creator_agent_id as string | null,
    rows.opponent_agent_id as string | null,
  ].filter((agentId): agentId is string => Boolean(agentId));

  for (const agentId of agentIds) {
    await syncAgentStats(agentId, matchId);
  }
}

async function syncAgentStats(agentId: string, matchId: string): Promise<void> {
  const target = await getAgentSyncTarget(agentId);
  if (!target) return;

  await insertMatchEvent(matchId, "agent_stats.syncing", {
    agentId,
    keys: [AGENT_MATCHES_PLAYED_KEY, AGENT_STREAK_KEY],
  });

  if (!target.approvalId) {
    await insertMatchEvent(matchId, "agent_stats.sync_deferred", {
      agentId,
      reason: "missing_active_mcp_approval",
    });
    return;
  }

  const execution = await loadExecutionAuthorization(target.approvalId);
  if (!execution) {
    await insertMatchEvent(matchId, "agent_stats.sync_deferred", {
      agentId,
      reason: "missing_execution_authorization",
    });
    return;
  }

  const agentEnsName = await getFullNameForAddress(target.smartAccountAddress as Address);
  if (!agentEnsName) {
    await insertMatchEvent(matchId, "agent_stats.sync_deferred", {
      agentId,
      reason: "missing_agent_ens",
    });
    return;
  }

  const label = extractEnsLabel(agentEnsName);
  const owner = await getNameOwner(label);
  if (owner?.toLowerCase() !== target.smartAccountAddress.toLowerCase()) {
    await insertMatchEvent(matchId, "agent_stats.sync_deferred", {
      agentId,
      agentEnsName,
      reason: "agent_ens_not_owned_by_smart_account",
    });
    return;
  }

  const stats = await computeAgentStats(agentId);
  const records = buildAgentStatsRecords(stats);

  const node = await getNameNode(label);
  const outcomes: AgentStatsSyncOutcome[] = [];

  for (const record of records) {
    const currentValue = await safeResolveTextRecord(label, record.key);
    const outcome: AgentStatsSyncOutcome = {
      key: record.key,
      expectedValue: record.value,
      currentValue,
      resolvedValue: currentValue,
      status: currentValue === record.value ? "verified" : "pending",
      reason: null,
      txHash: null,
      userOperationHash: null,
      transactionId: null,
    };

    if (currentValue !== record.value) {
      try {
        const response = await getPrivyServerClient().wallets().ethereum().sendTransaction(
          execution.executionWalletId,
          {
            caip2: `eip155:${baseSepolia.id}`,
            sponsor: true,
            authorization_context: execution.authorizationContext,
            params: {
              transaction: {
                from: target.smartAccountAddress,
                to: DURIN_L2_REGISTRY_ADDRESS,
                data: encodeFunctionData({
                  abi: durinRegistryAbi,
                  functionName: "setText",
                  args: [node, record.key, record.value],
                }),
                chain_id: baseSepolia.id,
                type: 2,
              },
            },
          },
        ) as PrivySendTransactionResponse;

        outcome.txHash = response.hash ?? null;
        outcome.userOperationHash = response.user_operation_hash ?? null;
        outcome.transactionId = response.transaction_id ?? null;
      } catch (error) {
        outcome.status = "failed";
        outcome.reason = error instanceof Error ? error.message : "record_write_failed";
      }
    }

    outcomes.push(outcome);
  }

  if (outcomes.some((outcome) => outcome.txHash || outcome.userOperationHash || outcome.transactionId)) {
    invalidateLabelCaches(label);
  }

  for (const outcome of outcomes) {
    const resolvedValue = await safeResolveTextRecord(label, outcome.key);
    outcome.resolvedValue = resolvedValue;

    if (resolvedValue === outcome.expectedValue) {
      outcome.status = "verified";
      outcome.reason = null;
      continue;
    }

    if (outcome.status === "failed") {
      continue;
    }

    outcome.status = "pending";
    outcome.reason = outcome.txHash || outcome.userOperationHash || outcome.transactionId
      ? "verification_pending"
      : "stale_record";
  }

  const fullySynced = outcomes.every((outcome) => outcome.status === "verified");
  const eventType = fullySynced ? "agent_stats.synced" : "agent_stats.sync_deferred";

  await insertMatchEvent(matchId, eventType, {
    agentId,
    agentEnsName,
    matchesPlayed: stats.matchesPlayed,
    streak: stats.streak,
    reason: fullySynced ? null : "partial_sync",
    records: outcomes,
  });
}

async function getAgentSyncTarget(
  agentId: string,
): Promise<AgentSyncTarget | null> {
  const supabase = createAdminClient();
  const { data: agent } = await supabase
    .from("agents")
    .select("id, user_id, smart_account_address")
    .eq("id", agentId)
    .maybeSingle();

  if (!agent?.smart_account_address || !agent.user_id) return null;

  const { data: approval } = await supabase
    .from("mcp_approvals")
    .select("id")
    .eq("agent_id", agentId)
    .eq("status", "active")
    .maybeSingle();

  return {
    agentId,
    userId: agent.user_id as string,
    smartAccountAddress: agent.smart_account_address as string,
    approvalId: (approval?.id as string | undefined) ?? null,
  };
}

async function computeAgentStats(agentId: string): Promise<AgentStats> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("matches")
    .select("id, winner_agent_id, settled_at")
    .or(`creator_agent_id.eq.${agentId},opponent_agent_id.eq.${agentId}`)
    .eq("status", "settled")
    .order("settled_at", { ascending: false });

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  let streak = 0;
  for (const row of rows) {
    if (row.winner_agent_id !== agentId) break;
    streak += 1;
  }

  return {
    matchesPlayed: rows.length,
    streak,
  };
}

async function readAgentStatsFromEns(
  agentEnsName: string,
): Promise<AgentStats | null> {
  const label = extractEnsLabel(agentEnsName);
  const [matchesPlayedRaw, streakRaw] = await Promise.all([
    safeResolveTextRecord(label, AGENT_MATCHES_PLAYED_KEY),
    safeResolveTextRecord(label, AGENT_STREAK_KEY),
  ]);

  const matchesPlayed = parseNonNegativeInteger(matchesPlayedRaw);
  const streak = parseNonNegativeInteger(streakRaw);
  if (matchesPlayed === null || streak === null) return null;

  return { matchesPlayed, streak };
}

function buildAgentStatsRecords(stats: AgentStats): AgentStatsRecord[] {
  return [
    { key: AGENT_MATCHES_PLAYED_KEY, value: String(stats.matchesPlayed) },
    { key: AGENT_STREAK_KEY, value: String(stats.streak) },
  ];
}

async function safeResolveTextRecord(
  label: string,
  key: string,
): Promise<string | null> {
  try {
    return await resolveTextRecord(label, key);
  } catch {
    return null;
  }
}

function parseNonNegativeInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

async function insertMatchEvent(
  matchId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("match_events")
    .insert({
      match_id: matchId,
      event_type: eventType,
      payload,
    });

  if (error) {
    console.error("[agent-stats] Failed to insert match event", error);
  }
}
