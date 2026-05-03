import {
  isTradingAllowed,
  deriveMatchPhase,
  MIN_TRADE_USD,
  MAX_TRADE_PORTFOLIO_PERCENT,
  isWithinExposureCap,
  RISK_POLICIES,
  classifyTradeSide,
  deriveTradeLabel,
  type RiskTier,
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
  computeValuation,
  type ValuationResult,
} from "@/lib/services/portfolio-ledger-service";
import {
  getActiveTokensForMatch,
  isTokenAllowedForMatch,
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
  startingCapitalUsd: number;
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
    .select("id, status, live_started_at, live_ends_at, starting_capital_usd, creator_agent_id, opponent_agent_id, trade_rules_version")
    .eq("id", input.matchId)
    .single();

  if (!match) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Match not found.", undefined, "unknown", undefined, false);
  }

  const tradeRulesVersion = String((match as Record<string, unknown>).trade_rules_version ?? "buy_only_v1");
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

  if (tradeRulesVersion === "buy_only_v1" && tradeSide !== "buy") {
    return persistAndReject(
      supabase,
      input,
      normalizedTokenIn,
      normalizedTokenOut,
      "Buy-only v1 match: only USDC-funded buys are allowed.",
      undefined,
      phase,
      tradeSide,
      false,
    );
  }

  const balance = await getTokenBalance(input.matchId, input.agentId, normalizedTokenIn);
  const tradeLabel = deriveTradeLabel({
    tradeSide,
    currentBalanceBaseUnits: balance,
    amountInBaseUnits: input.amountInBaseUnits,
  });

  const tokens = await getActiveTokensForMatch(input.matchId);

  const tokenInAllowed =
    normalizedTokenIn === USDC.toLowerCase() ||
    await isTokenAllowedForMatch(input.matchId, normalizedTokenIn);
  const tokenOutAllowed =
    normalizedTokenOut === USDC.toLowerCase() ||
    await isTokenAllowedForMatch(input.matchId, normalizedTokenOut);

  if (tradeSide === "buy" && (!tokenInAllowed || !tokenOutAllowed)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Buy token is not in the active match allowlist.", undefined, phase, tradeSide);
  }

  if (tradeSide === "sell" && normalizedTokenOut !== USDC.toLowerCase()) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Sell trades must output USDC.", undefined, phase, tradeSide, false);
  }

  if (tradeSide === "swap" && !tokenOutAllowed) {
    return persistAndReject(
      supabase,
      input,
      normalizedTokenIn,
      normalizedTokenOut,
      "Swap output token is not in the active match allowlist.",
      undefined,
      phase,
      tradeSide,
    );
  }

  if (tradeSide !== "buy" && BigInt(balance) <= BigInt(0)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "No exitable balance for tokenIn.", undefined, phase, tradeSide, false);
  }

  const riskAddress = tradeSide === "sell" ? normalizedTokenIn : normalizedTokenOut;
  const riskTierToken: RiskTier = getTokenRiskTier(tokens, riskAddress) ?? "discovered";
  const slippageBps = getSlippageBps(riskTierToken);
  const maxPriceImpact = getMaxPriceImpactBps(riskTierToken);

  if (BigInt(input.amountInBaseUnits) <= BigInt(0)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Trade amount must be positive.", undefined, phase, tradeSide, false);
  }

  if (BigInt(balance) < BigInt(input.amountInBaseUnits)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Insufficient simulated balance.", undefined, phase, tradeSide, false);
  }

  const currentPortfolio = await computeValuation(
    input.matchId,
    input.agentId,
    phase,
    Number(match.starting_capital_usd),
    input.smartAccountAddress,
  );

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
  const fullExit = BigInt(input.amountInBaseUnits) >= BigInt(balance);

  if ((tradeSide === "buy" || (tradeSide === "swap" && !fullExit)) && inputValueUsd < MIN_TRADE_USD) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, `Trade value $${inputValueUsd.toFixed(2)} is below minimum $${MIN_TRADE_USD}.`, quote.snapshotId, phase, tradeSide);
  }

  if ((tradeSide === "buy" || tradeSide === "swap") && inputValueUsd > input.startingCapitalUsd * (MAX_TRADE_PORTFOLIO_PERCENT / 100)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, `Trade value exceeds ${MAX_TRADE_PORTFOLIO_PERCENT}% of portfolio.`, quote.snapshotId, phase, tradeSide);
  }

  if (tradeSide === "buy" || tradeSide === "swap") {
    const currentExposureBaseUnits = await getTokenBalance(input.matchId, input.agentId, normalizedTokenOut);
    const currentExposureUsd = await estimateTradeValueUsd(
      normalizedTokenOut,
      currentExposureBaseUnits,
      input.smartAccountAddress,
    );
    const positionLimitPercent = RISK_POLICIES[riskTierToken].maxPositionPercent;

    if (!isWithinExposureCap({
      currentExposureUsd,
      tradeValueUsd: outputValueUsd,
      portfolioValueUsd: currentPortfolio.currentValueUsd,
      maxPositionPercent: positionLimitPercent,
      increasesExposure: true,
    })) {
      return persistAndReject(
        supabase,
        input,
        normalizedTokenIn,
        normalizedTokenOut,
        `Trade would exceed ${positionLimitPercent}% exposure cap for ${riskTierToken} tokens.`,
        quote.snapshotId,
        phase,
        tradeSide,
      );
    }
  }

  const tradeId = crypto.randomUUID();
  const acceptedAt = now.toISOString();

  const rpcName = tradeRulesVersion === "bidirectional_v2"
    ? "accept_bidirectional_trade"
    : "accept_simulated_trade";
  const baseRpcArgs = {
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
  };
  const rpcArgs = rpcName === "accept_bidirectional_trade"
    ? { ...baseRpcArgs, p_trade_side: tradeLabel }
    : baseRpcArgs;

  const { data: rpcResult, error: rpcError } = await supabase.rpc(rpcName, rpcArgs);

  if (rpcError || (rpcResult as Record<string, unknown>)?.status === "rejected") {
    const reason = rpcError?.message ?? ((rpcResult as Record<string, unknown>)?.reason as string) ?? "Atomic trade write failed.";
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
