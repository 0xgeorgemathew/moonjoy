import { deriveMatchPhase, type MatchPhase } from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLeaderboardForMatch, type LeaderboardEntry } from "@/lib/services/leaderboard-service";
import { getTradeHistoryForMatch } from "@/lib/services/trade-service";
import { getAllBalances, getTotalPenalties } from "@/lib/services/portfolio-ledger-service";
import { getActiveTokensForMatch } from "@/lib/services/token-universe-service";
import { getActiveMatchSnapshotForUser, listOpenChallengesForUser } from "@/lib/services/match-service";
import { listStrategies } from "@/lib/services/agent-bootstrap-service";
import { requirePhaseThreeReadyUser } from "@/lib/services/mcp-auth-service";
import { resolveUser } from "@/lib/services/ens-resolution-service";
import { getFullNameForAddress } from "@/lib/services/ens-service";
import type { Address } from "viem";
import type {
  ArenaSnapshot,
  ArenaReadiness,
  ArenaStrategySummary,
  LiveMatchData,
  PlanningMessage,
} from "@/lib/types/arena";
import type { MatchView, MatchViewer } from "@/lib/types/match";
import type { PortfolioView } from "@/lib/types/trading";

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

  const readiness = buildReadiness({
    hasUser: true,
    hasAgent: Boolean(agent),
    hasSmartAccount: Boolean(agent?.smart_account_address),
    hasMcpApproval,
    hasUserEns: Boolean(userEnsName),
    hasAgentEns: Boolean(agentEnsName),
    hasStrategy: false,
  });

  let strategies: ArenaStrategySummary[] = [];
  if (agent && hasMcpApproval) {
    try {
      const stratResult = await listStrategies(
        { agentId: agent.id, userId } as any,
        false,
      );
      strategies = (stratResult as any[]).map((s: any) => ({
        id: s.id,
        name: s.name,
        sourceType: s.source_type ?? s.sourceType,
        status: s.status,
        createdAt: s.created_at ?? s.createdAt,
      }));
      readiness.hasStrategy = strategies.some((s) => s.status === "active");
      readiness.ready = readiness.hasStrategy && readiness.blockers.length === 0;
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

  let openChallenges = null;
  if (!activeMatch && agent?.smart_account_address && hasMcpApproval) {
    try {
      openChallenges = await listOpenChallengesForUser(privyUserId);
    } catch {
      // Challenges may fail
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
    openChallenges,
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
      hasStrategy: false,
      ready: false,
      blockers: ["Not authenticated"],
    },
    planning: [],
    strategies: [],
    activeMatch: null,
    openChallenges: null,
    live: null,
    generatedAt: new Date().toISOString(),
  };
}

function buildReadiness(flags: {
  hasUser: boolean;
  hasAgent: boolean;
  hasSmartAccount: boolean;
  hasMcpApproval: boolean;
  hasUserEns: boolean;
  hasAgentEns: boolean;
  hasStrategy: boolean;
}): ArenaReadiness {
  const blockers: string[] = [];
  if (!flags.hasUser) blockers.push("Sign in with Privy");
  if (!flags.hasAgent) blockers.push("Complete onboarding to create agent");
  if (!flags.hasSmartAccount) blockers.push("Agent smart account is missing");
  if (!flags.hasMcpApproval) blockers.push("Authorize an MCP client");
  if (!flags.hasUserEns) blockers.push("Claim your ENS name");
  if (!flags.hasAgentEns) blockers.push("Agent ENS identity bootstrap required");
  if (!flags.hasStrategy) blockers.push("Create an active strategy");

  return {
    ...flags,
    ready: blockers.length === 0,
    blockers,
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

  const [trades, leaderboard, allowedTokens] = await Promise.all([
    getTradeHistoryForMatch(match.id).catch(() => []),
    getLeaderboardForMatch(match.id).catch(() => []),
    getActiveTokensForMatch(match.id).catch(() => []),
  ]);

  const mandatoryWindows = buildMandatoryWindows(match);

  const viewerPortfolio = await buildPortfolioView(match.id, viewerAgentId, match.startingCapitalUsd);
  const opponentAgentId = match.viewerSeat === "creator" ? match.opponent?.agentId ?? null : match.creator.agentId;
  const opponentPortfolio = opponentAgentId
    ? await buildPortfolioView(match.id, opponentAgentId, match.startingCapitalUsd)
    : null;

  return {
    match,
    phase,
    elapsedSeconds,
    remainingSeconds,
    mandatoryWindows,
    trades,
    leaderboard,
    viewerPortfolio,
    opponentPortfolio,
    allowedTokens: allowedTokens.map((t: any) => ({
      address: t.address ?? t.token_address ?? "",
      symbol: t.symbol ?? "",
      decimals: t.decimals ?? 18,
      riskTier: t.risk_tier ?? t.riskTier ?? "blue_chip",
    })),
  };
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
  const balances = await getAllBalances(matchId, agentId);

  return {
    startingValueUsd: Number(v.starting_value_usd ?? startingCapitalUsd),
    currentValueUsd: Number(v.current_value_usd ?? startingCapitalUsd),
    realizedPnlUsd: Number(v.realized_pnl_usd ?? 0),
    unrealizedPnlUsd: Number(v.unrealized_pnl_usd ?? 0),
    totalPnlUsd: Number(v.total_pnl_usd ?? 0),
    pnlPercent: Number(v.pnl_percent ?? 0),
    penaltiesUsd: Number(v.penalties_usd ?? 0),
    netScoreUsd: Number(v.total_pnl_usd ?? 0) - Number(v.penalties_usd ?? 0),
    netScorePercent: Number(v.net_score_percent ?? 0),
    stale: Boolean(v.stale),
    balances: balances.map((b) => ({
      tokenAddress: b.tokenAddress,
      amountBaseUnits: b.amountBaseUnits,
      symbol: "",
      valueUsd: 0,
    })),
  };
}
