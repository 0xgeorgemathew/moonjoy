export type RiskTier = "blue_chip" | "pink_slip" | "discovered";

export type TokenRiskPolicy = {
  maxPositionPercent: number;
  maxPriceImpactBps: number;
  slippageBps: number;
};

export const RISK_POLICIES: Record<RiskTier, TokenRiskPolicy> = {
  blue_chip: {
    maxPositionPercent: 80,
    maxPriceImpactBps: 200,
    slippageBps: 50,
  },
  pink_slip: {
    maxPositionPercent: 25,
    maxPriceImpactBps: 500,
    slippageBps: 100,
  },
  discovered: {
    maxPositionPercent: 15,
    maxPriceImpactBps: 800,
    slippageBps: 150,
  },
};

export const BASE_CHAIN_ID = 8453;

export const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

export type TokenDefinition = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  riskTier: RiskTier;
};

export const MIN_TRADE_USD = 1;
export const MAX_TRADE_PORTFOLIO_PERCENT = 50;

export const DISCOVERY_DEFAULTS = {
  minLiquidityUsd: 50_000,
  minVolume24hUsd: 25_000,
  minTxns1h: 20,
  maxAgeHours: 1,
  minPairAgeHours: 1,
  cacheSeconds: 120,
};

export const ALLOWED_SIMULATED_ROUTING = new Set([
  "CLASSIC",
  "WRAP",
  "UNWRAP",
]);

export const REJECTED_ROUTING_TYPES = new Set([
  "DUTCH_V2",
  "DUTCH_V3",
  "PRIORITY",
  "LIMIT_ORDER",
  "BRIDGE",
  "CHAINED",
]);

export const QUOTE_MAX_AGE_SECONDS = 20;
export const VALUATION_REFRESH_SECONDS = 10;
export const PREVIEW_REFRESH_SECONDS = 10;
