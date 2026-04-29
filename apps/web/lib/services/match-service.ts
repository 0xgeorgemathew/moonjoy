import {
  acceptChallenge,
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
  notifyArenaMatchmakingSessions,
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
  OpenChallengeSnapshot,
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

type CreateChallengeOptions = {
  invitedUserId?: string | null;
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

export async function createChallengeForUser(
  privyUserId: string,
  options: CreateChallengeOptions = {},
): Promise<MatchView> {
  const actor = await getActorForPrivyUser(privyUserId);
  return createChallenge(actor, options);
}

export async function createChallengeForMcpContext(
  context: McpRuntimeContext,
): Promise<MatchView> {
  const actor = await getActorForMcpContext(context);
  return createChallenge(actor);
}

export async function listOpenChallengesForUser(
  privyUserId: string,
): Promise<OpenChallengeSnapshot> {
  const actor = await getActorForPrivyUser(privyUserId);
  return listOpenChallenges(actor);
}

export async function listOpenChallengesForMcpContext(
  context: McpRuntimeContext,
): Promise<OpenChallengeSnapshot> {
  const actor = await getActorForMcpContext(context);
  return listOpenChallenges(actor);
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

export async function acceptChallengeForUser(
  privyUserId: string,
  matchId: string,
): Promise<MatchView> {
  const actor = await getActorForPrivyUser(privyUserId);
  return acceptOpenChallenge(actor, matchId);
}

export async function acceptChallengeForMcpContext(
  context: McpRuntimeContext,
  matchId: string,
): Promise<MatchView> {
  const actor = await getActorForMcpContext(context);
  return acceptOpenChallenge(actor, matchId);
}

export async function cancelChallengeForUser(
  privyUserId: string,
  matchId: string,
): Promise<MatchView> {
  const actor = await getActorForPrivyUser(privyUserId);
  return cancelOpenChallenge(actor, matchId);
}

export async function cancelChallengeForMcpContext(
  context: McpRuntimeContext,
  matchId: string,
): Promise<MatchView> {
  const actor = await getActorForMcpContext(context);
  return cancelOpenChallenge(actor, matchId);
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

async function createChallenge(
  actor: MatchActor,
  options: CreateChallengeOptions = {},
): Promise<MatchView> {
  await reconcileLatestActiveMatchForAgent(actor.agentId);

  const now = new Date();
  const state = createMatch({
    id: crypto.randomUUID(),
    creator: toGameParticipant(actor),
    createdAt: now,
  });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .rpc("create_open_match", {
      p_match_id: state.id,
      p_creator_user_id: state.creator.userId,
      p_creator_agent_id: state.creator.agentId,
      p_creator_smart_account_address: state.creator.smartAccountAddress,
      p_wager_usd: state.config.wagerUsd,
      p_live_duration_seconds: state.config.durationSeconds,
      p_warmup_duration_seconds: state.config.warmupSeconds,
      p_settlement_grace_seconds: state.config.settlementGraceSeconds,
      p_starting_capital_usd: state.config.startingCapitalUsd,
      p_created_at: state.timing.createdAt.toISOString(),
      p_invited_user_id: options.invitedUserId ?? null,
      p_invite_code: options.invitedUserId ? crypto.randomUUID() : null,
    })
    .single();

  if (error || !data) {
    throw mapMatchMutationError(error, "Failed to create challenge.");
  }

  const row = data as unknown as MatchRow;
  await recordMatchEvent(row, "challenge.created", {
    creatorAgentId: actor.agentId,
    creatorUserId: actor.userId,
  });

  return presentMatch(row, actor.agentId);
}

async function listOpenChallenges(actor: MatchActor): Promise<OpenChallengeSnapshot> {
  const supabase = createAdminClient();
  const query = supabase
    .from("matches")
    .select(MATCH_COLUMNS)
    .eq("status", "created")
    .is("opponent_agent_id", null)
    .neq("creator_agent_id", actor.agentId)
    .or(`invited_user_id.is.null,invited_user_id.eq.${actor.userId}`)
    .order("created_at", { ascending: false })
    .limit(25);
  const { data, error } = await query;

  if (error) {
    throw new MatchServiceError("Failed to list open challenges.", 500);
  }

  const challenges = await Promise.all(
    (((data as unknown as MatchRow[] | null) ?? [])).map((row) =>
      presentMatch(row, actor.agentId),
    ),
  );

  return {
    viewer: toViewer(actor),
    challenges,
    generatedAt: new Date().toISOString(),
  };
}

async function getActiveSnapshot(actor: MatchActor): Promise<ActiveMatchSnapshot> {
  const row = await findLatestMatchForAgent(actor.agentId);
  const reconciled = row ? await reconcilePersistedMatch(row) : null;
  const activeMatch =
    reconciled && ACTIVE_MATCH_STATUSES.includes(reconciled.status)
      ? await presentMatch(reconciled, actor.agentId)
      : null;
  const openChallengeCount = await countOpenChallengesVisibleTo(actor);

  return {
    viewer: toViewer(actor),
    activeMatch,
    openChallengeCount,
    generatedAt: new Date().toISOString(),
  };
}

async function getMatchById(actor: MatchActor, matchId: string): Promise<MatchView> {
  const row = await requireOwnedMatch(matchId, actor.agentId);
  return presentMatch(row, actor.agentId);
}

async function acceptOpenChallenge(
  actor: MatchActor,
  matchId: string,
): Promise<MatchView> {
  await reconcileLatestActiveMatchForAgent(actor.agentId);

  const supabase = createAdminClient();
  await assertInviteAcceptable(matchId, actor.userId);
  const acceptedAt = new Date();
  const { data, error } = await supabase
    .rpc("accept_open_match", {
      p_match_id: matchId,
      p_opponent_user_id: actor.userId,
      p_opponent_agent_id: actor.agentId,
      p_opponent_smart_account_address: actor.smartAccountAddress,
      p_accepted_at: acceptedAt.toISOString(),
    })
    .single();

  if (error || !data) {
    throw mapMatchMutationError(
      error,
      "Challenge was already accepted or is no longer available.",
    );
  }

  const row = data as unknown as MatchRow;
  await recordMatchEvent(row, "challenge.accepted", {
    creatorAgentId: row.creator_agent_id,
    opponentAgentId: actor.agentId,
  });

  return presentMatch(row, actor.agentId);
}

async function cancelOpenChallenge(
  actor: MatchActor,
  matchId: string,
): Promise<MatchView> {
  const row = await requireOwnedMatch(matchId, actor.agentId);

  if (row.creator_agent_id !== actor.agentId) {
    throw new MatchServiceError("Only the challenge creator can cancel it.", 403);
  }

  if (row.status !== "created" || row.opponent_agent_id) {
    throw new MatchServiceError(
      "Only open, unaccepted challenges can be canceled.",
      409,
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("matches")
    .update({
      status: "canceled",
      result_summary: {
        outcome: "canceled",
        reason: "creator_withdrew_open_challenge",
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("creator_agent_id", actor.agentId)
    .eq("status", "created")
    .is("opponent_agent_id", null)
    .select(MATCH_COLUMNS)
    .single();

  if (error || !data) {
    throw new MatchServiceError("Failed to cancel open challenge.", 409);
  }

  const canceled = data as unknown as MatchRow;
  await recordMatchEvent(canceled, "challenge.canceled", {
    creatorAgentId: actor.agentId,
    creatorUserId: actor.userId,
  });

  return presentMatch(canceled, actor.agentId);
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
  // Both helpers are cached in ens-service, so polling match state in a
  // loop no longer forces round-trips for every participant every call.
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

  // Parallelize the two ENS resolutions; both are cached after first hit.
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

async function countOpenChallengesVisibleTo(actor: MatchActor): Promise<number> {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("status", "created")
    .is("opponent_agent_id", null)
    .neq("creator_agent_id", actor.agentId)
    .or(`invited_user_id.is.null,invited_user_id.eq.${actor.userId}`);

  if (error) {
    throw new MatchServiceError("Failed to count open challenges.", 500);
  }

  return count ?? 0;
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

async function requireOpenChallenge(matchId: string): Promise<MatchRow> {
  const row = await fetchMatchRow(matchId);
  if (row.status !== "created" || row.opponent_agent_id) {
    throw new MatchServiceError("Challenge is no longer open.", 409);
  }

  return row;
}

async function assertInviteAcceptable(
  matchId: string,
  acceptingUserId: string,
): Promise<void> {
  const row = await requireOpenChallenge(matchId);
  if (row.invited_user_id && row.invited_user_id !== acceptingUserId) {
    throw new MatchServiceError("This invite is for a different user.", 403);
  }
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

async function reconcileLatestActiveMatchForAgent(
  agentId: string,
): Promise<MatchRow | null> {
  const row = await findLatestMatchForAgent(agentId);
  return row ? reconcilePersistedMatch(row) : null;
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
    notifyArenaMatchmakingUpdate(row, eventType, payload),
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
      nextRecommendedTool: "moonjoy_auto",
    },
  });
}

async function notifyArenaMatchmakingUpdate(
  row: MatchRow,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (eventType !== "challenge.created" && eventType !== "challenge.canceled") {
    return;
  }

  await notifyArenaMatchmakingSessions({
    eventType,
    matchId: row.id,
    status: row.status,
    payload: {
      ...payload,
      nextRecommendedTool: "moonjoy_auto",
      reason:
        eventType === "challenge.created"
          ? "A new open challenge is available. Re-read match state and coordinate through moonjoy_auto."
          : "An open challenge changed. Re-read match state and coordinate through moonjoy_auto.",
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

function matchStateToInsertRow(state: MatchState): Record<string, unknown> {
  return {
    id: state.id,
    creator_user_id: state.creator.userId,
    creator_agent_id: state.creator.agentId,
    creator_smart_account_address: state.creator.smartAccountAddress,
    invited_user_id: null,
    invite_code: null,
    opponent_user_id: state.opponent?.userId ?? null,
    opponent_agent_id: state.opponent?.agentId ?? null,
    opponent_smart_account_address: state.opponent?.smartAccountAddress ?? null,
    status: state.status,
    wager_usd: state.config.wagerUsd,
    live_duration_seconds: state.config.durationSeconds,
    warmup_duration_seconds: state.config.warmupSeconds,
    settlement_grace_seconds: state.config.settlementGraceSeconds,
    starting_capital_usd: state.config.startingCapitalUsd,
    winner_seat: null,
    winner_agent_id: null,
    result_summary: {},
    created_at: state.timing.createdAt.toISOString(),
    warmup_started_at: null,
    live_started_at: null,
    live_ends_at: null,
    settling_started_at: null,
    settled_at: null,
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

function mapMatchMutationError(
  error: { code?: string; message?: string } | null,
  fallbackMessage: string,
): MatchServiceError {
  if (!error) {
    return new MatchServiceError(fallbackMessage, 500);
  }

  if (error.code === "P0001") {
    return new MatchServiceError(error.message ?? fallbackMessage, 409);
  }

  return new MatchServiceError(fallbackMessage, 500);
}
