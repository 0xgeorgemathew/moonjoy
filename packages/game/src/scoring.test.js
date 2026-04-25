import { expect, test } from "bun:test";
import { calculatePnl, selectWinner } from "./scoring.ts";

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

test("selectWinner returns the higher-valued seat", () => {
  expect(
    selectWinner([
      { seatId: "creator", valueUsd: 101.5 },
      { seatId: "opponent", valueUsd: 99.25 },
    ]),
  ).toEqual({
    outcome: "winner",
    winnerSeatId: "creator",
    spreadUsd: 2.25,
  });
});

test("selectWinner handles ties", () => {
  expect(
    selectWinner([
      { seatId: "creator", valueUsd: 100 },
      { seatId: "opponent", valueUsd: 100 },
    ]),
  ).toEqual({
    outcome: "tie",
    spreadUsd: 0,
  });
});
