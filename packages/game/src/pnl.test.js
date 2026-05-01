import { expect, test } from "bun:test";
import {
  computeMaxDrawdownPercent,
  computePnlBreakdown,
  rankLeaderboard,
  selectMatchWinner,
} from "./pnl.ts";

test("computePnlBreakdown computes all fields", () => {
  const result = computePnlBreakdown(100, 125, 10, 2.5);
  expect(result.realizedPnlUsd).toBe(10);
  expect(result.unrealizedPnlUsd).toBe(15);
  expect(result.totalPnlUsd).toBe(25);
  expect(result.pnlPercent).toBe(0.25);
  expect(result.penaltiesUsd).toBe(2.5);
  expect(result.penaltyImpactUsd).toBe(-2.5);
  expect(result.netScoreUsd).toBe(22.5);
  expect(result.netScorePercent).toBe(0.225);
});

test("computePnlBreakdown rejects zero starting value", () => {
  expect(() => computePnlBreakdown(0, 100, 0, 0)).toThrow(
    "Starting portfolio value must be greater than zero.",
  );
});

test("computeMaxDrawdownPercent returns correct drawdown", () => {
  expect(computeMaxDrawdownPercent(120, 100)).toBe(1 / 6);
  expect(computeMaxDrawdownPercent(100, 110)).toBe(0);
  expect(computeMaxDrawdownPercent(0, 50)).toBe(0);
});

test("selectMatchWinner picks higher USDC balance", () => {
  const creator = {
    agentId: "a1",
    seat: "creator",
    startingValueUsd: 100,
    currentValueUsd: 110,
    usdcBalanceUsd: 110,
    realizedPnlUsd: 5,
    unrealizedPnlUsd: 5,
    totalPnlUsd: 10,
    pnlPercent: 0.1,
    penaltiesUsd: 0,
    netScorePercent: 0.1,
    mandatoryWindowsCompleted: 2,
    failedTradeCount: 0,
    maxDrawdownPercent: 0,
    lastProfitableTradeAt: null,
  };
  const opponent = {
    ...creator,
    agentId: "a2",
    seat: "opponent",
    currentValueUsd: 105,
    usdcBalanceUsd: 105,
    totalPnlUsd: 5,
    pnlPercent: 0.05,
    netScorePercent: 0.05,
    realizedPnlUsd: 3,
    unrealizedPnlUsd: 2,
  };

  const result = selectMatchWinner(creator, opponent);
  expect(result.outcome).toBe("winner");
  expect(result.winnerAgentId).toBe("a1");
  expect(result.winnerSeat).toBe("creator");
});

test("selectMatchWinner ties break on realized PnL", () => {
  const base = {
    startingValueUsd: 100,
    currentValueUsd: 110,
    usdcBalanceUsd: 110,
    totalPnlUsd: 10,
    pnlPercent: 0.1,
    penaltiesUsd: 0,
    netScorePercent: 0.1,
    mandatoryWindowsCompleted: 2,
    failedTradeCount: 0,
    maxDrawdownPercent: 0,
    lastProfitableTradeAt: null,
    unrealizedPnlUsd: 5,
  };
  const creator = { ...base, agentId: "a1", seat: "creator", realizedPnlUsd: 8 };
  const opponent = { ...base, agentId: "a2", seat: "opponent", realizedPnlUsd: 3 };

  const result = selectMatchWinner(creator, opponent);
  expect(result.outcome).toBe("winner");
  expect(result.winnerAgentId).toBe("a1");
});

test("selectMatchWinner returns tie when fully equal", () => {
  const base = {
    agentId: "a1",
    seat: "creator",
    startingValueUsd: 100,
    currentValueUsd: 110,
    usdcBalanceUsd: 110,
    realizedPnlUsd: 5,
    unrealizedPnlUsd: 5,
    totalPnlUsd: 10,
    pnlPercent: 0.1,
    penaltiesUsd: 0,
    netScorePercent: 0.1,
    mandatoryWindowsCompleted: 2,
    failedTradeCount: 0,
    maxDrawdownPercent: 0,
    lastProfitableTradeAt: null,
  };
  const opponent = { ...base, agentId: "a2", seat: "opponent" };

  const result = selectMatchWinner(base, opponent);
  expect(result.outcome).toBe("tie");
  expect(result.winnerAgentId).toBe(null);
});

test("rankLeaderboard sorts by USDC balance minus penalties descending", () => {
  const rows = [
    { agentId: "a1", seat: "creator", startingValueUsd: 100, currentValueUsd: 100, usdcBalanceUsd: 100, realizedPnlUsd: 0, unrealizedPnlUsd: 0, totalPnlUsd: 0, pnlPercent: 0, penaltiesUsd: 0, netScorePercent: 0.05, mandatoryWindowsCompleted: 2, failedTradeCount: 0, maxDrawdownPercent: 0, lastProfitableTradeAt: null },
    { agentId: "a2", seat: "opponent", startingValueUsd: 100, currentValueUsd: 120, usdcBalanceUsd: 120, realizedPnlUsd: 10, unrealizedPnlUsd: 10, totalPnlUsd: 20, pnlPercent: 0.2, penaltiesUsd: 0, netScorePercent: 0.2, mandatoryWindowsCompleted: 2, failedTradeCount: 0, maxDrawdownPercent: 0, lastProfitableTradeAt: null },
  ];

  const ranked = rankLeaderboard(rows);
  expect(ranked[0].agentId).toBe("a2");
  expect(ranked[1].agentId).toBe("a1");
});
