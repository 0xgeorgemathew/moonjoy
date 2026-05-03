import {
  deriveMatchPhase,
  isTradingAllowed,
} from "@moonjoy/game";
import { getAgentFundingStatus } from "@/lib/services/agent-funding-service";
import { resolveUser } from "@/lib/services/ens-resolution-service";
import {
  buildBootstrapRecommendationFromState,
  getAgentBootstrapState,
  runBootstrap,
  type BootstrapRecommendation,
} from "@/lib/services/agent-bootstrap-service";
import { getActiveMatchSnapshotForMcpContext } from "@/lib/services/match-service";
import { submitSimulatedTrade } from "@/lib/services/trade-service";
import { getTradeHistoryForMatch } from "@/lib/services/trade-service";
import { getLeaderboardForMatch } from "@/lib/services/leaderboard-service";
import { fetchExactInputQuote } from "@/lib/services/uniswap-quote-service";
import { getAllBalances, type BalanceDetail } from "@/lib/services/portfolio-ledger-service";
import { getActiveTokensForMatch } from "@/lib/services/token-universe-service";
import { tickActiveMatch } from "@/lib/services/worker-loop-service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { McpRuntimeContext } from "@/lib/types/mcp";

const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const DEFAULT_AUTO_TRADE_USDC_UNITS = BigInt(10_000_000);
const MIN_AUTO_TRADE_USDC_UNITS = BigInt(1_000_000);

export type MoonjoyIdentity = {
  user: {
    id: string;
    privyUserId: string;
    ensName: string | null;
    embeddedSignerAddress: string | null;
  };
  agent: {
    id: string;
    smartAccountAddress: string;
    ensName: string | null;
    mcpSubject: string;
    clientName: string;
  };
  readiness: {
    walletReady: boolean;
    userEnsReady: boolean;
    mcpApproved: boolean;
    bootstrapReady: boolean;
    fundingReady: boolean;
      agentIdentityReady: boolean;
      defaultStrategyReady: boolean;
      matchReady: boolean;
      matchReadinessReason: string;
    nextAllowedActions: string[];
  };
  funding: {
    nativeBalanceWei: string;
    nativeBalanceEth: string;
    theoreticalMaxGasReserveWei: string;
    theoreticalMaxGasReserveEth: string;
    gasReserveSatisfied: boolean;
    gasReserveShortfallWei: string;
    sponsoredForBootstrap: boolean;
    requiredForBootstrap: boolean;
    requiredForMatches: boolean;
  };
  bootstrap: {
    status: BootstrapRecommendation["status"];
    runToolName: "moonjoy_strategy:bootstrap_run" | null;
    shouldAutoRun: boolean;
    recommendedAction: BootstrapRecommendation;
    pendingTransactions: Awaited<
      ReturnType<typeof getAgentBootstrapState>
    >["pendingTransactions"];
  };
};

export async function getMoonjoyIdentity(
  context: McpRuntimeContext,
): Promise<MoonjoyIdentity> {
  const supabase = createAdminClient();

  const [userQuery, resolved, bootstrap, funding] = await Promise.all([
    supabase
      .from("users")
      .select("id, privy_user_id, embedded_signer_address")
      .eq("id", context.userId)
      .single(),
    resolveUser(context.userId),
    getAgentBootstrapState(context),
    getAgentFundingStatus(context.smartAccountAddress),
  ]);

  const user = userQuery.data;
  const recommendation = buildBootstrapRecommendationFromState(bootstrap);
  const userEnsReady =
    Boolean(resolved.ensName) &&
    Boolean(
      resolved.address &&
        user?.embedded_signer_address &&
        resolved.address.toLowerCase() ===
          user.embedded_signer_address.toLowerCase(),
    );
  const bootstrapGasSponsored = true;
  const fundingReady = true;
  const agentIdentityReady =
    bootstrap.derivedAgentStatus === "ready" &&
    bootstrap.agentResolvesToSmartAccount &&
    bootstrap.agentOwnedBySmartAccount;
  const defaultStrategyReady =
    Boolean(bootstrap.activeStrategy) && bootstrap.strategyPointerMatches;
  const bootstrapReady = agentIdentityReady && defaultStrategyReady;
  const matchReady = bootstrapReady;

  return {
    user: {
      id: context.userId,
      privyUserId: context.privyUserId,
      ensName: resolved.ensName,
      embeddedSignerAddress: user?.embedded_signer_address ?? null,
    },
    agent: {
      id: context.agentId,
      smartAccountAddress: context.smartAccountAddress,
      ensName: bootstrap.agentEnsName,
      mcpSubject: context.subject,
      clientName: context.clientName,
    },
    readiness: {
      walletReady: Boolean(context.smartAccountAddress),
      userEnsReady,
      mcpApproved: true,
      bootstrapReady,
      fundingReady,
      agentIdentityReady,
      defaultStrategyReady,
      matchReady,
      matchReadinessReason: matchReady
        ? "Match lifecycle is live. Funding checks remain informational until quote-backed simulation lands."
        : "Finish ENS identity and default strategy bootstrap before the agent enters matches.",
      nextAllowedActions: getNextAllowedActions(bootstrap, fundingReady),
    },
    funding: {
      nativeBalanceWei: funding.nativeBalanceWei,
      nativeBalanceEth: funding.nativeBalanceEth,
      theoreticalMaxGasReserveWei: funding.theoreticalMaxGasReserveWei,
      theoreticalMaxGasReserveEth: funding.theoreticalMaxGasReserveEth,
      gasReserveSatisfied: funding.gasReserveSatisfied,
      gasReserveShortfallWei: funding.gasReserveShortfallWei,
      sponsoredForBootstrap: bootstrapGasSponsored,
      requiredForBootstrap: false,
      requiredForMatches: false,
    },
    bootstrap: {
      status: recommendation.status,
      runToolName:
        recommendation.status === "actionable" ? "moonjoy_strategy:bootstrap_run" : null,
      shouldAutoRun: recommendation.status === "actionable",
      recommendedAction: recommendation,
      pendingTransactions: bootstrap.pendingTransactions,
    },
  };
}

export async function getMoonjoyMatchStateForContext(
  context: McpRuntimeContext,
): Promise<{
  viewer: Awaited<ReturnType<typeof getActiveMatchSnapshotForMcpContext>>["viewer"];
  activeMatch: Awaited<ReturnType<typeof getActiveMatchSnapshotForMcpContext>>["activeMatch"];
  nextRecommendedTool: string | null;
  nextActionReason: string;
}> {
  const snapshot = await getActiveMatchSnapshotForMcpContext(context);

  if (snapshot.activeMatch?.status === "live") {
    return {
      ...snapshot,
      nextRecommendedTool: "moonjoy_match:action=play_turn",
      nextActionReason: "Live match is active. Keep trading.",
    };
  }

  if (snapshot.activeMatch) {
    return {
      ...snapshot,
      nextRecommendedTool: "moonjoy_match:action=heartbeat",
      nextActionReason: `Active match ${snapshot.activeMatch.id} in status=${snapshot.activeMatch.status}.`,
    };
  }

  return {
    ...snapshot,
    nextRecommendedTool: "moonjoy_match:action=heartbeat",
    nextActionReason: "No active match. Wait for a human to create an invite.",
  };
}

export async function runMoonjoyHeartbeat(
  context: McpRuntimeContext,
): Promise<{
  status: "no_match" | "active" | "live";
  actions: Array<{ name: string; detail?: unknown }>;
  identity: MoonjoyIdentity;
  match: Awaited<ReturnType<typeof getActiveMatchSnapshotForMcpContext>> | null;
  note: string;
}> {
  const actions: Array<{ name: string; detail?: unknown }> = [];
  const identity = await getMoonjoyIdentity(context);

  if (identity.bootstrap.shouldAutoRun) {
    const result = await runBootstrap(context);
    actions.push({ name: "moonjoy_strategy:bootstrap_run", detail: result });
  }

  const snapshot = await getActiveMatchSnapshotForMcpContext(context);

  if (!snapshot.activeMatch) {
    return {
      status: "no_match",
      actions,
      identity,
      match: snapshot,
      note: "No active match. Agents cannot create invites. Wait for a human to create one.",
    };
  }

  if (snapshot.activeMatch.status === "live") {
    return {
      status: "live",
      actions,
      identity,
      match: snapshot,
      note: "Live match is active.",
    };
  }

  return {
    status: "active",
    actions,
    identity,
    match: snapshot,
    note: `Active match ${snapshot.activeMatch.id} in status=${snapshot.activeMatch.status}.`,
  };
}

export async function playMoonjoyTurn(
  context: McpRuntimeContext,
): Promise<{
  status: "no_match" | "active" | "traded" | "no_trade";
  phase: string | null;
  timeRemainingSeconds: number | null;
  currentPortfolio: Awaited<ReturnType<typeof getMoonjoyPortfolio>> | null;
  lastTrade: { status: string; reason?: string } | null;
  alreadyTradedThisPhase: boolean;
  nextRecommendedTools: string[];
  actions: Array<{ name: string; detail?: unknown }>;
  identity: MoonjoyIdentity;
  match: Awaited<ReturnType<typeof getActiveMatchSnapshotForMcpContext>> | null;
  note: string;
}> {
  const actions: Array<{ name: string; detail?: unknown }> = [];
  const identity = await getMoonjoyIdentity(context);

  if (identity.bootstrap.shouldAutoRun) {
    const result = await runBootstrap(context);
    actions.push({ name: "moonjoy_strategy:bootstrap_run", detail: result });
  }

  const snapshot = await getActiveMatchSnapshotForMcpContext(context);

  if (!snapshot.activeMatch) {
    return {
      status: "no_match",
      phase: null,
      timeRemainingSeconds: null,
      currentPortfolio: null,
      lastTrade: null,
      alreadyTradedThisPhase: false,
      nextRecommendedTools: ["moonjoy_match:action=heartbeat"],
      actions,
      identity,
      match: snapshot,
      note: "No active match. Agents cannot create invites. Wait for a human to create one.",
    };
  }

  if (snapshot.activeMatch.status === "warmup") {
    return {
      status: "active",
      phase: "warmup",
      timeRemainingSeconds: snapshot.activeMatch.warmupStartedAt
        ? Math.max(0, snapshot.activeMatch.warmupDurationSeconds - Math.floor((Date.now() - new Date(snapshot.activeMatch.warmupStartedAt).getTime()) / 1000))
        : null,
      currentPortfolio: null,
      lastTrade: null,
      alreadyTradedThisPhase: false,
      nextRecommendedTools: [
        "moonjoy_market:action=dexscreener_search",
        "moonjoy_market:action=validate_candidate",
        "moonjoy_match:action=prepare",
        "moonjoy_match:action=heartbeat",
      ],
      actions,
      identity,
      match: snapshot,
      note: `Warmup phase. Prepare strategy and discover candidates. Match ${snapshot.activeMatch.id}.`,
    };
  }

  if (snapshot.activeMatch.status === "settling" || snapshot.activeMatch.status === "settled") {
    return {
      status: "active",
      phase: snapshot.activeMatch.status,
      timeRemainingSeconds: null,
      currentPortfolio: null,
      lastTrade: null,
      alreadyTradedThisPhase: false,
      nextRecommendedTools: [
        "moonjoy_match:action=heartbeat",
        "moonjoy_strategy:action=record_decision",
        "moonjoy_status:section=portfolio",
      ],
      actions,
      identity,
      match: snapshot,
      note: `Match in ${snapshot.activeMatch.status} phase. Record final rationale.`,
    };
  }

  if (snapshot.activeMatch.status !== "live") {
    return {
      status: "active",
      phase: snapshot.activeMatch.status,
      timeRemainingSeconds: null,
      currentPortfolio: null,
      lastTrade: null,
      alreadyTradedThisPhase: false,
      nextRecommendedTools: ["moonjoy_match:action=heartbeat"],
      actions,
      identity,
      match: snapshot,
      note: `Active match ${snapshot.activeMatch.id} in status=${snapshot.activeMatch.status}. Not live yet.`,
    };
  }

  const autoTrade = await maybeSubmitLiveAutoTrade(context, snapshot.activeMatch);
  actions.push(...autoTrade.actions);

  let phase: string | null = null;
  let timeRemainingSeconds: number | null = null;
  let alreadyTradedThisPhase = false;

  if (snapshot.activeMatch.liveStartedAt && snapshot.activeMatch.liveEndsAt) {
    const now = new Date();
    phase = deriveMatchPhase(
      "live",
      new Date(snapshot.activeMatch.liveStartedAt),
      new Date(snapshot.activeMatch.liveEndsAt),
      now,
    );
    timeRemainingSeconds = Math.max(0, Math.floor((new Date(snapshot.activeMatch.liveEndsAt).getTime() - now.getTime()) / 1000));

    if (autoTrade.traded) {
      alreadyTradedThisPhase = false;
    } else {
      const supabase = createAdminClient();
      const { data: existingTrades } = await supabase
        .from("simulated_trades")
        .select("id, phase")
        .eq("match_id", snapshot.activeMatch.id)
        .eq("agent_id", context.agentId)
        .eq("status", "accepted")
        .eq("phase", phase);
      alreadyTradedThisPhase = (existingTrades?.length ?? 0) > 0;
    }
  }

  let currentPortfolio: Awaited<ReturnType<typeof getMoonjoyPortfolio>> | null = null;
  try { currentPortfolio = await getMoonjoyPortfolio(context); } catch {}

  const recommendedTools = autoTrade.traded
    ? [
        "moonjoy_match:action=play_turn",
        "moonjoy_status:section=portfolio",
        "moonjoy_status:section=leaderboard",
        "moonjoy_strategy:action=record_decision",
      ]
    : alreadyTradedThisPhase
      ? [
          "moonjoy_match:action=play_turn",
          "moonjoy_market:action=dexscreener_search",
          "moonjoy_market:action=validate_candidate",
          "moonjoy_status:section=portfolio",
        ]
      : [
          "moonjoy_market:action=dexscreener_search",
          "moonjoy_market:action=validate_candidate",
          "moonjoy_market:action=quote",
          "moonjoy_market:action=submit_trade",
          "moonjoy_match:action=play_turn",
        ];

  return {
    status: autoTrade.traded ? "traded" : "no_trade",
    phase,
    timeRemainingSeconds,
    currentPortfolio,
    lastTrade: autoTrade.traded
      ? { status: "accepted" }
      : autoTrade.actions.find((a) => a.name.includes("rejected"))
        ? { status: "rejected", reason: autoTrade.note }
        : null,
    alreadyTradedThisPhase,
    nextRecommendedTools: recommendedTools,
    actions,
    identity,
    match: autoTrade.match,
    note: autoTrade.note,
  };
}

export async function getMoonjoyPortfolio(
  context: McpRuntimeContext,
): Promise<{
  owner: string;
  status: "not_started" | "active" | "settled";
  startingValueUsd: number;
  currentValueUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  pnlPercent: number;
  penaltiesUsd: number;
  penaltyImpactUsd: number;
  netScoreUsd: number;
  netScorePercent: number;
  balances: Array<{
    tokenAddress: string;
    symbol: string;
    amountBaseUnits: string;
    valueUsd: number;
    costBasisUsd: number;
    unrealizedPnlUsd: number;
    exitableAmountBaseUnits: string;
    exposurePercent: number;
    suggestedExitToken: string;
  }>;
  message: string;
}> {
  const supabase = createAdminClient();

  const { data: activeMatch } = await supabase
    .from("matches")
    .select("id, status, starting_capital_usd, live_started_at")
    .or(`creator_agent_id.eq.${context.agentId},opponent_agent_id.eq.${context.agentId}`)
    .in("status", ["live", "settling", "settled"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activeMatch) {
    const funding = await getAgentFundingStatus(context.smartAccountAddress);
    return {
      owner: context.smartAccountAddress,
      status: "not_started",
      startingValueUsd: 0,
      currentValueUsd: 0,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      totalPnlUsd: 0,
      pnlPercent: 0,
      penaltiesUsd: 0,
      penaltyImpactUsd: 0,
      netScoreUsd: 0,
      netScorePercent: 0,
      balances: [],
      message: "No active or settled match found.",
    };
  }

  const match = activeMatch as Record<string, unknown>;
  const matchId = match.id as string;
  const startingCapital = Number(match.starting_capital_usd);

  if (match.status === "settled") {
    const { data: lastValuation } = await supabase
      .from("portfolio_valuation_snapshots")
      .select("*")
      .eq("match_id", matchId)
      .eq("agent_id", context.agentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const v = lastValuation as Record<string, unknown> | null;
    return {
      owner: context.smartAccountAddress,
      status: "settled",
      startingValueUsd: startingCapital,
      currentValueUsd: v ? Number(v.current_value_usd) : startingCapital,
      realizedPnlUsd: v ? Number(v.realized_pnl_usd) : 0,
      unrealizedPnlUsd: v ? Number(v.unrealized_pnl_usd) : 0,
      totalPnlUsd: v ? Number(v.total_pnl_usd) : 0,
      pnlPercent: v ? Number(v.pnl_percent) : 0,
      penaltiesUsd: v ? Number(v.penalties_usd) : 0,
      penaltyImpactUsd: v ? -Number(v.penalties_usd) : 0,
      netScoreUsd: v
        ? Number(v.total_pnl_usd) - Number(v.penalties_usd)
        : 0,
      netScorePercent: v ? Number(v.net_score_percent) : 0,
      balances: extractPortfolioBalances(v),
      message:
        "Match settled. Final portfolio snapshot; penalties are negative dollar score adjustments.",
    };
  }

  const { data: lastVal } = await supabase
    .from("portfolio_valuation_snapshots")
    .select("*")
    .eq("match_id", matchId)
    .eq("agent_id", context.agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lv = lastVal as Record<string, unknown> | null;

  return {
    owner: context.smartAccountAddress,
    status: "active",
    startingValueUsd: startingCapital,
    currentValueUsd: lv ? Number(lv.current_value_usd) : startingCapital,
    realizedPnlUsd: lv ? Number(lv.realized_pnl_usd) : 0,
    unrealizedPnlUsd: lv ? Number(lv.unrealized_pnl_usd) : 0,
    totalPnlUsd: lv ? Number(lv.total_pnl_usd) : 0,
    pnlPercent: lv ? Number(lv.pnl_percent) : 0,
    penaltiesUsd: lv ? Number(lv.penalties_usd) : 0,
    penaltyImpactUsd: lv ? -Number(lv.penalties_usd) : 0,
    netScoreUsd: lv
      ? Number(lv.total_pnl_usd) - Number(lv.penalties_usd)
      : 0,
    netScorePercent: lv ? Number(lv.net_score_percent) : 0,
    balances: extractPortfolioBalances(lv),
    message:
      "Live portfolio. Agents may buy, sell, exit, and rotate quote-backed simulated positions; penalties are shown as negative dollar impact.",
  };
}

function extractPortfolioBalances(
  snapshot: Record<string, unknown> | null,
): Array<{
  tokenAddress: string;
  symbol: string;
  amountBaseUnits: string;
  valueUsd: number;
  costBasisUsd: number;
  unrealizedPnlUsd: number;
  exitableAmountBaseUnits: string;
  exposurePercent: number;
  suggestedExitToken: string;
}> {
  const balances = (snapshot?.balances ?? []) as BalanceDetail[];
  return balances.map((b) => ({
    tokenAddress: b.tokenAddress,
    symbol: b.symbol ?? "",
    amountBaseUnits: b.amountBaseUnits,
    valueUsd: b.valueUsd ?? 0,
    costBasisUsd: b.costBasisUsd ?? 0,
    unrealizedPnlUsd: b.unrealizedPnlUsd ?? 0,
    exitableAmountBaseUnits: b.exitableAmountBaseUnits ?? b.amountBaseUnits,
    exposurePercent: b.exposurePercent ?? 0,
    suggestedExitToken: b.tokenAddress.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase()
      ? ""
      : BASE_USDC_ADDRESS.toLowerCase(),
  }));
}

export async function getMoonjoyMarketQuote(
  context: McpRuntimeContext,
  params?: { tokenIn?: string; tokenOut?: string; amount?: string },
): Promise<{
  status: "ok" | "no_match" | "error";
  quote?: {
    snapshotId: string;
    outputAmount: string;
    routing: string;
    priceImpactBps: number | null;
    gasEstimate: string | null;
  };
  message: string;
}> {
  if (!params?.tokenIn || !params?.tokenOut || !params?.amount) {
    return {
      status: "no_match",
      message: "Provide tokenIn, tokenOut, and amount to get a quote.",
    };
  }

  try {
    const quote = await fetchExactInputQuote({
      swapper: context.smartAccountAddress as `0x${string}`,
      tokenIn: params.tokenIn as `0x${string}`,
      tokenOut: params.tokenOut as `0x${string}`,
      amountBaseUnits: params.amount,
      slippageBps: 100,
    });

    return {
      status: "ok",
      quote: {
        snapshotId: quote.snapshotId,
        outputAmount: quote.outputAmount,
        routing: quote.routing,
        priceImpactBps: quote.priceImpactBps,
        gasEstimate: quote.gasEstimate,
      },
      message: "Fresh Uniswap quote from Base mainnet. Simulated fill only.",
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Quote failed.",
    };
  }
}

export async function submitMoonjoyTrade(
  context: McpRuntimeContext,
  params: {
    matchId: string;
    tokenIn: string;
    tokenOut: string;
    amountInBaseUnits: string;
    quoteSnapshotId?: string;
  },
): Promise<{
  status: "accepted" | "rejected";
  tradeId?: string;
  outputAmount?: string;
  routing?: string;
  tradeSide?: Awaited<ReturnType<typeof submitSimulatedTrade>>["tradeSide"];
  tradeLabel?: Awaited<ReturnType<typeof submitSimulatedTrade>>["tradeLabel"];
  realizedPnlUsd?: number;
  retryable?: boolean;
  reason?: string;
  portfolioAfterTrade?: Awaited<ReturnType<typeof submitSimulatedTrade>>["portfolioAfterTrade"];
  message: string;
}> {
  const supabase = createAdminClient();

  const { data: match } = await supabase
    .from("matches")
    .select("creator_agent_id, opponent_agent_id, starting_capital_usd")
    .eq("id", params.matchId)
    .single();

  if (!match) {
    return { status: "rejected", reason: "Match not found.", message: "Match not found." };
  }

  const matchRow = match as Record<string, unknown>;
  const agentId = context.agentId;
  let seat: "creator" | "opponent";
  if (matchRow.creator_agent_id === agentId) {
    seat = "creator";
  } else if (matchRow.opponent_agent_id === agentId) {
    seat = "opponent";
  } else {
    return { status: "rejected", reason: "Not a participant.", message: "Not a participant." };
  }

  const result = await submitSimulatedTrade({
    matchId: params.matchId,
    agentId,
    smartAccountAddress: context.smartAccountAddress,
    seat,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountInBaseUnits: params.amountInBaseUnits,
    startingCapitalUsd: Number(matchRow.starting_capital_usd),
    quoteSnapshotId: params.quoteSnapshotId,
  });

  return {
    ...result,
    message:
      result.status === "accepted"
        ? `Simulated ${result.tradeLabel ?? result.tradeSide ?? "trade"} accepted from live Uniswap quote on Base mainnet. portfolioAfterTrade shows value, realized/unrealized PnL, penalty impact, and net score.`
        : `Trade rejected: ${result.reason}`,
  };
}

export async function getMoonjoyMatchLeaderboard(
  matchId: string,
) {
  return getLeaderboardForMatch(matchId);
}

export async function getMoonjoyTradeHistory(
  matchId: string,
  agentId?: string,
) {
  return getTradeHistoryForMatch(matchId, agentId);
}

export async function getMoonjoyAllowedTokens(
  matchId: string,
) {
  return getActiveTokensForMatch(matchId);
}

async function maybeSubmitLiveAutoTrade(
  context: McpRuntimeContext,
  activeMatch: NonNullable<
    Awaited<ReturnType<typeof getActiveMatchSnapshotForMcpContext>>["activeMatch"]
  >,
): Promise<{
  traded: boolean;
  actions: Array<{ name: string; detail?: unknown }>;
  match: Awaited<ReturnType<typeof getActiveMatchSnapshotForMcpContext>>;
  note: string;
}> {
  const actions: Array<{ name: string; detail?: unknown }> = [];

  const tick = await tickActiveMatch(activeMatch.id, new Date());
  actions.push({ name: "moonjoy_worker_tick", detail: tick });

  const match = await getActiveMatchSnapshotForMcpContext(context);
  const liveMatch = match.activeMatch;
  if (!liveMatch || liveMatch.status !== "live") {
    return {
      traded: false,
      actions,
      match,
      note: "Match is no longer live after heartbeat reconciliation.",
    };
  }

  if (!liveMatch.liveStartedAt || !liveMatch.liveEndsAt) {
    return {
      traded: false,
      actions,
      match,
      note: "Live match is missing timing data.",
    };
  }

  const now = new Date();
  const phase = deriveMatchPhase(
    "live",
    new Date(liveMatch.liveStartedAt),
    new Date(liveMatch.liveEndsAt),
    now,
  );

  if (!isTradingAllowed(phase)) {
    return {
      traded: false,
      actions,
      match,
      note: `Trading is not allowed in phase ${phase}.`,
    };
  }

  const supabase = createAdminClient();
  const { data: existingTrades } = await supabase
    .from("simulated_trades")
    .select("id, phase")
    .eq("match_id", liveMatch.id)
    .eq("agent_id", context.agentId)
    .eq("status", "accepted");

  const trades = (existingTrades ?? []) as Array<{ id: string; phase: string }>;
  const hasTradeInCurrentPhase = trades.some((trade) => trade.phase === phase);
  if (hasTradeInCurrentPhase) {
    return {
      traded: false,
      actions,
      match,
      note: `Already traded during ${phase}.`,
    };
  }

  const tradePlan = await buildAutoTradePlan(liveMatch.id, context.agentId, phase);
  if (!tradePlan) {
    return {
      traded: false,
      actions,
      match,
      note: "No valid auto-trade balance is available yet.",
    };
  }

  const result = await submitMoonjoyTrade(context, {
    matchId: liveMatch.id,
    tokenIn: tradePlan.tokenIn,
    tokenOut: tradePlan.tokenOut,
    amountInBaseUnits: tradePlan.amountInBaseUnits,
  });

  actions.push({
    name:
      result.status === "accepted"
        ? "moonjoy_market:submit_trade"
        : "moonjoy_market:submit_trade_rejected",
    detail: {
      phase,
      plan: tradePlan,
      result,
    },
  });

  const updatedMatch = await getActiveMatchSnapshotForMcpContext(context);
  return {
    traded: result.status === "accepted",
    actions,
    match: updatedMatch,
    note:
      result.status === "accepted"
        ? `Submitted ${phase} auto-trade from live Uniswap quote.`
        : `Auto-trade was rejected: ${result.reason ?? result.message}`,
  };
}

async function buildAutoTradePlan(
  matchId: string,
  agentId: string,
  phase: string,
): Promise<{
  tokenIn: string;
  tokenOut: string;
  amountInBaseUnits: string;
} | null> {
  const balances = await getAllBalances(matchId, agentId);
  const balanceFor = (tokenAddress: string): bigint => {
    const balance = balances.find(
      (entry) => entry.tokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
    );
    return BigInt(balance?.amountBaseUnits ?? "0");
  };

  const usdcBalance = balanceFor(BASE_USDC_ADDRESS);
  const nonUsdcBalance = balances.find(
    (entry) =>
      entry.tokenAddress.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase() &&
      BigInt(entry.amountBaseUnits) > BigInt(0),
  );

  if (nonUsdcBalance && (phase === "closing_window" || usdcBalance < MIN_AUTO_TRADE_USDC_UNITS)) {
    const heldAmount = BigInt(nonUsdcBalance.amountBaseUnits);
    const amountIn = phase === "closing_window" ? heldAmount : heldAmount / BigInt(2);
    if (amountIn > BigInt(0)) {
      return {
        tokenIn: nonUsdcBalance.tokenAddress,
        tokenOut: BASE_USDC_ADDRESS,
        amountInBaseUnits: amountIn.toString(),
      };
    }
  }

  if (usdcBalance < MIN_AUTO_TRADE_USDC_UNITS) {
    return null;
  }

  const amountIn = usdcBalance < DEFAULT_AUTO_TRADE_USDC_UNITS
    ? usdcBalance
    : DEFAULT_AUTO_TRADE_USDC_UNITS;

  return {
    tokenIn: BASE_USDC_ADDRESS,
    tokenOut: BASE_WETH_ADDRESS,
    amountInBaseUnits: amountIn.toString(),
  };
}

function getNextAllowedActions(
  bootstrap: Awaited<ReturnType<typeof getAgentBootstrapState>>,
  fundingReady: boolean,
): string[] {
  const actions = [
    "moonjoy_status:section=identity",
    "moonjoy_status:section=current_match",
    "moonjoy_status:section=portfolio",
    "moonjoy_match:action=heartbeat",
    "moonjoy_match:action=play_turn",
    "moonjoy_strategy:action=bootstrap_recommendation",
    "moonjoy_strategy:action=bootstrap_run",
    "moonjoy_strategy:action=bootstrap_step",
    "moonjoy_market:action=dexscreener_search",
    "moonjoy_market:action=dexscreener_token_pairs",
    "moonjoy_market:action=dexscreener_tokens",
    "moonjoy_market:action=dexscreener_boosts",
    "moonjoy_market:action=validate_candidate",
    "moonjoy_market:action=quote",
    "moonjoy_market:action=submit_trade",
    "moonjoy_status:section=allowed_tokens",
    "moonjoy_status:section=leaderboard",
    "moonjoy_status:section=trade_history",
  ];

  if (!bootstrap.executionReady) {
    actions.push("Agent wallet execution authority is unavailable; read and strategy tools remain usable");
  }

  if (bootstrap.derivedAgentStatus !== "ready") {
    actions.push("moonjoy_strategy:action=claim_identity");
  }

  if (!bootstrap.activeStrategy) {
    actions.push("moonjoy_strategy:action=create");
  } else {
    actions.push("moonjoy_strategy:action=list", "moonjoy_strategy:action=update");
  }

  actions.push("moonjoy_strategy:action=record_decision");
  return actions;
}
