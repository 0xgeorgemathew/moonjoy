export type Lot = {
  tokenAddress: string;
  quantityBaseUnits: string;
  costBasisUsd: number;
  acquiredAt: Date;
};

export type TradeFill = {
  tokenIn: string;
  tokenOut: string;
  amountInBaseUnits: string;
  amountOutBaseUnits: string;
  outputValueUsd: number;
};

export type PnlBreakdown = {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  pnlPercent: number;
  penaltiesUsd: number;
  penaltyImpactUsd: number;
  netScoreUsd: number;
  netScorePercent: number;
};

export type LeaderboardRow = {
  agentId: string;
  seat: "creator" | "opponent";
  startingValueUsd: number;
  currentValueUsd: number;
  usdcBalanceUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  pnlPercent: number;
  penaltiesUsd: number;
  netScoreUsd: number;
  netScorePercent: number;
  mandatoryWindowsCompleted: number;
  failedTradeCount: number;
  maxDrawdownPercent: number;
  lastProfitableTradeAt: Date | null;
};

export type WinnerSelection = {
  winnerAgentId: string | null;
  winnerSeat: "creator" | "opponent" | null;
  outcome: "winner" | "tie";
  spreadUsd: number;
  spreadPnlPercent: number;
};

export function computePnlBreakdown(
  startingValueUsd: number,
  currentValueUsd: number,
  realizedPnlUsd: number,
  penaltiesUsd: number,
): PnlBreakdown {
  if (startingValueUsd <= 0) {
    throw new Error("Starting portfolio value must be greater than zero.");
  }

  const unrealizedPnlUsd = currentValueUsd - startingValueUsd - realizedPnlUsd;
  const totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd;
  const pnlPercent = totalPnlUsd / startingValueUsd;
  const penaltyImpactUsd = -penaltiesUsd;
  const netScoreUsd = totalPnlUsd + penaltyImpactUsd;
  const netScorePercent = netScoreUsd / startingValueUsd;

  return {
    realizedPnlUsd,
    unrealizedPnlUsd,
    totalPnlUsd,
    pnlPercent,
    penaltiesUsd,
    penaltyImpactUsd,
    netScoreUsd,
    netScorePercent,
  };
}

export function closeLotsFifo(
  lots: Lot[],
  quantityToClose: string,
): { closedLots: Lot[]; closedCostBasisUsd: number; remainingLots: Lot[] } {
  const toClose = BigInt(quantityToClose);
  const ZERO = BigInt(0);
  if (toClose < ZERO) {
    throw new Error("Quantity to close must be non-negative.");
  }

  if (toClose === ZERO) {
    return { closedLots: [], closedCostBasisUsd: 0, remainingLots: [...lots] };
  }

  const remaining: Lot[] = [];
  const closed: Lot[] = [];
  let closedCostBasis = 0;
  let leftToClose = toClose;

  for (const lot of lots) {
    if (leftToClose === ZERO) {
      remaining.push(lot);
      continue;
    }

    const lotQty = BigInt(lot.quantityBaseUnits);
    if (lotQty <= leftToClose) {
      leftToClose -= lotQty;
      closed.push(lot);
      closedCostBasis += lot.costBasisUsd;
    } else {
      const closedRatio = Number(leftToClose) / Number(lotQty);
      const closedCost = lot.costBasisUsd * closedRatio;
      closedCostBasis += closedCost;
      remaining.push({
        ...lot,
        quantityBaseUnits: (lotQty - leftToClose).toString(),
        costBasisUsd: lot.costBasisUsd - closedCost,
      });
      leftToClose = ZERO;
    }
  }

  return {
    closedLots: closed,
    closedCostBasisUsd: closedCostBasis,
    remainingLots: remaining,
  };
}

export function computeMaxDrawdownPercent(
  peakValueUsd: number,
  currentValueUsd: number,
): number {
  if (peakValueUsd <= 0) return 0;
  return Math.max(0, (peakValueUsd - currentValueUsd) / peakValueUsd);
}

export function selectMatchWinner(
  creator: LeaderboardRow,
  opponent: LeaderboardRow,
): WinnerSelection {
  const creatorUsdc = creator.usdcBalanceUsd - creator.penaltiesUsd;
  const opponentUsdc = opponent.usdcBalanceUsd - opponent.penaltiesUsd;

  if (creatorUsdc > opponentUsdc) {
    return {
      winnerAgentId: creator.agentId,
      winnerSeat: creator.seat,
      outcome: "winner",
      spreadUsd: Math.abs(creatorUsdc - opponentUsdc),
      spreadPnlPercent: Math.abs((creatorUsdc - opponentUsdc) / creator.startingValueUsd),
    };
  }

  if (opponentUsdc > creatorUsdc) {
    return {
      winnerAgentId: opponent.agentId,
      winnerSeat: opponent.seat,
      outcome: "winner",
      spreadUsd: Math.abs(creatorUsdc - opponentUsdc),
      spreadPnlPercent: Math.abs((creatorUsdc - opponentUsdc) / opponent.startingValueUsd),
    };
  }

  if (creator.realizedPnlUsd > opponent.realizedPnlUsd) {
    return {
      winnerAgentId: creator.agentId,
      winnerSeat: creator.seat,
      outcome: "winner",
      spreadUsd: Math.abs(creator.realizedPnlUsd - opponent.realizedPnlUsd),
      spreadPnlPercent: 0,
    };
  }

  if (opponent.realizedPnlUsd > creator.realizedPnlUsd) {
    return {
      winnerAgentId: opponent.agentId,
      winnerSeat: opponent.seat,
      outcome: "winner",
      spreadUsd: Math.abs(creator.realizedPnlUsd - opponent.realizedPnlUsd),
      spreadPnlPercent: 0,
    };
  }

  if (creator.failedTradeCount < opponent.failedTradeCount) {
    return {
      winnerAgentId: creator.agentId,
      winnerSeat: creator.seat,
      outcome: "winner",
      spreadUsd: 0,
      spreadPnlPercent: 0,
    };
  }

  if (opponent.failedTradeCount < creator.failedTradeCount) {
    return {
      winnerAgentId: opponent.agentId,
      winnerSeat: opponent.seat,
      outcome: "winner",
      spreadUsd: 0,
      spreadPnlPercent: 0,
    };
  }

  return {
    winnerAgentId: null,
    winnerSeat: null,
    outcome: "tie",
    spreadUsd: 0,
    spreadPnlPercent: 0,
  };
}

export function rankLeaderboard(rows: LeaderboardRow[]): LeaderboardRow[] {
  return [...rows].sort((a, b) => {
    const aNet = a.usdcBalanceUsd - a.penaltiesUsd;
    const bNet = b.usdcBalanceUsd - b.penaltiesUsd;
    if (bNet !== aNet) return bNet - aNet;
    if (b.realizedPnlUsd !== a.realizedPnlUsd) return b.realizedPnlUsd - a.realizedPnlUsd;
    if (a.failedTradeCount !== b.failedTradeCount) return a.failedTradeCount - b.failedTradeCount;
    return 0;
  });
}
