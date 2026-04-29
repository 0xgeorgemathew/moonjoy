import { expect, test } from "bun:test";
import { calculatePnl, scorePortfolio, selectWinner } from "./scoring.ts";

test("calculatePnl returns absolute and percentage PnL", () => {
  expect(calculatePnl(100, 125)).toEqual({
    valueUsd: 125,
    pnlUsd: 25,
    pnlPercent: 0.25,
  });
});

test("calculatePnl rejects invalid starting values", () => {
  expect(() => calculatePnl(0, 125)).toThrow(
    "Starting value must be greater than zero.",
  );
});

test("scorePortfolio returns seat-attributed PnL", () => {
  expect(scorePortfolio("creator", 100, 125)).toEqual({
    seatId: "creator",
    valueUsd: 125,
    pnlUsd: 25,
    pnlPercent: 0.25,
  });
});

test("selectWinner returns the higher normalized PnL seat", () => {
  expect(
    selectWinner([
      scorePortfolio("creator", 1000, 1050),
      scorePortfolio("opponent", 100, 110),
    ]),
  ).toEqual({
    outcome: "winner",
    winnerSeatId: "opponent",
    spreadUsd: 40,
    spreadPnlPercent: 0.05,
  });
});

test("selectWinner handles ties", () => {
  expect(
    selectWinner([
      scorePortfolio("creator", 100, 110),
      scorePortfolio("opponent", 200, 220),
    ]),
  ).toEqual({
    outcome: "tie",
    spreadUsd: 0,
    spreadPnlPercent: 0,
  });
});
