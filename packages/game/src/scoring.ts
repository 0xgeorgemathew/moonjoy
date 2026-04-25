export type PortfolioValue = {
  seatId: string;
  valueUsd: number;
};

export type PnlResult = {
  valueUsd: number;
  pnlUsd: number;
  pnlPercent: number;
};

export type WinnerResult =
  | {
      outcome: "winner";
      winnerSeatId: string;
      spreadUsd: number;
    }
  | {
      outcome: "tie";
      spreadUsd: 0;
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

export function selectWinner(values: [PortfolioValue, PortfolioValue]): WinnerResult {
  const [first, second] = values;
  const spreadUsd = Number((first.valueUsd - second.valueUsd).toFixed(6));

  if (spreadUsd === 0) {
    return {
      outcome: "tie",
      spreadUsd: 0,
    };
  }

  return {
    outcome: "winner",
    winnerSeatId: spreadUsd > 0 ? first.seatId : second.seatId,
    spreadUsd: Math.abs(spreadUsd),
  };
}
