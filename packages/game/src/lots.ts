/**
 * Lot-based FIFO position tracking for bidirectional trading
 *
 * This module provides pure functions for:
 * - Classifying trades by side (buy/sell/swap)
 * - Closing lots FIFO with precise partial splits (no oversell)
 * - Computing realized PnL from lot closures
 * - Calculating exitable amounts
 *
 * These functions are runtime-agnostic and testable in isolation.
 * The accept_bidirectional_trade RPC implements equivalent logic in SQL
 * for atomicity within the database transaction.
 */

export type TradeSide = "buy" | "sell" | "swap";

export type Lot = {
  id: string;
  matchId: string;
  agentId: string;
  tokenAddress: string;
  acquiredAmountBaseUnits: string;
  remainingAmountBaseUnits: string;
  costBasisUsd: number;
  acquiredAt: Date;
  sourceTradeId?: string;
  closedAt?: Date;
};

export type ClosedLot = {
  lotId: string;
  amountClosedBaseUnits: string;
  costBasisClosedUsd: number;
  proceedsUsd: number;
  realizedPnlUsd: number;
};

export type LotClosureResult = {
  closedLots: ClosedLot[];
  remainingLots: Lot[];
  totalRealizedPnlUsd: number;
  totalClosedCostBasisUsd: number;
};

const USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

/**
 * Classify a trade by its token pair
 *
 * Rules:
 * - USDC -> token = buy
 * - token -> USDC = sell
 * - token -> token = swap
 * - USDC -> USDC = invalid (returns null)
 *
 * @param params - Token addresses to classify
 * @returns Trade side or null if invalid
 */
export function classifyTradeSide(params: {
  tokenIn: string;
  tokenOut: string;
  usdcAddress?: string;
}): TradeSide | null {
  const usdc = (params.usdcAddress ?? USDC_ADDRESS).toLowerCase();
  const tokenIn = params.tokenIn.toLowerCase();
  const tokenOut = params.tokenOut.toLowerCase();

  const isUsdcIn = tokenIn === usdc;
  const isUsdcOut = tokenOut === usdc;

  if (isUsdcIn && !isUsdcOut) {
    return "buy";
  }

  if (!isUsdcIn && isUsdcOut) {
    return "sell";
  }

  if (!isUsdcIn && !isUsdcOut) {
    return "swap";
  }

  // USDC -> USDC is invalid
  return null;
}

/**
 * Derive semantic trade label for display
 *
 * "exit" is a label for full-position sells, not a separate classification
 *
 * @param params - Trade details and current balance
 * @returns Display label for the trade
 */
export function deriveTradeLabel(params: {
  tradeSide: TradeSide;
  currentBalanceBaseUnits: string;
  amountInBaseUnits: string;
}): "buy" | "sell" | "swap" | "exit" {
  if (params.tradeSide === "sell") {
    const balance = BigInt(params.currentBalanceBaseUnits);
    const amount = BigInt(params.amountInBaseUnits);
    return amount >= balance ? "exit" : "sell";
  }

  return params.tradeSide;
}

/**
 * Close lots FIFO with precise partial lot splits
 *
 * This function NEVER oversells. If the final lot is larger than the
 * remaining quantity to close, it splits that lot precisely.
 *
 * @param input - Open lots, quantity to close, and current price
 * @returns Closed lots, remaining lots, and realized PnL
 * @throws Error if quantity to close exceeds available balance
 */
export function closeLotsFifoWithPnl(input: {
  openLots: Lot[];
  quantityToCloseBaseUnits: string;
  currentPriceUsdPerToken: number;
  tokenDecimals?: number;
}): LotClosureResult {
  const ZERO = BigInt(0);
  const toClose = BigInt(input.quantityToCloseBaseUnits);

  if (toClose < ZERO) {
    throw new Error("Quantity to close must be non-negative");
  }

  if (toClose === ZERO) {
    return {
      closedLots: [],
      remainingLots: input.openLots,
      totalRealizedPnlUsd: 0,
      totalClosedCostBasisUsd: 0,
    };
  }

  // Calculate total available balance
  const totalAvailable = input.openLots.reduce(
    (sum, lot) => sum + BigInt(lot.remainingAmountBaseUnits),
    ZERO
  );

  if (totalAvailable < toClose) {
    throw new Error(
      `Insufficient balance: available ${totalAvailable.toString()}, requested ${toClose.toString()}`
    );
  }

  const closed: ClosedLot[] = [];
  const remaining: Lot[] = [];
  let leftToClose = toClose;
  let totalRealizedPnl = 0;
  let totalClosedCostBasis = 0;
  const decimals = input.tokenDecimals ?? 18;

  // Sort lots by acquisition time (FIFO)
  const sortedLots = [...input.openLots].sort((a, b) =>
    a.acquiredAt.getTime() - b.acquiredAt.getTime()
  );

  for (const lot of sortedLots) {
    if (leftToClose === ZERO) {
      // No more to close, keep this lot as-is
      remaining.push(lot);
      continue;
    }

    const lotQty = BigInt(lot.remainingAmountBaseUnits);

    if (lotQty === ZERO) {
      // Skip already-closed lots
      continue;
    }

    if (lotQty <= leftToClose) {
      // Close this entire lot
      const closedRatio = Number(lotQty) / Number(lot.acquiredAmountBaseUnits);
      const closedCostBasis = lot.costBasisUsd * closedRatio;

      // Calculate proceeds: (lotQty / 10^decimals) * pricePerToken
      const proceedsUsd =
        (Number(lotQty) / Math.pow(10, decimals)) * input.currentPriceUsdPerToken;

      const realizedPnl = proceedsUsd - closedCostBasis;

      closed.push({
        lotId: lot.id,
        amountClosedBaseUnits: lotQty.toString(),
        costBasisClosedUsd: closedCostBasis,
        proceedsUsd,
        realizedPnlUsd: realizedPnl,
      });

      totalRealizedPnl += realizedPnl;
      totalClosedCostBasis += closedCostBasis;
      leftToClose -= lotQty;

      // Lot is fully closed, don't add to remaining
    } else {
      // Partial close: split the lot
      const closedRatio = Number(leftToClose) / Number(lot.acquiredAmountBaseUnits);
      const closedCostBasis = lot.costBasisUsd * closedRatio;

      const proceedsUsd =
        (Number(leftToClose) / Math.pow(10, decimals)) *
        input.currentPriceUsdPerToken;

      const realizedPnl = proceedsUsd - closedCostBasis;

      closed.push({
        lotId: lot.id,
        amountClosedBaseUnits: leftToClose.toString(),
        costBasisClosedUsd: closedCostBasis,
        proceedsUsd,
        realizedPnlUsd: realizedPnl,
      });

      totalRealizedPnl += realizedPnl;
      totalClosedCostBasis += closedCostBasis;

      // Add remaining portion as a new lot
      remaining.push({
        ...lot,
        remainingAmountBaseUnits: (lotQty - leftToClose).toString(),
        costBasisUsd: lot.costBasisUsd - closedCostBasis,
      });

      leftToClose = ZERO;
    }
  }

  return {
    closedLots: closed,
    remainingLots: remaining,
    totalRealizedPnlUsd: totalRealizedPnl,
    totalClosedCostBasisUsd: totalClosedCostBasis,
  };
}

/**
 * Calculate the exitable amount for a token
 *
 * @param openLots - Open lots for the token
 * @returns Total exitable amount in base units
 */
export function calculateExitableAmount(openLots: Lot[]): string {
  return openLots
    .filter((lot) => lot.closedAt === undefined)
    .reduce((sum, lot) => {
      return sum + BigInt(lot.remainingAmountBaseUnits);
    }, BigInt(0))
    .toString();
}

/**
 * Calculate total cost basis for open lots
 *
 * @param openLots - Open lots for the token
 * @returns Total cost basis in USD
 */
export function calculateOpenCostBasis(openLots: Lot[]): number {
  return openLots
    .filter((lot) => lot.closedAt === undefined)
    .reduce((sum, lot) => sum + lot.costBasisUsd, 0);
}

/**
 * Create a new lot from a buy or swap (tokenOut side)
 *
 * @param params - Trade details for lot creation
 * @returns New lot object
 */
export function createLotForTrade(params: {
  id?: string;
  matchId: string;
  agentId: string;
  tokenAddress: string;
  amountBaseUnits: string;
  costBasisUsd: number;
  acquiredAt: Date;
  sourceTradeId: string;
}): Lot {
  return {
    id: params.id ?? "",
    matchId: params.matchId,
    agentId: params.agentId,
    tokenAddress: params.tokenAddress,
    acquiredAmountBaseUnits: params.amountBaseUnits,
    remainingAmountBaseUnits: params.amountBaseUnits,
    costBasisUsd: params.costBasisUsd,
    acquiredAt: params.acquiredAt,
    sourceTradeId: params.sourceTradeId,
  };
}

/**
 * Check if a sell is a full exit (entire position)
 *
 * @param params - Trade details and current balance
 * @returns True if this sell closes the entire position
 */
export function isFullExit(params: {
  currentBalanceBaseUnits: string;
  amountInBaseUnits: string;
}): boolean {
  const balance = BigInt(params.currentBalanceBaseUnits);
  const amount = BigInt(params.amountInBaseUnits);
  return amount >= balance;
}
