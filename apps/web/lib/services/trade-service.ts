import {
  isTradingAllowed,
  deriveMatchPhase,
  MIN_TRADE_USD,
  MAX_TRADE_PORTFOLIO_PERCENT,
} from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchExactInputQuote,
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
};

export type TradeResult = {
  status: "accepted" | "rejected";
  tradeId?: string;
  reason?: string;
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
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "tokenIn and tokenOut must be different.", undefined, "rejected");
  }

  const { data: match } = await supabase
    .from("matches")
    .select("id, status, live_started_at, live_ends_at, starting_capital_usd, creator_agent_id, opponent_agent_id")
    .eq("id", input.matchId)
    .single();

  if (!match) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Match not found.", undefined, "unknown");
  }

  const now = new Date();
  const phase = deriveMatchPhase(
    match.status as "created" | "warmup" | "live" | "settling" | "settled",
    match.live_started_at ? new Date(match.live_started_at) : null,
    match.live_ends_at ? new Date(match.live_ends_at) : null,
    now,
  );

  if (!isTradingAllowed(phase)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, `Trading is not allowed in phase ${phase}.`, undefined, phase);
  }

  const tokenInAllowed = await isTokenAllowedForMatch(input.matchId, normalizedTokenIn);
  const tokenOutAllowed = await isTokenAllowedForMatch(input.matchId, normalizedTokenOut);
  if (!tokenInAllowed || !tokenOutAllowed) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "One or both tokens are not in the match allowlist.", undefined, phase);
  }

  const tokens = await getActiveTokensForMatch(input.matchId);
  const isBuy = normalizedTokenIn === USDC.toLowerCase();
  const riskTierToken = isBuy
    ? getTokenRiskTier(tokens, normalizedTokenOut)
    : getTokenRiskTier(tokens, normalizedTokenIn);
  if (!riskTierToken) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Cannot determine risk tier for trade token.", undefined, phase);
  }

  const slippageBps = getSlippageBps(riskTierToken);
  const maxPriceImpact = getMaxPriceImpactBps(riskTierToken);

  if (BigInt(input.amountInBaseUnits) <= BigInt(0)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Trade amount must be positive.", undefined, phase);
  }

  const balance = await getTokenBalance(input.matchId, input.agentId, normalizedTokenIn);
  if (BigInt(balance) < BigInt(input.amountInBaseUnits)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, "Insufficient simulated balance.", undefined, phase);
  }

  const tradeValueUsd = await estimateTradeValueUsd(
    normalizedTokenIn,
    input.amountInBaseUnits,
    input.smartAccountAddress,
  );

  if (tradeValueUsd < MIN_TRADE_USD) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, `Trade value $${tradeValueUsd.toFixed(2)} is below minimum $${MIN_TRADE_USD}.`, undefined, phase);
  }

  if (tradeValueUsd > input.startingCapitalUsd * (MAX_TRADE_PORTFOLIO_PERCENT / 100)) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, `Trade value exceeds ${MAX_TRADE_PORTFOLIO_PERCENT}% of portfolio.`, undefined, phase);
  }

  let quote: ValidatedQuote;
  try {
    quote = await fetchExactInputQuote({
      swapper: input.smartAccountAddress as `0x${string}`,
      tokenIn: normalizedTokenIn as `0x${string}`,
      tokenOut: normalizedTokenOut as `0x${string}`,
      amountBaseUnits: input.amountInBaseUnits,
      slippageBps,
    });
  } catch (err) {
    const detail = err instanceof UniswapQuoteError && err.details ? ` ${err.details}` : "";
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, `Quote failed: ${err instanceof Error ? err.message : "Unexpected"}${detail}`, undefined, phase);
  }

  const validationError = validateQuoteForSimulatedFill(quote, {
    maxPriceImpactBps: maxPriceImpact,
    allowedRouting: ["CLASSIC", "WRAP", "UNWRAP"],
    fetchedAt: quote.fetchedAt,
  });

  if (validationError) {
    return persistAndReject(supabase, input, normalizedTokenIn, normalizedTokenOut, validationError.reason, quote.snapshotId, phase);
  }

  const outputValueUsd = await estimateTradeValueUsd(
    normalizedTokenOut,
    quote.outputAmount,
    input.smartAccountAddress,
  );

  const tradeId = crypto.randomUUID();
  const acceptedAt = now.toISOString();

  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    "accept_simulated_trade",
    {
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
      p_input_value_usd: tradeValueUsd,
      p_output_value_usd: outputValueUsd,
      p_accepted_at: acceptedAt,
    },
  );

  if (rpcError || (rpcResult as Record<string, unknown>)?.status === "rejected") {
    const reason = rpcError?.message ?? ((rpcResult as Record<string, unknown>)?.reason as string) ?? "Atomic trade write failed.";
    return { status: "rejected", reason, tradeId };
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
    accepted_at: new Date().toISOString(),
  }); } catch {}
  return { status: "rejected", reason, tradeId };
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
