import {
  deriveMatchPhase,
} from "@moonjoy/game";
import { getAgentFundingStatus } from "@/lib/services/agent-funding-service";
import { resolveUser } from "@/lib/services/ens-resolution-service";
import {
  buildBootstrapRecommendationFromState,
  getAgentBootstrapState,
  readStrategy,
  type BootstrapRecommendation,
} from "@/lib/services/agent-bootstrap-service";
import { getActiveMatchSnapshotForMcpContext } from "@/lib/services/match-service";
import { resolveAgentStrategy } from "@/lib/services/public-strategy-service";
import { submitSimulatedTrade } from "@/lib/services/trade-service";
import { getTradeHistoryForMatch } from "@/lib/services/trade-service";
import { getLeaderboardForMatch } from "@/lib/services/leaderboard-service";
import { fetchExactInputQuote } from "@/lib/services/uniswap-quote-service";
import { type BalanceDetail, getAllBalances, initializeStartingBalances } from "@/lib/services/portfolio-ledger-service";
import { getActiveTokensForMatch } from "@/lib/services/token-universe-service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { McpRuntimeContext } from "@/lib/types/mcp";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import type { MatchView } from "@/lib/types/match";

const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ERC20_DECIMALS_ABI = [{
  name: "decimals",
  type: "function",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint8" }],
}] as const;
const baseMainnetClient = createPublicClient({ chain: base, transport: http() });

export function toBaseUnits(humanAmount: string, decimals: number): string {
  const [intPart, fracPart = ""] = humanAmount.split(".");
  const paddedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const combined = intPart + paddedFrac;
  return combined.replace(/^0+/, "") || "0";
}

export function fromBaseUnits(baseUnits: string, decimals: number): string {
  const neg = baseUnits.startsWith("-");
  const raw = neg ? baseUnits.slice(1) : baseUnits;
  const padded = raw.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals) || "0";
  const fracPart = padded.slice(padded.length - decimals);
  const trimmedFrac = fracPart.replace(/0+$/, "");
  const result = trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
  return neg ? `-${result}` : result;
}

const decimalsCache = new Map<string, number>();

export async function getTokenDecimals(tokenAddress: string): Promise<number> {
  const key = tokenAddress.toLowerCase();
  if (decimalsCache.has(key)) return decimalsCache.get(key)!;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("token_universe_tokens")
    .select("decimals")
    .eq("chain_id", 8453)
    .eq("address", key)
    .maybeSingle();

  let dec = data ? (data as { decimals: number }).decimals : null;
  if (dec == null) {
    dec = await readTokenDecimalsOnchain(key);
  }

  decimalsCache.set(key, dec);
  return dec;
}

async function readTokenDecimalsOnchain(tokenAddress: string): Promise<number> {
  try {
    const result = await baseMainnetClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_DECIMALS_ABI,
      functionName: "decimals",
    });
    return Number(result);
  } catch {
    return 18;
  }
}

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
  warmupStrategyBriefing?: WarmupStrategyBriefing | null;
}> {
  const snapshot = await getActiveMatchSnapshotForMcpContext(context);

  if (snapshot.activeMatch?.status === "live") {
    return {
      ...snapshot,
      nextRecommendedTool: "moonjoy_match:action=play_turn",
      nextActionReason: "Live match is active. Keep trading, and unwind to USDC during cycle_out.",
    };
  }

  if (snapshot.activeMatch) {
    const warmupStrategyBriefing =
      snapshot.activeMatch.status === "warmup"
        ? await buildWarmupStrategyBriefing(context, snapshot.activeMatch)
        : null;
    return {
      ...snapshot,
      nextRecommendedTool:
        snapshot.activeMatch.status === "warmup"
          ? "moonjoy_match:action=prepare"
          : "moonjoy_match:action=heartbeat",
      nextActionReason:
        snapshot.activeMatch.status === "warmup"
          ? `Active match ${snapshot.activeMatch.id} is in warmup. Use moonjoy_match action=prepare to load your strategy briefing, compare it with the opponent public strategy, then validate candidates and mark ready.`
          : `Active match ${snapshot.activeMatch.id} in status=${snapshot.activeMatch.status}.`,
      warmupStrategyBriefing,
    };
  }

  return {
    ...snapshot,
    nextRecommendedTool: "moonjoy_match:action=heartbeat",
    nextActionReason: "No active match yet. Keep polling with moonjoy_match action=heartbeat. Use your client's scheduling or a loop to poll every 10-15 seconds.",
  };
}

type WarmupStrategyBriefing = {
  viewer: {
    publicStrategy: {
      name: string;
      strategyKind: "public";
      sourceType: string;
      manifest: Record<string, unknown>;
      manifestPointer: string;
    } | null;
    secretStrategy: {
      name: string;
      strategyKind: "secret_sauce";
      sourceType: string;
      manifest: Record<string, unknown>;
      manifestPointer: string;
    } | null;
  };
  opponent: {
    agentEnsName: string;
    publicStrategy: Record<string, unknown> | null;
    publicStrategyName: string | null;
  } | null;
  progress: Array<{
    key: string;
    label: string;
    complete: boolean;
    detail: string;
  }>;
  readyState: {
    viewerReadyMarked: boolean;
    opponentReadyMarked: boolean;
    totalReadyAgents: number;
  };
  guidance: string[];
  userFeedback: string;
};

async function buildWarmupStrategyBriefing(
  context: McpRuntimeContext,
  match: MatchView,
): Promise<WarmupStrategyBriefing | null> {
  const opponentParticipant =
    match.viewerSeat === "creator"
      ? match.opponent
      : match.viewerSeat === "opponent"
        ? match.creator
        : null;

  const [publicResult, secretResult, opponentPublicStrategy] = await Promise.all([
    readStrategy(context, { strategyKind: "public" }).catch(() => null),
    readStrategy(context, { strategyKind: "secret_sauce" }).catch(() => null),
    opponentParticipant?.agentEnsName
      ? resolveAgentStrategy(opponentParticipant.agentEnsName).catch(() => null)
      : Promise.resolve(null),
  ]);

  const viewerPublicStrategy =
    publicResult &&
    publicResult.strategy &&
    publicResult.decryptedManifest &&
    typeof publicResult.strategy === "object"
      ? {
          name: String((publicResult.strategy as Record<string, unknown>).name ?? "Public Strategy"),
          strategyKind: "public" as const,
          sourceType: String((publicResult.strategy as Record<string, unknown>).source_type ?? "unknown"),
          manifest: publicResult.decryptedManifest as Record<string, unknown>,
          manifestPointer: String((publicResult.strategy as Record<string, unknown>).manifest_pointer ?? ""),
        }
      : null;

  const viewerSecretStrategy =
    secretResult &&
    secretResult.strategy &&
    secretResult.decryptedManifest &&
    typeof secretResult.strategy === "object"
      ? {
          name: String((secretResult.strategy as Record<string, unknown>).name ?? "Secret Sauce"),
          strategyKind: "secret_sauce" as const,
          sourceType: String((secretResult.strategy as Record<string, unknown>).source_type ?? "unknown"),
          manifest: secretResult.decryptedManifest as Record<string, unknown>,
          manifestPointer: String((secretResult.strategy as Record<string, unknown>).manifest_pointer ?? ""),
        }
      : null;

  const readyState = {
    viewerReadyMarked: match.warmupPreparation?.viewerReadyMarked ?? false,
    opponentReadyMarked: match.warmupPreparation?.opponentReadyMarked ?? false,
    totalReadyAgents: match.warmupPreparation?.totalReadyAgents ?? 0,
  };

  const progress = [
    {
      key: "viewer_public_strategy",
      label: "Loaded public strategy",
      complete: Boolean(viewerPublicStrategy),
      detail: viewerPublicStrategy
        ? viewerPublicStrategy.name
        : "No active public strategy loaded.",
    },
    {
      key: "viewer_secret_strategy",
      label: "Loaded secret sauce",
      complete: Boolean(viewerSecretStrategy),
      detail: viewerSecretStrategy
        ? viewerSecretStrategy.name
        : "No active secret sauce loaded.",
    },
    {
      key: "opponent_public_strategy",
      label: "Loaded opponent public strategy",
      complete: Boolean(opponentPublicStrategy),
      detail: opponentParticipant?.agentEnsName
        ? opponentPublicStrategy
          ? opponentParticipant.agentEnsName
          : `No public strategy published for ${opponentParticipant.agentEnsName}.`
        : "Opponent not assigned yet.",
    },
    {
      key: "ready_marked",
      label: "Marked ready",
      complete: readyState.viewerReadyMarked,
      detail: readyState.viewerReadyMarked
        ? "Ready signal already recorded."
        : "Still preparing opening plan.",
    },
  ];

  return {
    viewer: {
      publicStrategy: viewerPublicStrategy,
      secretStrategy: viewerSecretStrategy,
    },
    opponent: opponentParticipant
      ? {
          agentEnsName: opponentParticipant.agentEnsName,
          publicStrategy: opponentPublicStrategy,
          publicStrategyName:
            typeof opponentPublicStrategy?.name === "string"
              ? opponentPublicStrategy.name
              : match.warmupPreparation?.opponentPublicStrategy?.name ?? null,
        }
      : null,
    progress,
    readyState,
    guidance: [
      "Use your own public strategy as the baseline posture.",
      "Use secret sauce to refine sizing, timing, or private heuristics.",
      "Compare the opponent public strategy to spot pace, risk, and likely openings.",
      "Report preparation progress clearly and mark ready without waiting for user feedback.",
    ],
    userFeedback:
      "Warmup briefing loaded. The agent should keep the user informed about strategy review, opponent read, and readiness progress while finalizing the opening plan.",
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
  warmupStrategyBriefing?: WarmupStrategyBriefing | null;
}> {
  const actions: Array<{ name: string; detail?: unknown }> = [];
  const identity = await getMoonjoyIdentity(context);

  const snapshot = await getActiveMatchSnapshotForMcpContext(context);

  if (!snapshot.activeMatch) {
    return {
      status: "no_match",
      actions,
      identity,
      match: snapshot,
      note: "No active match. Agents cannot create invites. Keep polling with moonjoy_match action=heartbeat every 10-15 seconds. Use your bash tool, client scheduler, or a loop. The match could start at any moment.",
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

  if (snapshot.activeMatch.status === "warmup") {
    const warmupStrategyBriefing = await buildWarmupStrategyBriefing(context, snapshot.activeMatch);
    actions.push({
      name: "warmup_strategy_briefing_ready",
      detail: warmupStrategyBriefing?.progress ?? [],
    });

    return {
      status: "active",
      actions,
      identity,
      match: snapshot,
      note:
        "Warmup is active. The agent briefing already includes your own strategies and the opponent public strategy. Form the opening plan and report progress; do not wait for user input.",
      warmupStrategyBriefing,
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
  status: "no_match" | "active" | "no_trade";
  phase: string | null;
  timeRemainingSeconds: number | null;
  currentPortfolio: Awaited<ReturnType<typeof getMoonjoyPortfolio>> | null;
  lastTrade: {
    status: string;
    reason?: string;
    tradeSide?: string | null;
    acceptedAt?: string;
  } | null;
  alreadyTradedThisPhase: boolean;
  acceptedTradeCountThisPhase: number;
  rejectedTradeCountThisPhase: number;
  nextRecommendedTools: string[];
  actions: Array<{ name: string; detail?: unknown }>;
  identity: MoonjoyIdentity;
  match: Awaited<ReturnType<typeof getActiveMatchSnapshotForMcpContext>> | null;
  note: string;
  warmupStrategyBriefing?: WarmupStrategyBriefing | null;
}> {
  const actions: Array<{ name: string; detail?: unknown }> = [];
  const identity = await getMoonjoyIdentity(context);

  const snapshot = await getActiveMatchSnapshotForMcpContext(context);

  if (!snapshot.activeMatch) {
    return {
      status: "no_match",
      phase: null,
      timeRemainingSeconds: null,
      currentPortfolio: null,
      lastTrade: null,
      alreadyTradedThisPhase: false,
      acceptedTradeCountThisPhase: 0,
      rejectedTradeCountThisPhase: 0,
      nextRecommendedTools: ["moonjoy_match:action=heartbeat"],
      actions,
      identity,
      match: snapshot,
      note: "No active match. Agents cannot create invites. Keep polling with moonjoy_match action=heartbeat every 10-15 seconds. Use your bash tool, client scheduler, or a loop. Your opponent is ready and waiting is losing.",
    };
  }

  if (snapshot.activeMatch.status === "warmup") {
    const warmupStrategyBriefing = await buildWarmupStrategyBriefing(context, snapshot.activeMatch);
    return {
      status: "active",
      phase: "warmup",
      timeRemainingSeconds: snapshot.activeMatch.warmupStartedAt
        ? Math.max(0, snapshot.activeMatch.warmupDurationSeconds - Math.floor((Date.now() - new Date(snapshot.activeMatch.warmupStartedAt).getTime()) / 1000))
        : null,
      currentPortfolio: null,
      lastTrade: null,
      alreadyTradedThisPhase: false,
      acceptedTradeCountThisPhase: 0,
      rejectedTradeCountThisPhase: 0,
      nextRecommendedTools: [
        "moonjoy_strategy:action=read",
        "moonjoy_match:action=prepare",
        "moonjoy_market:action=dexscreener_search",
        "moonjoy_market:action=validate_candidate",
        "moonjoy_match:action=mark_ready",
        "moonjoy_match:action=heartbeat",
      ],
      actions,
      identity,
      match: snapshot,
      note:
        `Warmup phase. Strategy briefing is loaded for match ${snapshot.activeMatch.id}. Compare your posture against the opponent public strategy, search candidates, and mark ready when the opening plan is settled.`,
      warmupStrategyBriefing,
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
      acceptedTradeCountThisPhase: 0,
      rejectedTradeCountThisPhase: 0,
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
      acceptedTradeCountThisPhase: 0,
      rejectedTradeCountThisPhase: 0,
      nextRecommendedTools: ["moonjoy_match:action=heartbeat"],
      actions,
      identity,
      match: snapshot,
      note: `Active match ${snapshot.activeMatch.id} in status=${snapshot.activeMatch.status}. Not live yet.`,
    };
  }

  const snapshot2 = await getActiveMatchSnapshotForMcpContext(context);

  let phase: string | null = null;
  let timeRemainingSeconds: number | null = null;

  if (snapshot.activeMatch.liveStartedAt && snapshot.activeMatch.liveEndsAt) {
    const now = new Date();
    phase = deriveMatchPhase(
      "live",
      new Date(snapshot.activeMatch.liveStartedAt),
      new Date(snapshot.activeMatch.liveEndsAt),
      now,
    );
    timeRemainingSeconds = Math.max(0, Math.floor((new Date(snapshot.activeMatch.liveEndsAt).getTime() - now.getTime()) / 1000));
  }

  let currentPortfolio: Awaited<ReturnType<typeof getMoonjoyPortfolio>> | null = null;
  try { currentPortfolio = await getMoonjoyPortfolio(context); } catch {}

  const tradeActivity = phase
    ? await getLiveTradeActivity(snapshot.activeMatch.id, context.agentId, phase)
    : null;
  const acceptedTradeCountThisPhase = tradeActivity?.acceptedTradeCountThisPhase ?? 0;
  const rejectedTradeCountThisPhase = tradeActivity?.rejectedTradeCountThisPhase ?? 0;
  const alreadyTradedThisPhase = acceptedTradeCountThisPhase > 0;
  const note = buildTradeCadenceNote({
    matchId: snapshot.activeMatch.id,
    phase,
    timeRemainingSeconds,
    acceptedTradeCountThisPhase,
    rejectedTradeCountThisPhase,
    lastTrade: tradeActivity?.lastTrade ?? null,
    currentPortfolio,
  });

  return {
    status: "no_trade",
    phase,
    timeRemainingSeconds,
    currentPortfolio,
    lastTrade: tradeActivity?.lastTrade ?? null,
    alreadyTradedThisPhase,
    acceptedTradeCountThisPhase,
    rejectedTradeCountThisPhase,
    nextRecommendedTools: [
      "moonjoy_market:action=dexscreener_search",
      "moonjoy_market:action=validate_candidate",
      "moonjoy_market:action=quote",
      "moonjoy_market:action=submit_trade",
      "moonjoy_match:action=play_turn",
    ],
    actions,
    identity,
    match: snapshot2,
    note,
  };
}

async function getLiveTradeActivity(
  matchId: string,
  agentId: string,
  phase: string,
): Promise<{
  lastTrade: {
    status: string;
    reason?: string;
    tradeSide?: string | null;
    acceptedAt?: string;
  } | null;
  acceptedTradeCountThisPhase: number;
  rejectedTradeCountThisPhase: number;
}> {
  const supabase = createAdminClient();
  const { data: trades } = await supabase
    .from("simulated_trades")
    .select("status, failure_reason, trade_side, accepted_at, phase")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .order("accepted_at", { ascending: false })
    .limit(25);

  if (!trades || trades.length === 0) {
    return {
      lastTrade: null,
      acceptedTradeCountThisPhase: 0,
      rejectedTradeCountThisPhase: 0,
    };
  }

  const phaseTrades = trades.filter((trade) => trade.phase === phase);
  const lastTrade = trades[0];

  return {
    lastTrade: {
      status: String(lastTrade.status),
      reason: (lastTrade.failure_reason as string | null) ?? undefined,
      tradeSide: (lastTrade.trade_side as string | null) ?? null,
      acceptedAt: String(lastTrade.accepted_at),
    },
    acceptedTradeCountThisPhase: phaseTrades.filter((trade) => trade.status === "accepted").length,
    rejectedTradeCountThisPhase: phaseTrades.filter((trade) => trade.status === "rejected").length,
  };
}

function buildTradeCadenceNote(input: {
  matchId: string;
  phase: string | null;
  timeRemainingSeconds: number | null;
  acceptedTradeCountThisPhase: number;
  rejectedTradeCountThisPhase: number;
  lastTrade: {
    status: string;
    reason?: string;
    tradeSide?: string | null;
    acceptedAt?: string;
  } | null;
  currentPortfolio: Awaited<ReturnType<typeof getMoonjoyPortfolio>> | null;
}): string {
  const phase = input.phase ?? "live";
  const cashBalance = input.currentPortfolio?.balances.find((balance) => balance.tokenAddress.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase());
  const exitablePositions = (input.currentPortfolio?.balances ?? []).filter((balance) => {
    return balance.tokenAddress.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase()
      && balance.exitableAmountBaseUnits !== "0";
  });
  const exitableSummary = exitablePositions
    .slice(0, 3)
    .map((balance) => `${balance.symbol || balance.tokenAddress.slice(0, 6)} ${balance.exitableAmountHuman}`)
    .join(", ");
  const cashSummary = cashBalance
    ? `Available USDC: ${cashBalance.amountHuman}.`
    : "Available USDC: 0.";

  if (input.lastTrade?.reason?.includes("Insufficient simulated balance")) {
    return `Live match ${input.matchId} in phase=${phase}. Last trade was rejected for insufficient simulated balance. ${cashSummary} Size the next buy below available USDC instead of repeating the same amount.`;
  }

  if (input.lastTrade?.reason?.includes("No exitable balance for tokenIn")) {
    return `Live match ${input.matchId} in phase=${phase}. Last trade tried to exit a token with no exitable balance. Exitable positions: ${exitableSummary || "none"}. Sell only from current holdings or switch back to a buy.`;
  }

  if (input.lastTrade?.reason?.includes("Price impact")) {
    return `Live match ${input.matchId} in phase=${phase}. Last trade exceeded the price impact limit. Reduce size, use a different token, or exit a more liquid position. Exitable positions: ${exitableSummary || "none"}.`;
  }

  if (phase === "cycle_out") {
    if (input.lastTrade?.status === "rejected") {
      return `Live match ${input.matchId} in phase=cycle_out. Last trade was rejected: ${input.lastTrade.reason ?? "unknown reason"}. Do not open new positions now. Exit remaining risk back into USDC only. Exitable positions: ${exitableSummary || "none"}.`;
    }

    return `Live match ${input.matchId} in phase=cycle_out. Mandatory unwind window: no new positions, no non-USDC rotations. Exit remaining risk back into USDC before settlement. Exitable positions: ${exitableSummary || "none"}.`;
  }

  if (input.lastTrade?.status === "rejected") {
    return `Live match ${input.matchId} in phase=${phase}. Last trade was rejected: ${input.lastTrade.reason ?? "unknown reason"}. Adjust the route, token, or size and try again. ${cashSummary} Exitable positions: ${exitableSummary || "none"}. Multiple trades per phase are allowed.`;
  }

  if (input.acceptedTradeCountThisPhase === 0) {
    return `Live match ${input.matchId} in phase=${phase}. No accepted trade yet in this phase. Act now: discover, validate, quote, and submit a trade before the window moves. ${cashSummary}`;
  }

  if ((input.timeRemainingSeconds ?? 0) > 20) {
    return `Live match ${input.matchId} in phase=${phase}. You already have ${input.acceptedTradeCountThisPhase} accepted trade(s) this phase and may still trade again. Reassess instead of idling; additional trades are allowed while the match stays live. ${cashSummary} Exitable positions: ${exitableSummary || "none"}.`;
  }

  return `Live match ${input.matchId} in phase=${phase}. Keep trading if a fresh quote supports it. Accepted this phase: ${input.acceptedTradeCountThisPhase}. Rejected this phase: ${input.rejectedTradeCountThisPhase}. ${cashSummary} Exitable positions: ${exitableSummary || "none"}.`;
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
    decimals: number;
    amountBaseUnits: string;
    amountHuman: string;
    valueUsd: number;
    costBasisUsd: number;
    unrealizedPnlUsd: number;
    exitableAmountBaseUnits: string;
    exitableAmountHuman: string;
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

  if (match.status === "live" || match.status === "settling") {
    try {
      await initializeStartingBalances(matchId, context.agentId, startingCapital);
    } catch (e) {
      console.error(`[mcp-context] defensive initializeStartingBalances failed`, {
        matchId,
        agentId: context.agentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

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

  if (!lv) {
    const ledgerBalances = await getAllBalances(matchId, context.agentId);
    const syntheticDetails: BalanceDetail[] = ledgerBalances.map((b) => ({
      tokenAddress: b.tokenAddress,
      symbol: b.tokenAddress.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase() ? "USDC" : "",
      decimals: b.tokenAddress.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase() ? 6 : 18,
      amountBaseUnits: b.amountBaseUnits,
      valueUsd: b.tokenAddress.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase()
        ? Number(b.amountBaseUnits) / 1_000_000
        : 0,
      costBasisUsd: b.tokenAddress.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase()
        ? Number(b.amountBaseUnits) / 1_000_000
        : 0,
      unrealizedPnlUsd: 0,
      exitableAmountBaseUnits: b.amountBaseUnits,
      exposurePercent: 0,
      priceSource: "ledger",
      quoteId: null,
    }));
    const currentValueUsd = syntheticDetails.reduce(
      (sum, balance) => sum + balance.valueUsd,
      0,
    );

    return {
      owner: context.smartAccountAddress,
      status: "active",
      startingValueUsd: startingCapital,
      currentValueUsd,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      totalPnlUsd: 0,
      pnlPercent: 0,
      penaltiesUsd: 0,
      penaltyImpactUsd: 0,
      netScoreUsd: 0,
      netScorePercent: 0,
      balances: extractPortfolioBalancesFromDetails(syntheticDetails),
      message: ledgerBalances.length > 0
        ? "Live per-match simulated portfolio (awaiting first valuation snapshot). Agents may buy, sell, exit, and rotate quote-backed simulated balances."
        : "Live per-match simulated portfolio has no ledger balances yet. Starting balance initialization has not completed.",
    };
  }

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
      "Live per-match simulated portfolio. Agents may buy, sell, exit, and rotate quote-backed simulated balances; penalties are shown as negative dollar impact.",
  };
}

function extractPortfolioBalances(
  snapshot: Record<string, unknown> | null,
): Array<{
  tokenAddress: string;
  symbol: string;
  decimals: number;
  amountBaseUnits: string;
  amountHuman: string;
  valueUsd: number;
  costBasisUsd: number;
  unrealizedPnlUsd: number;
  exitableAmountBaseUnits: string;
  exitableAmountHuman: string;
  exposurePercent: number;
  suggestedExitToken: string;
}> {
  const balances = (snapshot?.balances ?? []) as BalanceDetail[];
  return extractPortfolioBalancesFromDetails(balances);
}

function extractPortfolioBalancesFromDetails(
  balances: BalanceDetail[],
): Array<{
  tokenAddress: string;
  symbol: string;
  decimals: number;
  amountBaseUnits: string;
  amountHuman: string;
  valueUsd: number;
  costBasisUsd: number;
  unrealizedPnlUsd: number;
  exitableAmountBaseUnits: string;
  exitableAmountHuman: string;
  exposurePercent: number;
  suggestedExitToken: string;
}> {
  return balances.map((b) => {
    const dec = b.decimals ?? 18;
    return {
      tokenAddress: b.tokenAddress,
      symbol: b.symbol ?? "",
      decimals: dec,
      amountBaseUnits: b.amountBaseUnits,
      amountHuman: fromBaseUnits(b.amountBaseUnits, dec),
      valueUsd: b.valueUsd ?? 0,
      costBasisUsd: b.costBasisUsd ?? 0,
      unrealizedPnlUsd: b.unrealizedPnlUsd ?? 0,
      exitableAmountBaseUnits: b.exitableAmountBaseUnits ?? b.amountBaseUnits,
      exitableAmountHuman: fromBaseUnits(b.exitableAmountBaseUnits ?? b.amountBaseUnits, dec),
      exposurePercent: b.exposurePercent ?? 0,
      suggestedExitToken: b.tokenAddress.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase()
        ? ""
        : BASE_USDC_ADDRESS.toLowerCase(),
    };
  });
}

export async function getMoonjoyMarketQuote(
  context: McpRuntimeContext,
  params?: { tokenIn?: string; tokenOut?: string; amount?: string; amountInBaseUnits?: string },
): Promise<{
  status: "ok" | "no_match" | "error";
  quote?: {
    snapshotId: string;
    inputAmountHuman: string;
    outputAmount: string;
    outputAmountHuman: string;
    tokenInDecimals: number;
    tokenOutDecimals: number;
    routing: string;
    priceImpactBps: number | null;
    gasEstimate: string | null;
  };
  message: string;
}> {
  if (!params?.tokenIn || !params?.tokenOut || (!params?.amount && !params?.amountInBaseUnits)) {
    return {
      status: "no_match",
      message: "Provide tokenIn, tokenOut, and amount (human-readable) or amountInBaseUnits to get a quote.",
    };
  }

  try {
    const tokenInDecimals = await getTokenDecimals(params.tokenIn);
    const tokenOutDecimals = await getTokenDecimals(params.tokenOut);

    const amountBaseUnits = params.amountInBaseUnits ?? toBaseUnits(params.amount!, tokenInDecimals);
    const inputAmountHuman = params.amount ?? fromBaseUnits(params.amountInBaseUnits!, tokenInDecimals);

    const quote = await fetchExactInputQuote({
      swapper: context.smartAccountAddress as `0x${string}`,
      tokenIn: params.tokenIn as `0x${string}`,
      tokenOut: params.tokenOut as `0x${string}`,
      amountBaseUnits,
      slippageBps: 100,
    });

    return {
      status: "ok",
      quote: {
        snapshotId: quote.snapshotId,
        inputAmountHuman,
        outputAmount: quote.outputAmount,
        outputAmountHuman: fromBaseUnits(quote.outputAmount, tokenOutDecimals),
        tokenInDecimals,
        tokenOutDecimals,
        routing: quote.routing,
        priceImpactBps: quote.priceImpactBps,
        gasEstimate: quote.gasEstimate,
      },
      message: "Fresh Uniswap quote from Base mainnet. amount/inputAmountHuman are human-readable; outputAmount is base units; outputAmountHuman is human-readable. Simulated fill only.",
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
    amount?: string;
    amountInBaseUnits?: string;
    quoteSnapshotId?: string;
  },
): Promise<{
  status: "accepted" | "rejected";
  tradeId?: string;
  inputAmountHuman?: string;
  outputAmount?: string;
  outputAmountHuman?: string;
  routing?: string;
  tradeSide?: Awaited<ReturnType<typeof submitSimulatedTrade>>["tradeSide"];
  tradeLabel?: Awaited<ReturnType<typeof submitSimulatedTrade>>["tradeLabel"];
  realizedPnlUsd?: number;
  retryable?: boolean;
  reason?: string;
  portfolioAfterTrade?: Awaited<ReturnType<typeof submitSimulatedTrade>>["portfolioAfterTrade"];
  message: string;
}> {
  if (!params.amount && !params.amountInBaseUnits) {
    return { status: "rejected", reason: "Provide amount (human-readable) or amountInBaseUnits.", message: "Provide amount (human-readable) or amountInBaseUnits." };
  }

  const tokenInDecimals = await getTokenDecimals(params.tokenIn);
  const tokenOutDecimals = await getTokenDecimals(params.tokenOut);

  const amountInBaseUnits = params.amountInBaseUnits ?? toBaseUnits(params.amount!, tokenInDecimals);
  const inputAmountHuman = params.amount ?? fromBaseUnits(params.amountInBaseUnits!, tokenInDecimals);

  const supabase = createAdminClient();

  const { data: match } = await supabase
    .from("matches")
    .select("creator_agent_id, opponent_agent_id")
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
    amountInBaseUnits,
    quoteSnapshotId: params.quoteSnapshotId,
  });

  const outputAmountHuman = result.outputAmount
    ? fromBaseUnits(result.outputAmount, tokenOutDecimals)
    : undefined;

  return {
    ...result,
    inputAmountHuman,
    outputAmountHuman,
    message:
      result.status === "accepted"
        ? `Simulated ${result.tradeLabel ?? result.tradeSide ?? "trade"} accepted. Input: ${inputAmountHuman}, output: ${outputAmountHuman ?? "see outputAmount"}. portfolioAfterTrade shows per-match balances, value, PnL, penalty impact, and net score.`
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
