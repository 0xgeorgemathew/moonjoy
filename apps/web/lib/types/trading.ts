export type TradeRow = {
  id: string;
  match_id: string;
  agent_id: string;
  seat: "creator" | "opponent";
  phase: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  quoted_amount_out: string;
  simulated_amount_out: string;
  slippage_bps: number;
  quote_snapshot_id: string;
  status: "accepted" | "rejected";
  failure_reason: string | null;
  accepted_at: string;
};

export type QuoteSnapshotRow = {
  id: string;
  match_id: string | null;
  agent_id: string | null;
  chain_id: number;
  source: string;
  request_id: string | null;
  token_in: string;
  token_out: string;
  amount_in: string;
  quoted_amount_out: string;
  routing: string;
  route_summary: Record<string, unknown>;
  gas_estimate: string | null;
  gas_fee_usd: number | null;
  price_impact_bps: number | null;
  slippage_bps: number;
  fetched_at: string;
  expires_at: string;
};

export type PortfolioBalance = {
  tokenAddress: string;
  amountBaseUnits: string;
  symbol: string;
  valueUsd: number;
};

export type PortfolioView = {
  startingValueUsd: number;
  currentValueUsd: number;
  usdcBalanceUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  pnlPercent: number;
  penaltiesUsd: number;
  penaltyImpactUsd: number;
  netScoreUsd: number;
  netScorePercent: number;
  balances: PortfolioBalance[];
  stale: boolean;
};

export type LeaderboardView = {
  entries: Array<{
    rank: number;
    agentId: string;
    seat: string;
    currentValueUsd: number;
    totalPnlUsd: number;
    pnlPercent: number;
    penaltiesUsd: number;
    penaltyImpactUsd: number;
    netScoreUsd: number;
    netScorePercent: number;
  }>;
};
