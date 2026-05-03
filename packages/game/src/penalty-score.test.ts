import { expect, test } from "bun:test";
import {
  computePnlBreakdown,
  rankLeaderboard,
  selectMatchWinner,
} from "./pnl.ts";
import { computeMandatoryWindowPenalty } from "./phases.ts";

function makeRow(overrides = {}) {
  return {
    agentId: "a1",
    seat: "creator" as const,
    startingValueUsd: 100,
    currentValueUsd: 100,
    usdcBalanceUsd: 100,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    totalPnlUsd: 0,
    pnlPercent: 0,
    penaltiesUsd: 0,
    netScoreUsd: 0,
    netScorePercent: 0,
    mandatoryWindowsCompleted: 2,
    failedTradeCount: 0,
    maxDrawdownPercent: 0,
    lastProfitableTradeAt: null,
    ...overrides,
  };
}

test("penalties reduce net score but not total PnL", () => {
  const result = computePnlBreakdown(100, 120, 5, 2.5);
  expect(result.totalPnlUsd).toBe(20);
  expect(result.penaltiesUsd).toBe(2.5);
  expect(result.penaltyImpactUsd).toBe(-2.5);
  expect(result.netScoreUsd).toBe(17.5);
  expect(result.netScorePercent).toBeCloseTo(0.175);
});

test("penalty from mandatory window on $100 portfolio is $2.50", () => {
  expect(computeMandatoryWindowPenalty(100)).toBe(2.5);
});

test("penalty from mandatory window on $50 portfolio is $2.50 minimum", () => {
  expect(computeMandatoryWindowPenalty(50)).toBe(2.5);
});

test("penalty from mandatory window on $200 portfolio is $5.00", () => {
  expect(computeMandatoryWindowPenalty(200)).toBe(5);
});

test("agent with higher net normalized PnL wins", () => {
  const creator = makeRow({
    agentId: "a1",
    seat: "creator",
    usdcBalanceUsd: 90,
    netScoreUsd: 10,
    netScorePercent: 0.1,
    penaltiesUsd: 0,
  });
  const opponent = makeRow({
    agentId: "a2",
    seat: "opponent",
    usdcBalanceUsd: 110,
    netScoreUsd: 7.5,
    netScorePercent: 0.075,
    penaltiesUsd: 2.5,
  });

  const result = selectMatchWinner(creator, opponent);
  expect(result.outcome).toBe("winner");
  expect(result.winnerAgentId).toBe("a1");
});

test("agent with higher net normalized PnL after penalties can still win", () => {
  const creator = makeRow({
    agentId: "a1",
    seat: "creator",
    usdcBalanceUsd: 115,
    netScoreUsd: 12.5,
    netScorePercent: 0.125,
    penaltiesUsd: 2.5,
  });
  const opponent = makeRow({
    agentId: "a2",
    seat: "opponent",
    usdcBalanceUsd: 112,
    netScoreUsd: 12,
    netScorePercent: 0.12,
    penaltiesUsd: 0,
  });

  const result = selectMatchWinner(creator, opponent);
  expect(result.outcome).toBe("winner");
  expect(result.winnerAgentId).toBe("a1");
  expect(result.spreadUsd).toBeCloseTo(0.5);
});

test("rankLeaderboard reflects net normalized PnL ordering", () => {
  const rows = [
    makeRow({
      agentId: "penalized",
      seat: "creator",
      usdcBalanceUsd: 115,
      netScoreUsd: 12.5,
      netScorePercent: 0.125,
      penaltiesUsd: 2.5,
    }),
    makeRow({
      agentId: "clean",
      seat: "opponent",
      usdcBalanceUsd: 113,
      netScoreUsd: 13,
      netScorePercent: 0.13,
      penaltiesUsd: 0,
    }),
  ];

  const ranked = rankLeaderboard(rows);
  expect(ranked[0].agentId).toBe("clean");
  expect(ranked[1].agentId).toBe("penalized");
});

test("double mandatory window penalty totals $5.00 on $100 portfolio", () => {
  const penalty = computeMandatoryWindowPenalty(100);
  expect(penalty * 2).toBe(5);
});
