/**
 * Lot service for bidirectional trading position tracking
 *
 * This service manages portfolio lots and lot closures in Supabase.
 * It provides the database layer for lot-based FIFO position tracking.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { PositionLot, ClosedLot } from "@moonjoy/game";

export type LotRow = {
  id: string;
  match_id: string;
  agent_id: string;
  token_address: string;
  acquired_amount_base_units: string;
  remaining_amount_base_units: string;
  cost_basis_usd: number;
  acquired_at: string;
  source_trade_id?: string;
  closed_at?: string;
  metadata?: Record<string, unknown>;
};

export type LotClosureRow = {
  id: string;
  match_id: string;
  agent_id: string;
  token_address: string;
  trade_id: string;
  lot_id: string;
  amount_closed_base_units: string;
  cost_basis_closed_usd: number;
  proceeds_usd: number;
  realized_pnl_usd: number;
  closed_at: string;
};

/**
 * Create a new lot from a trade (buy or swap tokenOut side)
 */
export async function createLot(params: {
  matchId: string;
  agentId: string;
  tokenAddress: string;
  acquiredAmountBaseUnits: string;
  costBasisUsd: number;
  acquiredAt: Date;
  sourceTradeId: string;
}): Promise<string> {
  const supabase = createAdminClient();
  const normalizedTokenAddress = params.tokenAddress.toLowerCase();

  const { data, error } = await supabase
    .from("portfolio_lots")
    .insert({
      match_id: params.matchId,
      agent_id: params.agentId,
      token_address: normalizedTokenAddress,
      acquired_amount_base_units: params.acquiredAmountBaseUnits,
      remaining_amount_base_units: params.acquiredAmountBaseUnits,
      cost_basis_usd: params.costBasisUsd,
      acquired_at: params.acquiredAt.toISOString(),
      source_trade_id: params.sourceTradeId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create lot: ${error?.message ?? "unknown error"}`);
  }

  return (data as { id: string }).id;
}

/**
 * Get all open lots for an agent in a match
 */
export async function getOpenLots(
  matchId: string,
  agentId: string,
  tokenAddress?: string,
): Promise<PositionLot[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("portfolio_lots")
    .select("*")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .is("closed_at", null)
    .order("acquired_at", { ascending: true });

  if (tokenAddress) {
    query = query.eq("token_address", tokenAddress.toLowerCase());
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return (data as LotRow[]).map(row => ({
    id: row.id,
    matchId: row.match_id,
    agentId: row.agent_id,
    tokenAddress: row.token_address,
    acquiredAmountBaseUnits: row.acquired_amount_base_units,
    remainingAmountBaseUnits: row.remaining_amount_base_units,
    costBasisUsd: row.cost_basis_usd,
    acquiredAt: new Date(row.acquired_at),
    sourceTradeId: row.source_trade_id,
    closedAt: row.closed_at ? new Date(row.closed_at) : undefined,
  }));
}

/**
 * Get all lots (including closed) for an agent in a match
 */
export async function getAllLots(
  matchId: string,
  agentId: string,
  tokenAddress?: string,
): Promise<PositionLot[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("portfolio_lots")
    .select("*")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .order("acquired_at", { ascending: true });

  if (tokenAddress) {
    query = query.eq("token_address", tokenAddress.toLowerCase());
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return (data as LotRow[]).map(row => ({
    id: row.id,
    matchId: row.match_id,
    agentId: row.agent_id,
    tokenAddress: row.token_address,
    acquiredAmountBaseUnits: row.acquired_amount_base_units,
    remainingAmountBaseUnits: row.remaining_amount_base_units,
    costBasisUsd: row.cost_basis_usd,
    acquiredAt: new Date(row.acquired_at),
    sourceTradeId: row.source_trade_id,
    closedAt: row.closed_at ? new Date(row.closed_at) : undefined,
  }));
}

/**
 * Get exitable amount for a token (sum of open lot remaining amounts)
 */
export async function getExitableAmount(
  matchId: string,
  agentId: string,
  tokenAddress: string,
): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("portfolio_lots")
    .select("remaining_amount_base_units")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .eq("token_address", tokenAddress.toLowerCase())
    .is("closed_at", null);

  if (error || !data) {
    return "0";
  }

  const total = (data as LotRow[]).reduce(
    (sum, row) => sum + BigInt(row.remaining_amount_base_units),
    BigInt(0)
  );

  return total.toString();
}

/**
 * Get cost basis for open lots of a token
 */
export async function getOpenCostBasis(
  matchId: string,
  agentId: string,
  tokenAddress: string,
): Promise<number> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("portfolio_lots")
    .select("cost_basis_usd")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .eq("token_address", tokenAddress.toLowerCase())
    .is("closed_at", null);

  if (error || !data) {
    return 0;
  }

  return (data as LotRow[]).reduce(
    (sum, row) => sum + (row.cost_basis_usd ?? 0),
    0
  );
}

/**
 * Get all open positions across all tokens for an agent in a match
 */
export async function getOpenPositions(
  matchId: string,
  agentId: string,
): Promise<Array<{
  tokenAddress: string;
  exitableAmountBaseUnits: string;
  costBasisUsd: number;
  lotCount: number;
}>> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("portfolio_lots")
    .select("token_address, remaining_amount_base_units, cost_basis_usd")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .is("closed_at", null);

  if (error || !data) {
    return [];
  }

  // Aggregate by token address
  const positions = new Map<string, { amount: bigint; costBasis: number; count: number }>();

  for (const row of data as LotRow[]) {
    const token = row.token_address.toLowerCase();
    const current = positions.get(token) ?? { amount: BigInt(0), costBasis: 0, count: 0 };

    positions.set(token, {
      amount: current.amount + BigInt(row.remaining_amount_base_units),
      costBasis: current.costBasis + (row.cost_basis_usd ?? 0),
      count: current.count + 1,
    });
  }

  return Array.from(positions.entries()).map(([tokenAddress, data]) => ({
    tokenAddress,
    exitableAmountBaseUnits: data.amount.toString(),
    costBasisUsd: data.costBasis,
    lotCount: data.count,
  }));
}

/**
 * Get lot closures for a trade (audit trail)
 */
export async function getLotClosuresForTrade(
  matchId: string,
  tradeId: string,
): Promise<ClosedLot[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("portfolio_lot_closures")
    .select("*")
    .eq("match_id", matchId)
    .eq("trade_id", tradeId)
    .order("closed_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as LotClosureRow[]).map(row => ({
    lotId: row.lot_id,
    amountClosedBaseUnits: row.amount_closed_base_units,
    costBasisClosedUsd: row.cost_basis_closed_usd,
    proceedsUsd: row.proceeds_usd,
    realizedPnlUsd: row.realized_pnl_usd,
  }));
}

/**
 * Get all lot closures for an agent in a match
 */
export async function getAllLotClosures(
  matchId: string,
  agentId: string,
): Promise<ClosedLot[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("portfolio_lot_closures")
    .select("*")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .order("closed_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as LotClosureRow[]).map(row => ({
    lotId: row.lot_id,
    amountClosedBaseUnits: row.amount_closed_base_units,
    costBasisClosedUsd: row.cost_basis_closed_usd,
    proceedsUsd: row.proceeds_usd,
    realizedPnlUsd: row.realized_pnl_usd,
  }));
}

/**
 * Get realized PnL sum for an agent in a match
 */
export async function getTotalRealizedPnl(
  matchId: string,
  agentId: string,
): Promise<number> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("portfolio_lot_closures")
    .select("realized_pnl_usd")
    .eq("match_id", matchId)
    .eq("agent_id", agentId);

  if (error || !data) {
    return 0;
  }

  return (data as LotClosureRow[]).reduce(
    (sum, row) => sum + (row.realized_pnl_usd ?? 0),
    0
  );
}
