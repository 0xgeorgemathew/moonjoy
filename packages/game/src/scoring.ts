export type PortfolioValue = {
  seatId: string;
  valueUsd: number;
};

export type PnlResult = {
  valueUsd: number;
  pnlUsd: number;
  pnlPercent: number;
};

export type PortfolioScore = PortfolioValue & PnlResult;

export type WinnerResult =
  | {
      outcome: "winner";
      winnerSeatId: string;
      spreadUsd: number;
      spreadPnlPercent: number;
    }
  | {
      outcome: "tie";
      spreadUsd: 0;
      spreadPnlPercent: 0;
    };

export function calculatePnl(
  startingValueUsd: number,
  currentValueUsd: number,
): PnlResult {
  if (startingValueUsd <= 0) {
    throw new Error("Starting value must be greater than zero.");
  }

  const pnlUsd = currentValueUsd - startingValueUsd;

  return {
    valueUsd: currentValueUsd,
    pnlUsd,
    pnlPercent: pnlUsd / startingValueUsd,
  };
}

export function scorePortfolio(
  seatId: string,
  startingValueUsd: number,
  currentValueUsd: number,
): PortfolioScore {
  return {
    seatId,
    ...calculatePnl(startingValueUsd, currentValueUsd),
  };
}

export function selectWinner(values: [PortfolioScore, PortfolioScore]): WinnerResult {
  const [first, second] = values;
  const spreadPnlPercent = Number(
    (first.pnlPercent - second.pnlPercent).toFixed(8),
  );

  if (spreadPnlPercent === 0) {
    return {
      outcome: "tie",
      spreadUsd: 0,
      spreadPnlPercent: 0,
    };
  }

  return {
    outcome: "winner",
    winnerSeatId: spreadPnlPercent > 0 ? first.seatId : second.seatId,
    spreadUsd: Math.abs(Number((first.pnlUsd - second.pnlUsd).toFixed(6))),
    spreadPnlPercent: Math.abs(spreadPnlPercent),
  };
}
