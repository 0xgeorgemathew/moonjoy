import {
  ALLOWED_SIMULATED_ROUTING,
  BASE_CHAIN_ID,
  QUOTE_MAX_AGE_SECONDS,
  REJECTED_ROUTING_TYPES,
} from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";

type QuoteRequestPayload = {
  type: "EXACT_INPUT";
  tokenInChainId: number;
  tokenOutChainId: number;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  swapper: string;
  slippageTolerance: number;
  routingPreference: "BEST_PRICE";
  protocols: string[];
  urgency: "normal";
};

export type QuoteExactInputParams = {
  swapper: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountBaseUnits: string;
  slippageBps: number;
};

export type ValidatedQuote = {
  outputAmount: string;
  routing: string;
  requestId: string | null;
  gasEstimate: string | null;
  gasFeeUsd: number | null;
  priceImpactBps: number | null;
  routeSummary: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  snapshotId: string;
  fetchedAt: string;
};

export type QuoteValidationError = {
  reason: string;
  details?: string;
};

export class UniswapQuoteError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public details?: string,
  ) {
    super(message);
  }
}

function isValidEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

function getApiKey(): string {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) {
    throw new UniswapQuoteError("UNISWAP_API_KEY is not configured.", 500);
  }
  return key;
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...payload };
  delete sanitized.apiKey;
  return sanitized;
}

async function callUniswapQuote(
  payload: QuoteRequestPayload,
): Promise<{ data: Record<string, unknown>; status: number }> {
  const apiKey = getApiKey();
  const response = await fetch(`${UNISWAP_API_BASE}/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": apiKey,
      "x-universal-router-version": "2.0",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new UniswapQuoteError(
      `Uniswap quote request failed with status ${response.status}`,
      response.status,
      JSON.stringify(sanitizePayload(data)),
    );
  }

  return { data, status: response.status };
}

function extractOutputAmount(data: Record<string, unknown>): string {
  const routing = data.routing as string | undefined;

  if (
    routing === "DUTCH_V2" ||
    routing === "DUTCH_V3" ||
    routing === "PRIORITY"
  ) {
    const quote = data.quote as Record<string, unknown> | undefined;
    const orderInfo = quote?.orderInfo as Record<string, unknown> | undefined;
    const outputs = orderInfo?.outputs as Array<{ startAmount: string }> | undefined;
    const firstOutput = outputs?.[0];
    if (!firstOutput) {
      throw new UniswapQuoteError("UniswapX quote has no output.", 502);
    }
    return firstOutput.startAmount;
  }

  const quote = data.quote as Record<string, unknown> | undefined;
  const output = quote?.output as Record<string, unknown> | undefined;
  if (!output?.amount) {
    throw new UniswapQuoteError("Quote response has no output amount.", 502);
  }
  return String(output.amount);
}

export async function fetchExactInputQuote(
  params: QuoteExactInputParams,
): Promise<ValidatedQuote> {
  if (!isValidEvmAddress(params.tokenIn)) {
    throw new UniswapQuoteError("Invalid tokenIn address.", 400);
  }
  if (!isValidEvmAddress(params.tokenOut)) {
    throw new UniswapQuoteError("Invalid tokenOut address.", 400);
  }
  if (!isValidEvmAddress(params.swapper)) {
    throw new UniswapQuoteError("Invalid swapper address.", 400);
  }
  if (!params.amountBaseUnits || BigInt(params.amountBaseUnits) <= BigInt(0)) {
    throw new UniswapQuoteError("Amount must be positive.", 400);
  }

  const slippagePercent = Number((params.slippageBps / 100).toFixed(2));

  const payload: QuoteRequestPayload = {
    type: "EXACT_INPUT",
    tokenInChainId: BASE_CHAIN_ID,
    tokenOutChainId: BASE_CHAIN_ID,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amount: params.amountBaseUnits,
    swapper: params.swapper,
    slippageTolerance: slippagePercent,
    routingPreference: "BEST_PRICE",
    protocols: ["V2", "V3", "V4"],
    urgency: "normal",
  };

  const { data } = await callUniswapQuote(payload);

  const routing = (data.routing as string) ?? "UNKNOWN";

  if (REJECTED_ROUTING_TYPES.has(routing)) {
    throw new UniswapQuoteError(
      `Routing type ${routing} is not supported for simulated fills.`,
      400,
      routing,
    );
  }

  if (!data.routing) {
    throw new UniswapQuoteError("Quote response is missing routing field.", 502);
  }

  const outputAmount = extractOutputAmount(data);
  if (!outputAmount || BigInt(outputAmount) <= BigInt(0)) {
    throw new UniswapQuoteError("Quote output amount is zero or missing.", 502);
  }

  const txFailureReasons = data.txFailureReasons as unknown[] | undefined;
  if (txFailureReasons && txFailureReasons.length > 0) {
    throw new UniswapQuoteError(
      "Quote has transaction failure reasons.",
      400,
      JSON.stringify(txFailureReasons),
    );
  }

  const quote = data.quote as Record<string, unknown> | undefined;
  const route = quote?.route as Array<Record<string, unknown>> | undefined;
  const gasEstimate = String(
    quote?.gasEstimate ?? quote?.gasUseEstimate ?? "",
  ) || null;
  const gasFeeUsd = normalizeNumeric(
    quote?.gasFeeUsd ?? quote?.gasFeeUSD ?? null,
  );
  const priceImpactBps = normalizePriceImpactBps(quote?.priceImpact ?? null);
  const requestId = (data.requestId ?? null) as string | null;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUOTE_MAX_AGE_SECONDS * 1000);

  const sanitizedResponse = sanitizePayload(data);
  const snapshotId = await storeQuoteSnapshot({
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountBaseUnits,
    quotedAmountOut: outputAmount,
    routing,
    routeSummary: route ? { route } : {},
    gasEstimate,
    gasFeeUsd,
    priceImpactBps,
    slippageBps: params.slippageBps,
    requestId,
    requestPayload: sanitizePayload(payload as unknown as Record<string, unknown>),
    responsePayload: sanitizedResponse,
    fetchedAt: now,
    expiresAt,
  });

  return {
    outputAmount,
    routing,
    requestId,
    gasEstimate,
    gasFeeUsd,
    priceImpactBps,
    routeSummary: route ? { route } : {},
    responsePayload: sanitizedResponse,
    snapshotId,
    fetchedAt: now.toISOString(),
  };
}

export function validateQuoteForSimulatedFill(
  quote: ValidatedQuote,
  options: {
    maxAgeSeconds?: number;
    maxPriceImpactBps?: number;
    allowedRouting?: string[];
    fetchedAt?: string;
  } = {},
): QuoteValidationError | null {
  const maxAge = options.maxAgeSeconds ?? QUOTE_MAX_AGE_SECONDS;
  const maxPriceImpact = options.maxPriceImpactBps ?? 800;
  const allowed = options.allowedRouting ?? [...ALLOWED_SIMULATED_ROUTING];

  if (options.fetchedAt) {
    const ageMs = Date.now() - new Date(options.fetchedAt).getTime();
    if (ageMs > maxAge * 1000) {
      return {
        reason: `Quote is ${Math.round(ageMs / 1000)}s old, max age is ${maxAge}s.`,
      };
    }
  }

  if (!allowed.includes(quote.routing)) {
    return {
      reason: `Routing type ${quote.routing} is not allowed for simulated fills.`,
    };
  }

  const priceImpact = quote.priceImpactBps;
  if (priceImpact !== null && priceImpact > maxPriceImpact) {
    return {
      reason: `Price impact ${priceImpact} bps exceeds max ${maxPriceImpact} bps.`,
    };
  }

  return null;
}

async function storeQuoteSnapshot(params: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  quotedAmountOut: string;
  routing: string;
  routeSummary: Record<string, unknown>;
  gasEstimate: string | null;
  gasFeeUsd: number | null;
  priceImpactBps: number | null;
  slippageBps: number;
  requestId: string | null;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  fetchedAt: Date;
  expiresAt: Date;
}): Promise<string> {
  const supabase = createAdminClient();
  const id = crypto.randomUUID();

  const { error } = await supabase.from("quote_snapshots").insert({
    id,
    chain_id: BASE_CHAIN_ID,
    source: "uniswap",
    request_id: params.requestId,
    token_in: params.tokenIn,
    token_out: params.tokenOut,
    amount_in: params.amountIn,
    quoted_amount_out: params.quotedAmountOut,
    routing: params.routing,
    route_summary: params.routeSummary,
    gas_estimate: params.gasEstimate,
    gas_fee_usd: params.gasFeeUsd,
    price_impact_bps: params.priceImpactBps,
    slippage_bps: params.slippageBps,
    request_payload: params.requestPayload,
    response_payload: params.responsePayload,
    fetched_at: params.fetchedAt.toISOString(),
    expires_at: params.expiresAt.toISOString(),
  });

  if (error) {
    throw new UniswapQuoteError(
      "Failed to store quote snapshot.",
      500,
      error.message,
    );
  }

  return id;
}

function normalizeNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePriceImpactBps(value: unknown): number | null {
  const numeric = normalizeNumeric(value);
  if (numeric === null) {
    return null;
  }

  // Uniswap quote responses expose priceImpact as a percentage value
  // such as 0.14 for 0.14%. Store integer basis points.
  if (numeric >= 0 && numeric <= 100) {
    return Math.round(numeric * 100);
  }

  return Math.round(numeric);
}

export async function fetchValuationQuote(
  tokenAddress: string,
  amountBaseUnits: string,
  swapper: string,
): Promise<{ outputAmount: string; snapshotId: string } | null> {
  const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const ETH_NATIVE = "0x0000000000000000000000000000000000000000";

  if (
    tokenAddress.toLowerCase() === USDC_BASE.toLowerCase() ||
    amountBaseUnits === "0"
  ) {
    return null;
  }

  const quoteOut = USDC_BASE;
  const tokenIn =
    tokenAddress.toLowerCase() === ETH_NATIVE.toLowerCase()
      ? "0x4200000000000000000000000000000000000006"
      : tokenAddress;

  try {
    const quote = await fetchExactInputQuote({
      swapper: swapper as `0x${string}`,
      tokenIn: tokenIn as `0x${string}`,
      tokenOut: quoteOut as `0x${string}`,
      amountBaseUnits,
      slippageBps: 100,
    });

    return {
      outputAmount: quote.outputAmount,
      snapshotId: quote.snapshotId,
    };
  } catch {
    return null;
  }
}
