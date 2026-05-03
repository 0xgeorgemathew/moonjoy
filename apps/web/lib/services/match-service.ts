import {
  createMatch,
  getNextTransitionAt,
  isSettlementGraceExpired,
  reconcileMatchStatus,
  settleMatch,
  startLive,
  startWarmup,
  type MatchParticipant,
  type MatchState,
  type MatchStatus,
} from "@moonjoy/game";
import type { Address } from "viem";
import { getFullNameForAddress } from "@/lib/services/ens-service";
import { resolveUser } from "@/lib/services/ens-resolution-service";
import {
  notifyMatchEventSessions,
} from "@/lib/services/mcp-session-notification-service";
import { tickActiveMatch } from "@/lib/services/worker-loop-service";
import {
  requirePhaseThreeReadyUser,
  type UserAgentRecord,
} from "@/lib/services/mcp-auth-service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { McpRuntimeContext } from "@/lib/types/mcp";
import type {
  ActiveMatchSnapshot,
  MatchParticipantView,
  MatchRow,
  MatchView,
  MatchViewer,
} from "@/lib/types/match";

const ACTIVE_MATCH_STATUSES: MatchStatus[] = [
  "created",
  "warmup",
  "live",
  "settling",
];

const MATCH_COLUMNS = [
  "id",
  "creator_user_id",
  "creator_agent_id",
  "creator_smart_account_address",
  "invited_user_id",
  "invite_code",
  "opponent_user_id",
  "opponent_agent_id",
  "opponent_smart_account_address",
  "status",
  "wager_usd",
  "live_duration_seconds",
  "warmup_duration_seconds",
  "settlement_grace_seconds",
  "starting_capital_usd",
  "trade_rules_version",
  "winner_seat",
  "winner_agent_id",
  "result_summary",
  "created_at",
  "warmup_started_at",
  "live_started_at",
  "live_ends_at",
  "settling_started_at",
  "settled_at",
  "updated_at",
].join(", ");

type MatchActor = {
  userId: string;
  agentId: string;
  smartAccountAddress: string;
  userEnsName: string;
  agentEnsName: string;
};

type SettlementInput = {
  creatorStartingValueUsd: number;
  creatorCurrentValueUsd: number;
  opponentStartingValueUsd: number;
  opponentCurrentValueUsd: number;
};

export class MatchServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export async function getActiveMatchSnapshotForUser(
  privyUserId: string,
): Promise<ActiveMatchSnapshot> {
  const actor = await getActorForPrivyUser(privyUserId);
  return getActiveSnapshot(actor);
}

export async function getActiveMatchSnapshotForMcpContext(
  context: McpRuntimeContext,
): Promise<ActiveMatchSnapshot> {
  const actor = await getActorForMcpContext(context);
  return getActiveSnapshot(actor);
}

export async function getMatchByIdForUser(
  privyUserId: string,
  matchId: string,
): Promise<MatchView> {
  const actor = await getActorForPrivyUser(privyUserId);
  return getMatchById(actor, matchId);
}

export async function getMatchByIdForMcpContext(
  context: McpRuntimeContext,
  matchId: string,
): Promise<MatchView> {
  const actor = await getActorForMcpContext(context);
  return getMatchById(actor, matchId);
}

export async function startWarmupForUser(
  privyUserId: string,
  matchId: string,
): Promise<MatchView> {
  const actor = await getActorForPrivyUser(privyUserId);
  return ensureWarmup(actor, matchId);
}

export async function startLiveForUser(
  privyUserId: string,
  matchId: string,
): Promise<MatchView> {
  const actor = await getActorForPrivyUser(privyUserId);
  return ensureLive(actor, matchId);
}

export async function settleMatchForUser(
  privyUserId: string,
  matchId: string,
  input: SettlementInput,
): Promise<MatchView> {
  const actor = await getActorForPrivyUser(privyUserId);
  return settleMatchById(actor, matchId, input);
}

async function getActiveSnapshot(actor: MatchActor): Promise<ActiveMatchSnapshot> {
  const row = await findLatestMatchForAgent(actor.agentId);
  const reconciled = row ? await reconcilePersistedMatch(row) : null;
  const activeMatch =
    reconciled && ACTIVE_MATCH_STATUSES.includes(reconciled.status)
      ? await presentMatch(reconciled, actor.agentId)
      : null;

  return {
    viewer: toViewer(actor),
    activeMatch,
    generatedAt: new Date().toISOString(),
  };
}

async function getMatchById(actor: MatchActor, matchId: string): Promise<MatchView> {
  const row = await requireOwnedMatch(matchId, actor.agentId);
  return presentMatch(row, actor.agentId);
}

async function ensureWarmup(actor: MatchActor, matchId: string): Promise<MatchView> {
  const row = await requireOwnedMatch(matchId, actor.agentId);
  const reconciled = await reconcilePersistedMatch(row);

  if (reconciled.status === "warmup") {
    return presentMatch(reconciled, actor.agentId);
  }

  if (reconciled.status !== "created") {
    return presentMatch(reconciled, actor.agentId);
  }

  if (!reconciled.opponent_agent_id) {
    throw new MatchServiceError("Cannot start warmup without an opponent.", 409);
  }

  const state = startWarmup(matchRowToState(reconciled), new Date());
  const nextRow = await persistStateTransition(
    reconciled,
    state,
    "match.warmup_started",
    actor.agentId,
  );

  return presentMatch(nextRow, actor.agentId);
}

async function ensureLive(actor: MatchActor, matchId: string): Promise<MatchView> {
  const row = await requireOwnedMatch(matchId, actor.agentId);
  const reconciled = await reconcilePersistedMatch(row);

  if (reconciled.status === "live" || reconciled.status === "settling" || reconciled.status === "settled") {
    return presentMatch(reconciled, actor.agentId);
  }

  if (reconciled.status !== "warmup") {
    throw new MatchServiceError("Match is not ready to go live.", 409);
  }

  try {
    const state = startLive(matchRowToState(reconciled), new Date());
    const nextRow = await persistStateTransition(
      reconciled,
      state,
      "match.live_started",
      actor.agentId,
    );

    return presentMatch(nextRow, actor.agentId);
  } catch (error) {
    if (error instanceof Error) {
      throw new MatchServiceError(error.message, 409);
    }

    throw error;
  }
}

async function settleMatchById(
  actor: MatchActor,
  matchId: string,
  input: SettlementInput,
): Promise<MatchView> {
  assertSettlementInput(input);
  const row = await requireOwnedMatch(matchId, actor.agentId);
  const reconciled = await reconcilePersistedMatch(row);

  if (reconciled.status === "settled") {
    return presentMatch(reconciled, actor.agentId);
  }

  throw new MatchServiceError(
    "Settlement is disabled until server-owned valuation snapshots are implemented.",
    409,
  );
}

async function presentMatch(
  row: MatchRow,
  viewerAgentId: string,
): Promise<MatchView> {
  const reconciled = await reconcilePersistedMatch(row);

  const creatorPromise = resolveParticipantView(
    reconciled.creator_user_id,
    reconciled.creator_agent_id,
    reconciled.creator_smart_account_address,
  );
  const opponentPromise =
    reconciled.opponent_user_id &&
    reconciled.opponent_agent_id &&
    reconciled.opponent_smart_account_address
      ? resolveParticipantView(
          reconciled.opponent_user_id,
          reconciled.opponent_agent_id,
          reconciled.opponent_smart_account_address,
        )
      : Promise.resolve(null);
  const [creator, opponent] = await Promise.all([creatorPromise, opponentPromise]);
  const nextTransitionAt = getNextTransitionAt(matchRowToState(reconciled));

  return {
    id: reconciled.id,
    status: reconciled.status,
    viewerSeat:
      viewerAgentId === reconciled.creator_agent_id
        ? "creator"
        : viewerAgentId === reconciled.opponent_agent_id
          ? "opponent"
          : null,
    wagerUsd: Number(reconciled.wager_usd),
    liveDurationSeconds: Number(reconciled.live_duration_seconds),
    warmupDurationSeconds: Number(reconciled.warmup_duration_seconds),
    settlementGraceSeconds: Number(reconciled.settlement_grace_seconds),
    startingCapitalUsd: Number(reconciled.starting_capital_usd),
    tradeRulesVersion: reconciled.trade_rules_version ?? "buy_only_v1",
    creator,
    invite: buildInviteView(reconciled),
    opponent,
    createdAt: reconciled.created_at,
    warmupStartedAt: reconciled.warmup_started_at,
    liveStartedAt: reconciled.live_started_at,
    liveEndsAt: reconciled.live_ends_at,
    settlingStartedAt: reconciled.settling_started_at,
    settledAt: reconciled.settled_at,
    nextTransitionAt: nextTransitionAt?.toISOString() ?? null,
    resultSummary:
      reconciled.status === "settled"
        ? (reconciled.result_summary as Record<string, unknown>)
        : null,
  };
}

function buildInviteView(row: MatchRow): MatchView["invite"] {
  if (!row.invited_user_id && !row.invite_code) {
    return null;
  }

  return {
    invitedUserId: row.invited_user_id,
    inviteCode: row.invite_code,
    invitePath: `/match?invite=${row.id}`,
  };
}

async function resolveParticipantView(
  userId: string,
  agentId: string,
  smartAccountAddress: string,
): Promise<MatchParticipantView> {
  const [userResolution, agentEnsName] = await Promise.all([
    resolveUser(userId),
    getFullNameForAddress(smartAccountAddress as Address),
  ]);

  if (!userResolution.ensName) {
    throw new MatchServiceError("User ENS identity is missing onchain.", 409);
  }

  if (!agentEnsName) {
    throw new MatchServiceError("Agent ENS identity is missing onchain.", 409);
  }

  return {
    userId,
    agentId,
    smartAccountAddress,
    userEnsName: userResolution.ensName,
    agentEnsName,
  };
}

async function getActorForPrivyUser(privyUserId: string): Promise<MatchActor> {
  const record = await requirePhaseThreeReadyUser(privyUserId);
  const approval = await getActiveApprovalForAgent(record.agent.id);
  if (!approval) {
    throw new MatchServiceError(
      "An active MCP approval is required before matches can begin.",
      409,
    );
  }

  return buildActorFromRecord(record);
}

async function getActorForMcpContext(
  context: McpRuntimeContext,
): Promise<MatchActor> {
  const supabase = createAdminClient();
  const [userQuery, agentQuery] = await Promise.all([
    supabase
      .from("users")
      .select("id, privy_user_id, embedded_signer_address")
      .eq("id", context.userId)
      .single(),
    supabase
      .from("agents")
      .select("id, user_id, smart_account_address, setup_status, status")
      .eq("id", context.agentId)
      .single(),
  ]);

  const user = userQuery.data;
  const agent = agentQuery.data;

  if (!user || !agent) {
    throw new MatchServiceError("MCP context is missing its Moonjoy actor.", 403);
  }

  return buildActorFromRecord({
    user: user as UserAgentRecord["user"],
    agent: agent as UserAgentRecord["agent"],
  });
}

async function buildActorFromRecord(record: UserAgentRecord): Promise<MatchActor> {
  const agentAddress = record.agent.smart_account_address;
  if (!agentAddress) {
    throw new MatchServiceError("Agent smart account is missing.", 409);
  }

  const [userResolution, agentEnsName] = await Promise.all([
    resolveUser(record.user.id),
    getFullNameForAddress(agentAddress as Address),
  ]);

  const userEnsName = userResolution.ensName;

  if (
    !userEnsName ||
    !userResolution.address ||
    !record.user.embedded_signer_address ||
    userResolution.address.toLowerCase() !==
      record.user.embedded_signer_address.toLowerCase()
  ) {
    throw new MatchServiceError(
      "User ENS must resolve onchain to the embedded signer before matches can begin.",
      409,
    );
  }

  if (!agentEnsName) {
    throw new MatchServiceError(
      "Agent ENS identity must resolve onchain before matches can begin.",
      409,
    );
  }

  return {
    userId: record.user.id,
    agentId: record.agent.id,
    smartAccountAddress: agentAddress,
    userEnsName,
    agentEnsName,
  };
}

async function findLatestMatchForAgent(agentId: string): Promise<MatchRow | null> {
  const supabase = createAdminClient();
  const active = await supabase
    .from("matches")
    .select(MATCH_COLUMNS)
    .or(`creator_agent_id.eq.${agentId},opponent_agent_id.eq.${agentId}`)
    .in("status", ACTIVE_MATCH_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (active.error) {
    throw new MatchServiceError("Failed to load active match.", 500);
  }

  return (active.data as unknown as MatchRow | null) ?? null;
}

async function requireOwnedMatch(
  matchId: string,
  agentId: string,
): Promise<MatchRow> {
  const row = await fetchMatchRow(matchId);
  if (
    row.creator_agent_id !== agentId &&
    row.opponent_agent_id !== agentId
  ) {
    throw new MatchServiceError("Match not found for this agent.", 404);
  }

  return row;
}

async function fetchMatchRow(matchId: string): Promise<MatchRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("matches")
    .select(MATCH_COLUMNS)
    .eq("id", matchId)
    .single();

  if (error || !data) {
    throw new MatchServiceError("Match not found.", 404);
  }

  return data as unknown as MatchRow;
}

async function reconcilePersistedMatch(row: MatchRow): Promise<MatchRow> {
  const currentState = matchRowToState(row);
  const now = new Date();
  const nextState = reconcileMatchStatus(currentState, now);

  if (nextState.status === currentState.status) {
    if (isSettlementGraceExpired(now, currentState)) {
      return autoSettleUnscoredMatch(row, now);
    }

    return row;
  }

  const eventType =
    nextState.status === "live"
      ? "match.live_started"
      : nextState.status === "settling"
        ? "match.settling_started"
        : "match.updated";

  try {
    const nextRow = await persistStateTransition(row, nextState, eventType);
    const persistedState = matchRowToState(nextRow);
    if (isSettlementGraceExpired(now, persistedState)) {
      return autoSettleUnscoredMatch(nextRow, now);
    }

    return nextRow;
  } catch (error) {
    if (
      error instanceof MatchServiceError &&
      error.statusCode === 409
    ) {
      const latestRow = await fetchMatchRow(row.id);
      const latestState = matchRowToState(latestRow);

      if (latestState.status !== currentState.status) {
        return latestRow;
      }
    }

    throw error;
  }
}

async function autoSettleUnscoredMatch(
  row: MatchRow,
  settledAt: Date,
): Promise<MatchRow> {
  await tickActiveMatch(row.id, settledAt);
  const workerSettledRow = await fetchMatchRow(row.id);
  if (workerSettledRow.status === "settled") {
    return workerSettledRow;
  }

  const settled = settleMatch(matchRowToState(row), {
    winnerSeat: null,
    settledAt,
  });

  return persistStateTransition(
    row,
    settled,
    "match.auto_settled_unscored",
    undefined,
    {
      winner_seat: null,
      winner_agent_id: null,
      result_summary: {
        outcome: "tie",
        settlementMode: "unscored_demo_auto_settle",
        reason:
          "Quote-backed portfolio valuation is not implemented yet; match auto-settled without a PnL winner.",
        settledBy: "server_reconciliation",
      },
    },
  );
}

async function persistStateTransition(
  currentRow: MatchRow,
  nextState: MatchState,
  eventType: string,
  viewerAgentId?: string,
  extraUpdates?: Record<string, unknown>,
): Promise<MatchRow> {
  const supabase = createAdminClient();
  const updates = {
    ...matchStateToUpdateRow(nextState),
    ...(extraUpdates ?? {}),
  };
  const { data, error } = await supabase
    .from("matches")
    .update(updates)
    .eq("id", currentRow.id)
    .eq("status", currentRow.status)
    .select(MATCH_COLUMNS)
    .single();

  if (error || !data) {
    const latestRow = await fetchMatchRow(currentRow.id);
    if (latestRow.status === nextState.status) {
      return latestRow;
    }

    throw new MatchServiceError("Failed to persist match transition.", 409);
  }

  const row = data as unknown as MatchRow;
  await recordMatchEvent(row, eventType, {
    status: row.status,
    viewerAgentId: viewerAgentId ?? null,
  });

  return row;
}

async function recordMatchEvent(
  row: MatchRow,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("match_events").insert({
    match_id: row.id,
    event_type: eventType,
    payload,
  });

  await Promise.all([
    broadcastMatchUpdate(row, eventType),
    notifyMatchUpdate(row, eventType, payload),
  ]);
}

async function notifyMatchUpdate(
  row: MatchRow,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const agentIds = [row.creator_agent_id];
  if (row.opponent_agent_id) {
    agentIds.push(row.opponent_agent_id);
  }

  await notifyMatchEventSessions({
    agentIds,
    eventType,
    matchId: row.id,
    status: row.status,
    payload: {
      ...payload,
      nextRecommendedTool: "moonjoy_match:action=heartbeat",
    },
  });
}

async function broadcastMatchUpdate(
  row: MatchRow,
  eventType: string,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return;
  }

  const topics = [
    `match:${row.id}`,
    `agent:${row.creator_agent_id}:matches`,
  ];

  if (row.opponent_agent_id) {
    topics.push(`agent:${row.opponent_agent_id}:matches`);
  }

  await Promise.all(
    topics.map(async (topic) => {
      try {
        await fetch(`${url}/rest/v1/rpc/broadcast`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            topic,
            event: "match_state_changed",
            payload: {
              eventType,
              matchId: row.id,
              status: row.status,
              topic,
              updatedAt: row.updated_at,
            },
            private: false,
          }),
        });
      } catch (error) {
        console.error("[match] Failed to broadcast update", error);
      }
    }),
  );
}

async function getActiveApprovalForAgent(
  agentId: string,
): Promise<{ id: string } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mcp_approvals")
    .select("id")
    .eq("agent_id", agentId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new MatchServiceError("Failed to validate MCP approval.", 500);
  }

  return (data as { id: string } | null) ?? null;
}

function toViewer(actor: MatchActor): MatchViewer {
  return {
    userId: actor.userId,
    agentId: actor.agentId,
    userEnsName: actor.userEnsName,
    agentEnsName: actor.agentEnsName,
    agentTopic: `agent:${actor.agentId}:matches`,
  };
}

function toGameParticipant(actor: MatchActor): MatchParticipant {
  return {
    userId: actor.userId,
    agentId: actor.agentId,
    smartAccountAddress: actor.smartAccountAddress,
  };
}

function matchRowToState(row: MatchRow): MatchState {
  return {
    id: row.id,
    status: row.status,
    config: {
      wagerUsd: Number(row.wager_usd),
      durationSeconds: Number(row.live_duration_seconds),
      warmupSeconds: Number(row.warmup_duration_seconds),
      settlementGraceSeconds: Number(row.settlement_grace_seconds),
      startingCapitalUsd: Number(row.starting_capital_usd),
    },
    creator: {
      userId: row.creator_user_id,
      agentId: row.creator_agent_id,
      smartAccountAddress: row.creator_smart_account_address,
    },
    opponent:
      row.opponent_user_id &&
      row.opponent_agent_id &&
      row.opponent_smart_account_address
        ? {
            userId: row.opponent_user_id,
            agentId: row.opponent_agent_id,
            smartAccountAddress: row.opponent_smart_account_address,
          }
        : null,
    timing: {
      createdAt: new Date(row.created_at),
      warmupStartedAt: toDate(row.warmup_started_at),
      liveStartedAt: toDate(row.live_started_at),
      liveEndsAt: toDate(row.live_ends_at),
      settlingStartedAt: toDate(row.settling_started_at),
      settledAt: toDate(row.settled_at),
    },
  };
}

function matchStateToUpdateRow(state: MatchState): Record<string, unknown> {
  return {
    creator_user_id: state.creator.userId,
    creator_agent_id: state.creator.agentId,
    creator_smart_account_address: state.creator.smartAccountAddress,
    opponent_user_id: state.opponent?.userId ?? null,
    opponent_agent_id: state.opponent?.agentId ?? null,
    opponent_smart_account_address: state.opponent?.smartAccountAddress ?? null,
    status: state.status,
    wager_usd: state.config.wagerUsd,
    live_duration_seconds: state.config.durationSeconds,
    warmup_duration_seconds: state.config.warmupSeconds,
    settlement_grace_seconds: state.config.settlementGraceSeconds,
    starting_capital_usd: state.config.startingCapitalUsd,
    warmup_started_at: state.timing.warmupStartedAt?.toISOString() ?? null,
    live_started_at: state.timing.liveStartedAt?.toISOString() ?? null,
    live_ends_at: state.timing.liveEndsAt?.toISOString() ?? null,
    settling_started_at: state.timing.settlingStartedAt?.toISOString() ?? null,
    settled_at: state.timing.settledAt?.toISOString() ?? null,
    updated_at: new Date().toISOString(),
  };
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function assertSettlementInput(input: SettlementInput): void {
  const startingValues = [
    input.creatorStartingValueUsd,
    input.opponentStartingValueUsd,
  ];
  const currentValues = [
    input.creatorCurrentValueUsd,
    input.opponentCurrentValueUsd,
  ];

  if (
    startingValues.some((value) => !Number.isFinite(value) || value <= 0) ||
    currentValues.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new MatchServiceError(
      "Starting values must be greater than zero, and current values must be zero or greater.",
      400,
    );
  }
}
