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
import {
  getActiveMatchSnapshotForMcpContext,
  listOpenChallengesForMcpContext,
  createChallengeForMcpContext,
  acceptChallengeForMcpContext,
  cancelChallengeForMcpContext,
} from "@/lib/services/match-service";
import { submitSimulatedTrade } from "@/lib/services/trade-service";
import { getTradeHistoryForMatch } from "@/lib/services/trade-service";
import { getLeaderboardForMatch } from "@/lib/services/leaderboard-service";
import { discoverBaseTokens, getTokenRiskProfile } from "@/lib/services/dexscreener-discovery-service";
import { fetchExactInputQuote } from "@/lib/services/uniswap-quote-service";
import { getAllBalances } from "@/lib/services/portfolio-ledger-service";
import { getActiveTokensForMatch } from "@/lib/services/token-universe-service";
import { tickActiveMatch } from "@/lib/services/worker-loop-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideMatchmakingAction } from "@/lib/services/matchmaking-decision";
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
    runToolName: "moonjoy_run_bootstrap" | null;
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

  // Fire everything in parallel; `resolveUser` and `getAgentBootstrapState`
  // overlap on a few ENS reads but the short-lived cache in ens-cache.ts
  // de-duplicates repeat calls inside the same request.
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
  // Compute the recommendation from already-loaded state so we don't
  // re-run the whole bootstrap probe a second time.
  const recommendation = buildBootstrapRecommendationFromState(bootstrap);
  const userEnsReady =
    Boolean(resolved.ensName) &&
    Boolean(
      resolved.address &&
        user?.embedded_signer_address &&
        resolved.address.toLowerCase() ===
          user.embedded_signer_address.toLowerCase(),
    );
  // ENS bootstrap and current MCP-controlled agent actions run with sponsorship.
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
        recommendation.status === "actionable" ? "moonjoy_run_bootstrap" : null,
      shouldAutoRun: recommendation.status === "actionable",
      recommendedAction: recommendation,
      pendingTransactions: bootstrap.pendingTransactions,
    },
  };
}

export async function getMoonjoyMatchStateForContext(
  context: McpRuntimeContext,
): Promise<
  Awaited<ReturnType<typeof getActiveMatchSnapshotForMcpContext>> & {
    joinableChallengeCount: number;
    nextRecommendedTool: "moonjoy_auto" | null;
    nextActionReason: string;
    coordination: ReturnType<typeof decideMatchmakingAction>["coordination"];
  }
> {
  const snapshot = await getActiveMatchSnapshotForMcpContext(context);
  const open = await listOpenChallengesForMcpContext(context);
  const decision = decideMatchmakingAction(snapshot, open);

  return {
    ...snapshot,
    joinableChallengeCount: decision.joinableChallengeCount,
    nextRecommendedTool: decision.nextRecommendedTool,
    nextActionReason: decision.nextActionReason,
    coordination: decision.coordination,
  };
}

export async function listMoonjoyOpenChallengesForContext(
  context: McpRuntimeContext,
): Promise<Awaited<ReturnType<typeof listOpenChallengesForMcpContext>>> {
  return listOpenChallengesForMcpContext(context);
}

export async function createMoonjoyChallengeForContext(
  context: McpRuntimeContext,
): Promise<Awaited<ReturnType<typeof createChallengeForMcpContext>>> {
  return createChallengeForMcpContext(context);
}

export async function acceptMoonjoyChallengeForContext(
  context: McpRuntimeContext,
  matchId: string,
): Promise<Awaited<ReturnType<typeof acceptChallengeForMcpContext>>> {
  return acceptChallengeForMcpContext(context, matchId);
}

export async function cancelMoonjoyChallengeForContext(
  context: McpRuntimeContext,
  matchId: string,
): Promise<Awaited<ReturnType<typeof cancelChallengeForMcpContext>>> {
  return cancelChallengeForMcpContext(context, matchId);
}

export async function runMoonjoyHeartbeat(
  context: McpRuntimeContext,
): Promise<Awaited<ReturnType<typeof autoAdvanceMoonjoy>>> {
  return autoAdvanceMoonjoy(context, { createIfNoJoinable: false });
}

export async function playMoonjoyTurn(
  context: McpRuntimeContext,
): Promise<Awaited<ReturnType<typeof autoAdvanceMoonjoy>>> {
  return autoAdvanceMoonjoy(context, { createIfNoJoinable: false });
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
  balances: Array<{ tokenAddress: string; amountBaseUnits: string }>;
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
      balances: [],
      message:
        "Match settled. Final portfolio snapshot; penalties are negative dollar score adjustments.",
    };
  }

  const balances = await getAllBalances(matchId, context.agentId);

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
    balances,
    message:
      "Live portfolio. Simulated fill from live Uniswap quote on Base mainnet; penalties are shown as negative dollar impact.",
  };
}

export async function getMoonjoyMarketQuote(
  context: McpRuntimeContext,
  params?: { tokenIn?: string; tokenOut?: string; amount?: string },
): Promise<{
  status: "ok" | "no_match" | "error";
  quote?: {
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
  params: { matchId: string; tokenIn: string; tokenOut: string; amountInBaseUnits: string },
): Promise<{
  status: "accepted" | "rejected";
  tradeId?: string;
  outputAmount?: string;
  routing?: string;
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
  });

  return {
    ...result,
    message:
      result.status === "accepted"
        ? "Simulated fill accepted from live Uniswap quote on Base mainnet. portfolioAfterTrade shows the new dollar value, PnL, penalty impact, and net score."
        : `Trade rejected: ${result.reason}`,
  };
}

export async function discoverMoonjoyTokens(
  context: McpRuntimeContext,
  params?: { query?: string; minLiquidityUsd?: number; minVolume24hUsd?: number },
) {
  return discoverBaseTokens(
    {
      query: params?.query,
      minLiquidityUsd: params?.minLiquidityUsd,
      minVolume24hUsd: params?.minVolume24hUsd,
    },
  );
}

export async function getMoonjoyTokenRiskProfile(
  context: McpRuntimeContext,
  tokenAddress: string,
) {
  return getTokenRiskProfile(tokenAddress, context.smartAccountAddress);
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

// Autonomous driver: reads identity, finishes bootstrap when actionable,
// and advances the match lifecycle. One tool call progresses the agent as
// far as it can go without human input, then returns a concise report.
//
// Returns one of:
//   status: "blocked"          — bootstrap requires human intervention
//   status: "ready_waiting"    — bootstrapped, in a match (or waiting), no action taken
//   status: "advanced"         — at least one action was executed this call
export async function autoAdvanceMoonjoy(
  context: McpRuntimeContext,
  options?: { skipMatchActions?: boolean; createIfNoJoinable?: boolean },
): Promise<{
  status: "blocked" | "ready_waiting" | "advanced";
  actions: Array<{ name: string; detail?: unknown }>;
  identity: MoonjoyIdentity;
  match: Awaited<ReturnType<typeof getActiveMatchSnapshotForMcpContext>> | null;
  note: string;
  nextRecommendedTools?: string[];
  nextActionReason?: string;
  coordination?: ReturnType<typeof decideMatchmakingAction>["coordination"];
}> {
  const actions: Array<{ name: string; detail?: unknown }> = [];

  // 1. Read identity (parallelized internally).
  let identity = await getMoonjoyIdentity(context);

  // 2. Finish bootstrap if the recommendation is actionable.
  if (identity.bootstrap.shouldAutoRun) {
    const result = await runBootstrap(context);
    actions.push({ name: "moonjoy_run_bootstrap", detail: result });
    identity = await getMoonjoyIdentity(context);
  }

  if (identity.bootstrap.status === "blocked") {
    return {
      status: "blocked",
      actions,
      identity,
      match: null,
      note:
        identity.bootstrap.recommendedAction.reason ??
        "Bootstrap is blocked; a human prerequisite is missing.",
    };
  }

  if (identity.bootstrap.status === "pending") {
    return {
      status: "ready_waiting",
      actions,
      identity,
      match: null,
      note: "Bootstrap transaction is still settling on chain. Re-call moonjoy_auto shortly.",
    };
  }

  if (!identity.readiness.bootstrapReady) {
    return {
      status: "ready_waiting",
      actions,
      identity,
      match: null,
      note: "Bootstrap not yet ready.",
    };
  }

  if (options?.skipMatchActions) {
    return {
      status: actions.length > 0 ? "advanced" : "ready_waiting",
      actions,
      identity,
      match: null,
      note: "Match actions skipped by caller.",
    };
  }

  // 3. Advance the match lifecycle.
  const match = await getActiveMatchSnapshotForMcpContext(context);

  if (
    match.activeMatch &&
    match.activeMatch.status === "created" &&
    match.activeMatch.viewerSeat === "creator" &&
    match.activeMatch.opponent === null
  ) {
    const open = await listOpenChallengesForMcpContext(context);
    const decision = decideMatchmakingAction(match, open);
    const acceptable = decision.selectedChallenge;

    actions.push({
      name: "moonjoy_analyze_open_challenges",
      detail: {
        openChallengeCount: open.challenges.length,
        joinableChallengeCount: decision.joinableChallengeCount,
        selectedMatchId: acceptable?.id ?? null,
        coordination: decision.coordination,
        selectionReason: acceptable
          ? "Selected a joinable challenge and will withdraw this agent's own unaccepted challenge first."
          : decision.nextActionReason,
      },
    });

    if (acceptable) {
      const canceled = await cancelChallengeForMcpContext(
        context,
        match.activeMatch.id,
      );
      actions.push({
        name: "moonjoy_cancel_challenge",
        detail: { matchId: canceled.id, status: canceled.status },
      });

      const accepted = await acceptChallengeForMcpContext(context, acceptable.id);
      actions.push({
        name: "moonjoy_accept_challenge",
        detail: { matchId: accepted.id, status: accepted.status },
      });

      return {
        status: "advanced",
        actions,
        identity,
        match: await getActiveMatchSnapshotForMcpContext(context),
        note: `Canceled stale challenge ${match.activeMatch.id} and accepted ${accepted.id}. Warmup has started.`,
      };
    }

    return {
      status: "ready_waiting",
      actions,
      identity,
      match,
      note:
        decision.coordination.mode === "hold_own_challenge"
          ? "Holding the canonical open challenge. Do not ask the user; use moonjoy_heartbeat between polls and prepare with token, quote, portfolio, leaderboard, and strategy tools."
          : "Waiting for an opponent. Do not ask the user; use moonjoy_heartbeat between polls and prepare with token, quote, portfolio, leaderboard, and strategy tools.",
      nextRecommendedTools: [
        "moonjoy_heartbeat",
        "moonjoy_discover_base_tokens",
        "moonjoy_get_token_risk_profile",
        "moonjoy_get_market_quote",
        "moonjoy_get_portfolio",
        "moonjoy_list_strategies",
      ],
      nextActionReason: decision.nextActionReason,
      coordination: decision.coordination,
    };
  }

  if (match.activeMatch?.status === "live") {
    const autoTrade = await maybeSubmitLiveAutoTrade(context, match.activeMatch);
    actions.push(...autoTrade.actions);

    if (autoTrade.traded) {
      return {
        status: "advanced",
        actions,
        identity,
        match: autoTrade.match,
        note: autoTrade.note,
      };
    }

    return {
      status: "ready_waiting",
      actions,
      identity,
      match: autoTrade.match,
      note: `${autoTrade.note} Do not ask the user; continue with live-match tools.`,
      nextRecommendedTools: [
        "moonjoy_play_turn",
        "moonjoy_heartbeat",
        "moonjoy_get_portfolio",
        "moonjoy_get_leaderboard",
        "moonjoy_discover_base_tokens",
        "moonjoy_get_token_risk_profile",
        "moonjoy_get_market_quote",
        "moonjoy_submit_trade",
        "moonjoy_record_strategy_decision",
      ],
      nextActionReason:
        "Live match is active. Keep playing or researching directly; do not ask whether to trade.",
    };
  }

  if (match.activeMatch) {
    // Already in a non-joinable match; the agent should poll state, not mutate.
    return {
      status: actions.length > 0 ? "advanced" : "ready_waiting",
      actions,
      identity,
      match,
      note: `Active match ${match.activeMatch.id} is in status=${match.activeMatch.status}. Monitor only.`,
    };
  }

  // Look for a compatible open challenge to accept.
  const open = await listOpenChallengesForMcpContext(context);
  const decision = decideMatchmakingAction(match, open);
  const acceptable = decision.selectedChallenge;
  actions.push({
    name: "moonjoy_analyze_open_challenges",
    detail: {
      openChallengeCount: open.challenges.length,
      joinableChallengeCount: decision.joinableChallengeCount,
      selectedMatchId: acceptable?.id ?? null,
      coordination: decision.coordination,
      selectionReason: acceptable
        ? "Selected the first open challenge with no opponent."
        : decision.nextActionReason,
    },
  });

  if (acceptable) {
    const accepted = await acceptChallengeForMcpContext(context, acceptable.id);
    actions.push({
      name: "moonjoy_accept_challenge",
      detail: { matchId: accepted.id, status: accepted.status },
    });
    return {
      status: "advanced",
      actions,
      identity,
      match: await getActiveMatchSnapshotForMcpContext(context),
      note: `Accepted challenge ${accepted.id}. Warmup has started.`,
    };
  }

  if (options?.createIfNoJoinable === false) {
    return {
      status: "ready_waiting",
      actions,
      identity,
      match: await getActiveMatchSnapshotForMcpContext(context),
      note: "No joinable challenge remained; heartbeat skipped challenge creation.",
      nextRecommendedTools: [
        "moonjoy_heartbeat",
        "moonjoy_get_match_state",
        "moonjoy_discover_base_tokens",
        "moonjoy_get_token_risk_profile",
      ],
      nextActionReason: decision.nextActionReason,
      coordination: decision.coordination,
    };
  }

  // Otherwise post a new challenge.
  const created = await createMoonjoyChallengeForContext(context);
  actions.push({
    name: "moonjoy_create_challenge",
    detail: { matchId: created.id, status: created.status },
  });

  return {
    status: "advanced",
    actions,
    identity,
    match: await getActiveMatchSnapshotForMcpContext(context),
    note: `Created challenge ${created.id}. Waiting for an opponent.`,
  };
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
        ? "moonjoy_submit_trade"
        : "moonjoy_submit_trade_rejected",
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
  const wethBalance = balanceFor(BASE_WETH_ADDRESS);

  if (phase === "closing_window" && wethBalance > BigInt(0)) {
    return {
      tokenIn: BASE_WETH_ADDRESS,
      tokenOut: BASE_USDC_ADDRESS,
      amountInBaseUnits: wethBalance.toString(),
    };
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
    "moonjoy_auto",
    "moonjoy_get_identity",
    "moonjoy_get_match_state",
    "moonjoy_list_open_challenges",
    "moonjoy_create_challenge",
    "moonjoy_accept_challenge",
    "moonjoy_get_bootstrap_action",
    "moonjoy_run_bootstrap",
    "moonjoy_execute_bootstrap_step",
    "moonjoy_get_portfolio",
    "moonjoy_get_market_quote",
    "moonjoy_discover_base_tokens",
    "moonjoy_get_token_risk_profile",
    "moonjoy_get_allowed_tokens",
    "moonjoy_get_leaderboard",
    "moonjoy_get_trade_history",
    "moonjoy_heartbeat",
  ];

  if (!bootstrap.executionReady) {
    actions.push(
      "Agent wallet execution authority is unavailable; read and strategy tools remain usable",
    );
  }

  if (!fundingReady) {
    actions.push(
      "Fund the agent smart account with enough Base Sepolia ETH to cover the fixed theoretical max gas reserve",
    );
  }

  if (bootstrap.derivedAgentStatus !== "ready") {
    actions.push("moonjoy_claim_agent_identity");
  }

  if (!bootstrap.activeStrategy) {
    actions.push("moonjoy_create_strategy");
  } else {
    actions.push("moonjoy_list_strategies", "moonjoy_update_strategy");
  }

  actions.push("moonjoy_record_strategy_decision");
  return actions;
}
