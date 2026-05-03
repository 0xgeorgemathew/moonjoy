import { deriveMatchPhase, type MatchPhase } from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLeaderboardForMatch } from "@/lib/services/leaderboard-service";
import {
  getActiveTokensForMatch,
  type TokenInfo,
} from "@/lib/services/token-universe-service";
import { getActiveMatchSnapshotForUser } from "@/lib/services/match-service";
import { getOpenInviteForUser } from "@/lib/services/invite-service";
import { listStrategies } from "@/lib/services/agent-bootstrap-service";
import { buildMatchReadiness } from "@/lib/services/match-readiness-service";
import { resolveUser } from "@/lib/services/ens-resolution-service";
import { getFullNameForAddress } from "@/lib/services/ens-service";
import type { Address } from "viem";
import type { McpRuntimeContext } from "@/lib/types/mcp";
import type { StrategyRecord } from "@/lib/types/strategy";
import type {
  ArenaSnapshot,
  ArenaStrategySummary,
  LiveMatchData,
  PlanningMessage,
  EnrichedTrade,
  MandatoryWindowResult,
  ArenaEventLogEntry,
} from "@/lib/types/arena";
import type { MatchView, MatchViewer } from "@/lib/types/match";
import type { PortfolioView } from "@/lib/types/trading";
import type { InviteView } from "@/lib/services/invite-service";

export class ArenaServiceError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

export async function getArenaSnapshot(privyUserId: string): Promise<ArenaSnapshot> {
  const supabase = createAdminClient();

  const { data: userRow } = await supabase
    .from("users")
    .select("id, privy_user_id, embedded_signer_address")
    .eq("privy_user_id", privyUserId)
    .maybeSingle();

  if (!userRow) {
    return buildUnauthenticatedSnapshot();
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

  const { data: approvalRow } = agent
    ? await supabase
        .from("mcp_approvals")
        .select("id")
        .eq("agent_id", agent.id)
        .eq("status", "active")
        .maybeSingle()
    : { data: null };

  const hasMcpApproval = Boolean(approvalRow);

  let userEnsName: string | null = null;
  let agentEnsName: string | null = null;

  if (signerAddress) {
    const userResolution = await resolveUser(userId);
    userEnsName = userResolution.ensName ?? null;
  }

  if (agent?.smart_account_address) {
    agentEnsName = await getFullNameForAddress(agent.smart_account_address as Address);
  }

  const readiness = buildMatchReadiness({
    hasUser: true,
    hasAgent: Boolean(agent),
    hasSmartAccount: Boolean(agent?.smart_account_address),
    hasMcpApproval,
    hasUserEns: Boolean(userEnsName),
    hasAgentEns: Boolean(agentEnsName),
  });

  let strategies: ArenaStrategySummary[] = [];
  if (agent && hasMcpApproval) {
    try {
      const stratResult = await listStrategies(
        {
          agentId: agent.id,
          userId,
          privyUserId,
          approvalId: "",
          smartAccountAddress: agent.smart_account_address ?? "",
          subject: "",
          clientName: "Moonjoy Arena",
          scopes: [],
          executionSignerId: null,
          executionKeyExpiresAt: null,
        } satisfies McpRuntimeContext,
        false,
      );
      const strategyRows = Array.isArray(stratResult.strategies)
        ? (stratResult.strategies as StrategyRecord[])
        : [];
      strategies = strategyRows.map((s) => ({
        id: s.id,
        name: s.name,
        sourceType: s.source_type,
        status: s.status,
        createdAt: s.created_at,
      }));
    } catch {
      // Strategies may fail if bootstrap is incomplete
    }
  }

  const viewer: MatchViewer = {
    userId,
    agentId: agent?.id ?? "",
    userEnsName: userEnsName ?? "",
    agentEnsName: agentEnsName ?? "",
    agentTopic: agent ? `mcp:agent:${agent.id}:events` : "",
  };

  let activeMatch: MatchView | null = null;
  if (agent?.smart_account_address && hasMcpApproval) {
    try {
      const snap = await getActiveMatchSnapshotForUser(privyUserId);
      activeMatch = snap.activeMatch;
    } catch {
      // Active match may fail if setup incomplete
    }
  }

  let openInvite: InviteView | null = null;
  if (!activeMatch && agent?.smart_account_address && hasMcpApproval) {
    try {
      openInvite = await getOpenInviteForUser(privyUserId);
    } catch {
      // Invite may fail
    }
  }

  const planning = await loadPlanningMessages(supabase, userId, agent?.id ?? null);

  let live: LiveMatchData | null = null;
  if (activeMatch && activeMatch.status !== "created" && activeMatch.status !== "canceled") {
    live = await buildLiveData(activeMatch, agent?.id ?? null);
  }

  return {
    viewer,
    readiness,
    planning,
    strategies,
    activeMatch,
    openInvite,
    live,
    generatedAt: new Date().toISOString(),
  };
}

export async function appendPlanningMessage(
  privyUserId: string,
  input: {
    role: "user" | "agent" | "system";
    content: string;
    matchId?: string;
    strategyId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<PlanningMessage> {
  const supabase = createAdminClient();

  const { data: userRow } = await supabase
    .from("users")
    .select("id, privy_user_id")
    .eq("privy_user_id", privyUserId)
    .single();

  if (!userRow) {
    throw new ArenaServiceError("User not found.", 404);
  }

  const userId = (userRow as { id: string }).id;

  const { data: agentRow } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  const agentId = (agentRow as { id: string } | null)?.id ?? "";

  const { data, error } = await supabase
    .from("strategy_planning_messages")
    .insert({
      agent_id: agentId,
      user_id: userId,
      role: input.role,
      content: input.content,
      match_id: input.matchId ?? null,
      strategy_id: input.strategyId ?? null,
      metadata: input.metadata ?? {},
    })
    .select("id, agent_id, user_id, match_id, strategy_id, role, content, metadata, created_at")
    .single();

  if (error || !data) {
    throw new ArenaServiceError("Failed to append planning message.", 500);
  }

  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    userId: row.user_id as string,
    matchId: row.match_id as string | null,
    strategyId: row.strategy_id as string | null,
    role: row.role as "user" | "agent" | "system",
    content: row.content as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at as string,
  };
}

function buildUnauthenticatedSnapshot(): ArenaSnapshot {
  return {
    viewer: { userId: "", agentId: "", userEnsName: "", agentEnsName: "", agentTopic: "" },
    readiness: {
      hasUser: false,
      hasAgent: false,
      hasSmartAccount: false,
      hasMcpApproval: false,
      hasUserEns: false,
      hasAgentEns: false,
      ready: false,
      blockers: ["Not authenticated"],
    },
    planning: [],
    strategies: [],
    activeMatch: null,
    openInvite: null,
    live: null,
    generatedAt: new Date().toISOString(),
  };
}

async function loadPlanningMessages(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  agentId: string | null,
): Promise<PlanningMessage[]> {
  let query = supabase
    .from("strategy_planning_messages")
    .select("id, agent_id, user_id, match_id, strategy_id, role, content, metadata, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (agentId) {
    query = query.eq("agent_id", agentId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    agentId: row.agent_id as string,
    userId: row.user_id as string,
    matchId: row.match_id as string | null,
    strategyId: row.strategy_id as string | null,
    role: row.role as "user" | "agent" | "system",
    content: row.content as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at as string,
  }));
}

async function buildLiveData(
  match: MatchView,
  viewerAgentId: string | null,
): Promise<LiveMatchData | null> {
  if (!viewerAgentId) return null;

  const supabase = createAdminClient();

  let phase: MatchPhase = match.status as MatchPhase;
  let elapsedSeconds = 0;
  let remainingSeconds = 0;

  if (match.status === "live" && match.liveStartedAt && match.liveEndsAt) {
    const now = Date.now();
    const startedAt = new Date(match.liveStartedAt).getTime();
    const endsAt = new Date(match.liveEndsAt).getTime();
    elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    remainingSeconds = Math.max(0, Math.floor((endsAt - now) / 1000));
    phase = deriveMatchPhase(
      match.status as "created" | "warmup" | "live" | "settling" | "settled" | "canceled",
      new Date(match.liveStartedAt),
      new Date(match.liveEndsAt),
      new Date(),
    );
  } else if (match.status === "warmup" && match.warmupStartedAt) {
    const now = Date.now();
    const startedAt = new Date(match.warmupStartedAt).getTime();
    const warmupEnd = startedAt + match.warmupDurationSeconds * 1000;
    elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    remainingSeconds = Math.max(0, Math.floor((warmupEnd - now) / 1000));
  }

  const [enrichedTrades, leaderboard, allowedTokens, windowResults, eventLog] = await Promise.all([
    loadEnrichedTrades(supabase, match.id),
    getLeaderboardForMatch(match.id).catch(() => []),
    getActiveTokensForMatch(match.id).catch(() => []),
    loadMandatoryWindowResults(supabase, match.id),
    loadEventLog(supabase, match.id),
  ]);

  const mandatoryWindows = buildMandatoryWindows(match);

  // Fetch portfolios by seat, not by viewer perspective
  // This ensures each panel always shows the correct agent's valuation
  const creatorPortfolio = await buildPortfolioView(match.id, match.creator.agentId, match.startingCapitalUsd);
  const opponentPortfolio = match.opponent
    ? await buildPortfolioView(match.id, match.opponent.agentId, match.startingCapitalUsd)
    : null;

  return {
    match,
    phase,
    elapsedSeconds,
    remainingSeconds,
    mandatoryWindows,
    mandatoryWindowResults: windowResults,
    trades: enrichedTrades,
    leaderboard,
    creatorPortfolio,
    opponentPortfolio,
    allowedTokens: allowedTokens.map((t: TokenInfo) => ({
      address: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
      riskTier: t.riskTier,
    })),
    eventLog,
  };
}

async function loadEnrichedTrades(
  supabase: ReturnType<typeof createAdminClient>,
  matchId: string,
): Promise<EnrichedTrade[]> {
  const { data: trades } = await supabase
    .from("simulated_trades")
    .select("id, agent_id, seat, phase, token_in, token_out, amount_in, quoted_amount_out, simulated_amount_out, slippage_bps, quote_snapshot_id, status, failure_reason, accepted_at, trade_side, realized_pnl_usd, closed_cost_basis_usd, input_value_usd, output_value_usd, retryable")
    .eq("match_id", matchId)
    .order("accepted_at", { ascending: true });

  if (!trades || trades.length === 0) return [];

  const quoteSnapshotIds = trades
    .map((t) => t.quote_snapshot_id as string)
    .filter(Boolean);

  const quoteMap: Record<string, Record<string, unknown>> = {};
  if (quoteSnapshotIds.length > 0) {
    const { data: quotes } = await supabase
      .from("quote_snapshots")
      .select("id, routing, route_summary, gas_estimate, gas_fee_usd, price_impact_bps, fetched_at")
      .in("id", quoteSnapshotIds);
    if (quotes) {
      for (const q of quotes) {
        quoteMap[q.id as string] = q;
      }
    }
  }

  return trades.map((t) => {
    const row = t as Record<string, unknown>;
    const qid = row.quote_snapshot_id as string | null;
    const quote = qid && quoteMap[qid]
      ? {
          routing: quoteMap[qid].routing as string,
          routeSummary: (quoteMap[qid].route_summary ?? {}) as Record<string, unknown>,
          gasEstimate: quoteMap[qid].gas_estimate as string | null,
          gasFeeUsd: quoteMap[qid].gas_fee_usd as number | null,
          priceImpactBps: quoteMap[qid].price_impact_bps as number | null,
          fetchedAt: quoteMap[qid].fetched_at as string,
        }
      : null;
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      seat: row.seat as "creator" | "opponent",
      phase: row.phase as string,
      tokenIn: row.token_in as string,
      tokenOut: row.token_out as string,
      amountIn: row.amount_in as string,
      quotedAmountOut: row.quoted_amount_out as string,
      simulatedAmountOut: row.simulated_amount_out as string,
      slippageBps: row.slippage_bps as number,
      tradeSide: (row.trade_side ?? null) as "buy" | "sell" | "swap" | "exit" | null,
      realizedPnlUsd: row.realized_pnl_usd == null ? null : Number(row.realized_pnl_usd),
      closedCostBasisUsd: row.closed_cost_basis_usd == null ? null : Number(row.closed_cost_basis_usd),
      inputValueUsd: row.input_value_usd == null ? null : Number(row.input_value_usd),
      outputValueUsd: row.output_value_usd == null ? null : Number(row.output_value_usd),
      retryable: Boolean(row.retryable ?? true),
      status: row.status as "accepted" | "rejected",
      failureReason: row.failure_reason as string | null,
      acceptedAt: row.accepted_at as string,
      quote,
    };
  });
}

async function loadMandatoryWindowResults(
  supabase: ReturnType<typeof createAdminClient>,
  matchId: string,
): Promise<MandatoryWindowResult[]> {
  const { data } = await supabase
    .from("mandatory_window_results")
    .select("window_name, completed, penalty_usd, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });

  if (!data) return [];
  return data.map((r) => ({
    windowName: r.window_name as "opening_window" | "closing_window",
    completed: Boolean(r.completed),
    penaltyUsd: Number(r.penalty_usd),
    assessedAt: r.created_at as string,
  }));
}

async function loadEventLog(
  supabase: ReturnType<typeof createAdminClient>,
  matchId: string,
): Promise<ArenaEventLogEntry[]> {
  const { data } = await supabase
    .from("match_events")
    .select("id, event_type, payload, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true })
    .limit(50);

  if (!data) return [];
  return data.map((e) => ({
    id: e.id as string,
    eventType: e.event_type as string,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    createdAt: e.created_at as string,
  }));
}

function buildMandatoryWindows(match: MatchView): LiveMatchData["mandatoryWindows"] {
  if (!match.liveStartedAt || !match.liveEndsAt) return [];

  const startedAt = new Date(match.liveStartedAt);
  const endsAt = new Date(match.liveEndsAt);

  return [
    {
      name: "opening_window",
      startsAt: startedAt.toISOString(),
      endsAt: new Date(startedAt.getTime() + 60_000).toISOString(),
      completed: false,
    },
    {
      name: "closing_window",
      startsAt: new Date(endsAt.getTime() - 60_000).toISOString(),
      endsAt: endsAt.toISOString(),
      completed: false,
    },
  ];
}

async function buildPortfolioView(
  matchId: string,
  agentId: string,
  startingCapitalUsd: number,
): Promise<PortfolioView | null> {
  const supabase = createAdminClient();

  const { data: valSnap } = await supabase
    .from("portfolio_valuation_snapshots")
    .select("*")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!valSnap) {
    return null;
  }

  const v = valSnap as Record<string, unknown>;
  const snapshotBalances = (v.balances ?? []) as Array<{
    tokenAddress: string;
    symbol: string;
    decimals: number;
    amountBaseUnits: string;
    valueUsd: number;
    costBasisUsd?: number;
    unrealizedPnlUsd?: number;
    exitableAmountBaseUnits?: string;
    exposurePercent?: number;
    priceSource: string;
    quoteId: string | null;
  }>;

  return {
    startingValueUsd: Number(v.starting_value_usd ?? startingCapitalUsd),
    currentValueUsd: Number(v.current_value_usd ?? startingCapitalUsd),
    usdcBalanceUsd: Number(v.usdc_balance_usd ?? 0),
    realizedPnlUsd: Number(v.realized_pnl_usd ?? 0),
    unrealizedPnlUsd: Number(v.unrealized_pnl_usd ?? 0),
    totalPnlUsd: Number(v.total_pnl_usd ?? 0),
    pnlPercent: Number(v.pnl_percent ?? 0),
    penaltiesUsd: Number(v.penalties_usd ?? 0),
    penaltyImpactUsd: -Number(v.penalties_usd ?? 0),
    netScoreUsd: Number(v.total_pnl_usd ?? 0) - Number(v.penalties_usd ?? 0),
    netScorePercent: Number(v.net_score_percent ?? 0),
    stale: Boolean(v.stale),
    balances: snapshotBalances.map((b) => ({
      tokenAddress: b.tokenAddress,
      amountBaseUnits: b.amountBaseUnits,
      symbol: b.symbol ?? "",
      valueUsd: b.valueUsd ?? 0,
      costBasisUsd: b.costBasisUsd ?? 0,
      unrealizedPnlUsd: b.unrealizedPnlUsd ?? 0,
      exitableAmountBaseUnits: b.exitableAmountBaseUnits ?? b.amountBaseUnits,
      exposurePercent: b.exposurePercent ?? 0,
    })),
  };
}
