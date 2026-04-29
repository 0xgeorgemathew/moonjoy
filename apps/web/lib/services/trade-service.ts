import {
  isTradingAllowed,
  deriveMatchPhase,
  BASE_CHAIN_ID,
  QUOTE_MAX_AGE_SECONDS,
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
  applyTradeLedger,
  computeValuation,
  type ValuationResult,
} from "@/lib/services/portfolio-ledger-service";
import {
  getActiveTokensForMatch,
  isTokenAllowedForMatch,
  getTokenRiskTier,
  getMaxPriceImpactBps,
  getSlippageBps,
  getPositionLimitPercent,
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

  const { data: match } = await supabase
    .from("matches")
    .select("id, status, live_started_at, live_ends_at, starting_capital_usd, creator_agent_id, opponent_agent_id")
    .eq("id", input.matchId)
    .single();

  if (!match) {
    return rejectTrade("Match not found.");
  }

  const now = new Date();
  const phase = deriveMatchPhase(
    match.status as "created" | "warmup" | "live" | "settling" | "settled",
    match.live_started_at ? new Date(match.live_started_at) : null,
    match.live_ends_at ? new Date(match.live_ends_at) : null,
    now,
  );

  if (!isTradingAllowed(phase)) {
    return rejectTrade(`Trading is not allowed in phase ${phase}.`);
  }

  const tokenInAllowed = await isTokenAllowedForMatch(input.matchId, input.tokenIn);
  const tokenOutAllowed = await isTokenAllowedForMatch(input.matchId, input.tokenOut);
  if (!tokenInAllowed || !tokenOutAllowed) {
    return rejectTrade("One or both tokens are not in the match allowlist.");
  }

  const tokens = await getActiveTokensForMatch(input.matchId);
  const riskTierIn = getTokenRiskTier(tokens, input.tokenIn);
  const riskTierOut = getTokenRiskTier(tokens, input.tokenOut);
  if (!riskTierOut) {
    return rejectTrade("Cannot determine risk tier for output token.");
  }

  const slippageBps = getSlippageBps(riskTierOut);
  const maxPriceImpact = getMaxPriceImpactBps(riskTierOut);
  const maxPositionPercent = getPositionLimitPercent(riskTierOut);

  if (BigInt(input.amountInBaseUnits) <= BigInt(0)) {
    return rejectTrade("Trade amount must be positive.");
  }

  const balance = await getTokenBalance(input.matchId, input.agentId, input.tokenIn);
  if (BigInt(balance) < BigInt(input.amountInBaseUnits)) {
    return rejectTrade("Insufficient simulated balance.");
  }

  const tradeValueUsd = await estimateTradeValueUsd(
    input.tokenIn,
    input.amountInBaseUnits,
    input.smartAccountAddress,
  );

  if (tradeValueUsd < MIN_TRADE_USD) {
    return rejectTrade(`Trade value $${tradeValueUsd.toFixed(2)} is below minimum $${MIN_TRADE_USD}.`);
  }

  if (tradeValueUsd > input.startingCapitalUsd * (MAX_TRADE_PORTFOLIO_PERCENT / 100)) {
    return rejectTrade(`Trade value exceeds ${MAX_TRADE_PORTFOLIO_PERCENT}% of portfolio.`);
  }

  let quote: ValidatedQuote;
  try {
    quote = await fetchExactInputQuote({
      swapper: input.smartAccountAddress as `0x${string}`,
      tokenIn: input.tokenIn as `0x${string}`,
      tokenOut: input.tokenOut as `0x${string}`,
      amountBaseUnits: input.amountInBaseUnits,
      slippageBps,
    });
  } catch (err) {
    if (err instanceof UniswapQuoteError) {
      const detail = err.details ? ` ${err.details}` : "";
      return rejectTrade(`Quote failed: ${err.message}${detail}`);
    }
    return rejectTrade("Quote request failed unexpectedly.");
  }

  const validationError = validateQuoteForSimulatedFill(quote, {
    maxPriceImpactBps: maxPriceImpact,
    allowedRouting: ["CLASSIC", "WRAP", "UNWRAP"],
    fetchedAt: quote.fetchedAt,
  });

  if (validationError) {
    return rejectTrade(validationError.reason);
  }

  let outputValueUsd = await estimateTradeValueUsd(
    input.tokenOut,
    quote.outputAmount,
    input.smartAccountAddress,
  );

  const tradeId = crypto.randomUUID();
  const acceptedAt = now.toISOString();

  await supabase.from("simulated_trades").insert({
    id: tradeId,
    match_id: input.matchId,
    agent_id: input.agentId,
    seat: input.seat,
    phase,
    token_in: input.tokenIn,
    token_out: input.tokenOut,
    amount_in: input.amountInBaseUnits,
    quoted_amount_out: quote.outputAmount,
    simulated_amount_out: quote.outputAmount,
    slippage_bps: 0,
    quote_snapshot_id: quote.snapshotId,
    status: "accepted",
    accepted_at: acceptedAt,
  });

  await applyTradeLedger(
    input.matchId,
    input.agentId,
    tradeId,
    input.tokenIn,
    input.amountInBaseUnits,
    input.tokenOut,
    quote.outputAmount,
    tradeValueUsd,
    outputValueUsd,
  );

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
    return Number(amountBaseUnits) / 1_000_000;
  }
}

function rejectTrade(reason: string): TradeResult {
  return { status: "rejected", reason };
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
