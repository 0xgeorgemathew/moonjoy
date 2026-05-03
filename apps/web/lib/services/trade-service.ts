import {
  isTradingAllowed,
  deriveMatchPhase,
  classifyTradeSide,
  deriveTradeLabel,
  type MatchPhase,
  type TradeSide,
} from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchExactInputQuote,
  getStoredExactInputQuote,
  validateQuoteForSimulatedFill,
  type ValidatedQuote,
  UniswapQuoteError,
} from "@/lib/services/uniswap-quote-service";
import {
  getTokenBalance,
  initializeStartingBalances,
  computeValuation,
  type ValuationResult,
} from "@/lib/services/portfolio-ledger-service";
import {
  getActiveTokensForMatch,
  getTokenRiskTier,
  getMaxPriceImpactBps,
  getSlippageBps,
} from "@/lib/services/token-universe-service";

export type SubmitTradeInput = {
  matchId: string;
  agentId: string;
  smartAccountAddress: string;
  seat: "creator" | "opponent";
  tokenIn: string;
  tokenOut: string;
  amountInBaseUnits: string;
  quoteSnapshotId?: string;
};

export type TradeResult = {
  status: "accepted" | "rejected";
  tradeId?: string;
  reason?: string;
  retryable?: boolean;
  tradeSide?: TradeSide;
  tradeLabel?: "buy" | "sell" | "swap" | "exit";
  realizedPnlUsd?: number;
  closedCostBasisUsd?: number;
  outputAmount?: string;
  routing?: string;
  priceImpactBps?: number | null;
  quoteSnapshotId?: string;
  portfolioAfterTrade?: ValuationResult;
};

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export function validateTradePhaseRules(input: {
  phase: MatchPhase;
  tradeSide: TradeSide;
  tokenOut: string;
  usdcAddress?: string;
}): { allowed: true } | { allowed: false; reason: string } {
  const usdcAddress = (input.usdcAddress ?? USDC).toLowerCase();
  const normalizedTokenOut = input.tokenOut.toLowerCase();

  if (input.phase !== "cycle_out") {
    return { allowed: true };
  }

  if (input.tradeSide === "buy") {
    return {
      allowed: false,
      reason: "Cycle-out phase does not allow new positions. Exit back into USDC only.",
    };
  }

  if (normalizedTokenOut !== usdcAddress) {
    return {
      allowed: false,
      reason: "Cycle-out phase only allows exits back into USDC.",
    };
  }

  return { allowed: true };
}

export async function submitSimulatedTrade(
  input: SubmitTradeInput,
): Promise<TradeResult> {
  const supabase = createAdminClient();
  const normalizedTokenIn = input.tokenIn.toLowerCase();
  const normalizedTokenOut = input.tokenOut.toLowerCase();

  if (normalizedTokenIn === normalizedTokenOut) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "tokenIn and tokenOut must be different.", undefined, "rejected", undefined, false);
  }

  const { data: match } = await supabase
    .from("matches")
    .select("id, status, live_started_at, live_ends_at, starting_capital_usd, creator_agent_id, opponent_agent_id, creator_smart_account_address, opponent_smart_account_address")
    .eq("id", input.matchId)
    .single();

  if (!match) {
    return rejectWithoutPersist("Match not found.", false);
  }

  const participant = getParticipantForTrade(match as Record<string, unknown>, input.agentId);
  if (!participant) {
    return rejectWithoutPersist("Agent is not a participant in this match.", false);
  }

  if (participant.seat !== input.seat) {
    return rejectWithoutPersist("Trade seat does not match the agent's match seat.", false);
  }

  if (participant.smartAccountAddress.toLowerCase() !== input.smartAccountAddress.toLowerCase()) {
    return rejectWithoutPersist("Trade signer does not match the agent smart account for this match.", false);
  }

  const tradeSide = classifyTradeSide({
    tokenIn: normalizedTokenIn,
    tokenOut: normalizedTokenOut,
    usdcAddress: USDC,
  });

  if (!tradeSide) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Invalid trade: USDC to USDC is not allowed.", undefined, "rejected", undefined, false);
  }

  const now = new Date();
  const phase = deriveMatchPhase(
    match.status as "created" | "warmup" | "live" | "settling" | "settled",
    match.live_started_at ? new Date(match.live_started_at) : null,
    match.live_ends_at ? new Date(match.live_ends_at) : null,
    now,
  );

  if (!isTradingAllowed(phase)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, `Trading is not allowed in phase ${phase}.`, undefined, phase, tradeSide);
  }

  const phaseRule = validateTradePhaseRules({
    phase,
    tradeSide,
    tokenOut: normalizedTokenOut,
  });
  if (!phaseRule.allowed) {
    return persistAndReject(
      supabase,
      input,
      normalizedTokenIn,
      normalizedTokenOut,
      phaseRule.reason,
      undefined,
      phase,
      tradeSide,
      false,
    );
  }

  const duplicateRejectedTrade = await getRecentDuplicateRejectedTrade({
    supabase,
    matchId: input.matchId,
    agentId: input.agentId,
    tokenIn: normalizedTokenIn,
    tokenOut: normalizedTokenOut,
    amountInBaseUnits: input.amountInBaseUnits,
    now,
  });

  if (duplicateRejectedTrade) {
    return rejectWithoutPersist(
      `The same trade was already rejected ${duplicateRejectedTrade.secondsAgo}s ago: ${duplicateRejectedTrade.reason}. Change the size, token, or route before retrying.`,
      false,
    );
  }

  const startingCapital = Number(match.starting_capital_usd);
  if (Number.isFinite(startingCapital) && startingCapital > 0) {
    try {
      await initializeStartingBalances(input.matchId, input.agentId, startingCapital);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      return persistAndReject(
        supabase,
        input,
        normalizedTokenIn,
        normalizedTokenOut,
        `Failed to initialize simulated starting balance: ${reason}`,
        undefined,
        phase,
        tradeSide,
        true,
      );
    }
  }

  const balance = await getTokenBalance(input.matchId, input.agentId, normalizedTokenIn);
  const tradeLabel = deriveTradeLabel({
    tradeSide,
    currentBalanceBaseUnits: balance,
    amountInBaseUnits: input.amountInBaseUnits,
  });

  const tokens = await getActiveTokensForMatch(input.matchId);

  if (tradeSide !== "buy" && BigInt(balance) <= BigInt(0)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "No exitable balance for tokenIn.", undefined, phase, tradeSide, false);
  }

  const riskAddress = tradeSide === "sell" ? normalizedTokenIn : normalizedTokenOut;
  const riskTierToken = getTokenRiskTier(tokens, riskAddress) ?? "discovered";
  const slippageBps = getSlippageBps(riskTierToken);
  const maxPriceImpact = getMaxPriceImpactBps(riskTierToken);

  if (BigInt(input.amountInBaseUnits) <= BigInt(0)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Trade amount must be positive.", undefined, phase, tradeSide, false);
  }

  if (BigInt(balance) < BigInt(input.amountInBaseUnits)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Insufficient simulated balance.", undefined, phase, tradeSide, false);
  }

  let quote: ValidatedQuote;
  try {
    const storedQuote = input.quoteSnapshotId
      ? await getStoredExactInputQuote({
          snapshotId: input.quoteSnapshotId,
          swapper: input.smartAccountAddress as `0x${string}`,
          tokenIn: normalizedTokenIn as `0x${string}`,
          tokenOut: normalizedTokenOut as `0x${string}`,
          amountBaseUnits: input.amountInBaseUnits,
        })
      : null;

    quote =
      storedQuote ??
      (await fetchExactInputQuote({
        swapper: input.smartAccountAddress as `0x${string}`,
        tokenIn: normalizedTokenIn as `0x${string}`,
        tokenOut: normalizedTokenOut as `0x${string}`,
        amountBaseUnits: input.amountInBaseUnits,
        slippageBps,
      }));
  } catch (err) {
    const detail = err instanceof UniswapQuoteError && err.details ? ` ${err.details}` : "";
    return persistAndReject(
      supabase,
      input,
      normalizedTokenIn,
      normalizedTokenOut,
      `Quote failed: ${err instanceof Error ? err.message : "Unexpected"}${detail}`,
      undefined,
      phase,
      tradeSide,
      isRetryableQuoteError(err),
    );
  }

  const validationError = validateQuoteForSimulatedFill(quote, {
    maxPriceImpactBps: maxPriceImpact,
    allowedRouting: ["CLASSIC", "WRAP", "UNWRAP"],
    fetchedAt: quote.fetchedAt,
  });

  if (validationError) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, validationError.reason, quote.snapshotId, phase, tradeSide);
  }

  const tradeValues = await estimateTradeValuesUsd({
    tradeSide,
    tokenIn: normalizedTokenIn,
    amountInBaseUnits: input.amountInBaseUnits,
    tokenOut: normalizedTokenOut,
    amountOutBaseUnits: quote.outputAmount,
    swapperAddress: input.smartAccountAddress,
  });
  if (!tradeValues) {
    return persistAndReject(
      supabase,
      input,
      normalizedTokenIn,
      normalizedTokenOut,
      "Trade could not be valued in USDC.",
      quote.snapshotId,
      phase,
      tradeSide,
    );
  }
  const { inputValueUsd, outputValueUsd } = tradeValues;

  const tradeId = crypto.randomUUID();
  const acceptedAt = now.toISOString();

  const rpcArgs = {
    p_trade_id: tradeId,
    p_match_id: input.matchId,
    p_agent_id: input.agentId,
    p_seat: input.seat,
    p_phase: phase,
    p_token_in: normalizedTokenIn,
    p_token_out: normalizedTokenOut,
    p_amount_in: input.amountInBaseUnits,
    p_quoted_amount_out: quote.outputAmount,
    p_simulated_amount_out: quote.outputAmount,
    p_slippage_bps: 0,
    p_quote_snapshot_id: quote.snapshotId,
    p_input_value_usd: inputValueUsd,
    p_output_value_usd: outputValueUsd,
    p_accepted_at: acceptedAt,
    p_trade_side: tradeLabel,
  };

  const { data: rpcResult, error: rpcError } = await supabase.rpc("accept_bidirectional_trade", rpcArgs);

  if (rpcError || (rpcResult as Record<string, unknown>)?.status === "rejected") {
    const rawReason = rpcError?.message ?? ((rpcResult as Record<string, unknown>)?.reason as string) ?? "Atomic trade write failed.";
    const reason = rawReason.includes("Insufficient lot balance for sell/swap accounting.")
      ? "Trade rejected by an outdated lot-based database function. Apply the latest portfolio ledger migration before retrying sell or swap flows."
      : rawReason;
    const retryable = ((rpcResult as Record<string, unknown>)?.retryable as boolean | undefined) ?? false;
    return { status: "rejected", reason, tradeId, retryable, tradeSide, tradeLabel };
  }

  const portfolioAfterTrade = await computeValuation(
    input.matchId,
    input.agentId,
    phase,
    Number(match.starting_capital_usd),
    input.smartAccountAddress,
  );

  await broadcastTradeUpdate({
    matchId: input.matchId,
    agentId: input.agentId,
    creatorAgentId: String(match.creator_agent_id),
    opponentAgentId: match.opponent_agent_id ? String(match.opponent_agent_id) : null,
    tradeId,
    phase,
    portfolioAfterTrade,
  });

  return {
    status: "accepted",
    tradeId,
    tradeSide,
    tradeLabel,
    realizedPnlUsd: Number((rpcResult as Record<string, unknown>)?.realizedPnlUsd ?? 0),
    closedCostBasisUsd: Number((rpcResult as Record<string, unknown>)?.closedCostBasisUsd ?? 0),
    outputAmount: quote.outputAmount,
    routing: quote.routing,
    priceImpactBps: quote.priceImpactBps,
    quoteSnapshotId: quote.snapshotId,
    portfolioAfterTrade,
  };
}

function rejectWithoutPersist(
  reason: string,
  retryable: boolean,
): TradeResult {
  return {
    status: "rejected",
    reason,
    retryable,
  };
}

function getParticipantForTrade(
  match: Record<string, unknown>,
  agentId: string,
): { seat: "creator" | "opponent"; smartAccountAddress: string } | null {
  if (match.creator_agent_id === agentId) {
    return {
      seat: "creator",
      smartAccountAddress: String(match.creator_smart_account_address ?? ""),
    };
  }

  if (match.opponent_agent_id === agentId) {
    return {
      seat: "opponent",
      smartAccountAddress: String(match.opponent_smart_account_address ?? ""),
    };
  }

  return null;
}

async function getRecentDuplicateRejectedTrade(params: {
  supabase: ReturnType<typeof createAdminClient>;
  matchId: string;
  agentId: string;
  tokenIn: string;
  tokenOut: string;
  amountInBaseUnits: string;
  now: Date;
}): Promise<{ reason: string; secondsAgo: number } | null> {
  const { data, error } = await params.supabase
    .from("simulated_trades")
    .select("failure_reason, accepted_at")
    .eq("match_id", params.matchId)
    .eq("agent_id", params.agentId)
    .eq("token_in", params.tokenIn)
    .eq("token_out", params.tokenOut)
    .eq("amount_in", params.amountInBaseUnits)
    .eq("status", "rejected")
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.accepted_at) {
    return null;
  }

  const acceptedAt = new Date(data.accepted_at as string);
  const secondsAgo = Math.floor((params.now.getTime() - acceptedAt.getTime()) / 1000);
  if (secondsAgo > 10) {
    return null;
  }

  return {
    reason: String(data.failure_reason ?? "unknown reason"),
    secondsAgo,
  };
}

async function persistAndReject(
  supabase: ReturnType<typeof createAdminClient>,
  input: SubmitTradeInput,
  tokenIn: string,
  tokenOut: string,
  reason: string,
  quoteSnapshotId?: string,
  phase?: string,
  tradeSide?: TradeSide,
  retryable = true,
): Promise<TradeResult> {
  const tradeId = crypto.randomUUID();
  try { await supabase.from("simulated_trades").insert({
    id: tradeId,
    match_id: input.matchId,
    agent_id: input.agentId,
    seat: input.seat,
    phase: phase ?? "rejected",
    token_in: tokenIn,
    token_out: tokenOut,
    amount_in: input.amountInBaseUnits,
    quoted_amount_out: "0",
    simulated_amount_out: "0",
    slippage_bps: 0,
    quote_snapshot_id: quoteSnapshotId ?? null,
    status: "rejected",
    failure_reason: reason,
    trade_side: tradeSide ?? null,
    retryable,
    accepted_at: new Date().toISOString(),
  }); } catch {}
  return { status: "rejected", reason, tradeId, tradeSide, retryable };
}

async function broadcastTradeUpdate(input: {
  matchId: string;
  agentId: string;
  creatorAgentId: string;
  opponentAgentId: string | null;
  tradeId: string;
  phase: string;
  portfolioAfterTrade: ValuationResult;
}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return;
  }

  const topics = [
    `match:${input.matchId}`,
    `agent:${input.creatorAgentId}:matches`,
  ];

  if (input.opponentAgentId) {
    topics.push(`agent:${input.opponentAgentId}:matches`);
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
            event: "trade_accepted",
            payload: {
              eventType: "trade.accepted",
              matchId: input.matchId,
              agentId: input.agentId,
              tradeId: input.tradeId,
              phase: input.phase,
              currentValueUsd: input.portfolioAfterTrade.currentValueUsd,
              totalPnlUsd: input.portfolioAfterTrade.totalPnlUsd,
              penaltyImpactUsd: input.portfolioAfterTrade.penaltyImpactUsd,
              netScoreUsd: input.portfolioAfterTrade.netScoreUsd,
              netScorePercent: input.portfolioAfterTrade.netScorePercent,
              topic,
              updatedAt: new Date().toISOString(),
            },
            private: false,
          }),
        });
      } catch (error) {
        console.error("[trade] Failed to broadcast trade update", error);
      }
    }),
  );
}

async function estimateTradeValueUsd(
  tokenAddress: string,
  amountBaseUnits: string,
  swapperAddress: string,
): Promise<number> {
  if (tokenAddress.toLowerCase() === USDC.toLowerCase()) {
    return Number(amountBaseUnits) / 1_000_000;
  }

  try {
    const quote = await fetchExactInputQuote({
      swapper: swapperAddress as `0x${string}`,
      tokenIn: tokenAddress as `0x${string}`,
      tokenOut: USDC as `0x${string}`,
      amountBaseUnits: amountBaseUnits,
      slippageBps: 200,
    });
    return Number(quote.outputAmount) / 1_000_000;
  } catch {
    return 0;
  }
}

async function estimateTradeValuesUsd(params: {
  tradeSide: TradeSide;
  tokenIn: string;
  amountInBaseUnits: string;
  tokenOut: string;
  amountOutBaseUnits: string;
  swapperAddress: string;
}): Promise<{ inputValueUsd: number; outputValueUsd: number } | null> {
  if (params.tradeSide === "buy") {
    const inputValueUsd = Number(params.amountInBaseUnits) / 1_000_000;
    return { inputValueUsd, outputValueUsd: inputValueUsd };
  }

  if (params.tokenOut.toLowerCase() === USDC.toLowerCase()) {
    const outputValueUsd = Number(params.amountOutBaseUnits) / 1_000_000;
    return { inputValueUsd: outputValueUsd, outputValueUsd };
  }

  const inputValueUsd = await estimateTradeValueUsd(
    params.tokenIn,
    params.amountInBaseUnits,
    params.swapperAddress,
  );

  if (inputValueUsd <= 0) {
    return null;
  }

  return { inputValueUsd, outputValueUsd: inputValueUsd };
}

function isRetryableQuoteError(error: unknown): boolean {
  if (!(error instanceof UniswapQuoteError)) {
    return true;
  }

  return error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500;
}

export async function getTradeHistoryForMatch(
  matchId: string,
  agentId?: string,
): Promise<Array<Record<string, unknown>>> {
  const supabase = createAdminClient();
  let query = supabase
    .from("simulated_trades")
    .select("*")
    .eq("match_id", matchId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: true });

  if (agentId) {
    query = query.eq("agent_id", agentId);
  }

  const { data, error } = await query;

  if (error) return [];
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}
