import { expect, test } from "bun:test";
import {
  closeLotsFifo,
  computePnlBreakdown,
  isTokenInAllowlist,
  mapViewerSeats,
  selectMatchWinner,
  type LeaderboardRow,
} from "./index.ts";

function makeRow(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    agentId: "agent-1",
    seat: "creator",
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

test("viewer panel maps creator and opponent seats explicitly", () => {
  expect(mapViewerSeats({ viewerSeat: "creator", creator: "creator-panel", opponent: "opponent-panel" })).toEqual({
    viewer: "creator-panel",
    opponent: "opponent-panel",
  });

  expect(mapViewerSeats({ viewerSeat: "opponent", creator: "creator-panel", opponent: "opponent-panel" })).toEqual({
    viewer: "opponent-panel",
    opponent: "creator-panel",
  });
});

test("token allowlist checks tolerate checksum and lowercase addresses", () => {
  const allowlist = ["0x4200000000000000000000000000000000000006"];
  expect(isTokenInAllowlist(allowlist, "0x4200000000000000000000000000000000000006")).toBe(true);
  expect(isTokenInAllowlist(allowlist, "0x4200000000000000000000000000000000000006".toUpperCase())).toBe(true);
  expect(isTokenInAllowlist(allowlist, "0x0000000000000000000000000000000000000000")).toBe(false);
});

test("winner uses net PnL percent instead of raw PnL percent", () => {
  const creatorPnl = computePnlBreakdown(100, 112, 0, 15);
  const opponentPnl = computePnlBreakdown(100, 106, 0, 0);

  const result = selectMatchWinner(
    makeRow({
      agentId: "creator-agent",
      seat: "creator",
      usdcBalanceUsd: 50,
      penaltiesUsd: creatorPnl.penaltiesUsd,
      pnlPercent: creatorPnl.pnlPercent,
      netScoreUsd: creatorPnl.netScoreUsd,
      netScorePercent: creatorPnl.netScorePercent,
    }),
    makeRow({
      agentId: "opponent-agent",
      seat: "opponent",
      usdcBalanceUsd: 100,
      penaltiesUsd: opponentPnl.penaltiesUsd,
      pnlPercent: opponentPnl.pnlPercent,
      netScoreUsd: opponentPnl.netScoreUsd,
      netScorePercent: opponentPnl.netScorePercent,
    }),
  );

  expect(creatorPnl.pnlPercent).toBeGreaterThan(opponentPnl.pnlPercent);
  expect(creatorPnl.netScorePercent).toBeLessThan(opponentPnl.netScorePercent);
  expect(result.winnerAgentId).toBe("opponent-agent");
});

test("sell path closes lots FIFO and reduces exposure", () => {
  const result = closeLotsFifo(
    [
      { tokenAddress: "0xabc", quantityBaseUnits: "100", costBasisUsd: 10, acquiredAt: new Date("2026-01-01") },
      { tokenAddress: "0xabc", quantityBaseUnits: "100", costBasisUsd: 20, acquiredAt: new Date("2026-01-02") },
    ],
    "150",
  );

  expect(result.closedCostBasisUsd).toBe(20);
  expect(result.remainingLots).toEqual([
    { tokenAddress: "0xabc", quantityBaseUnits: "50", costBasisUsd: 10, acquiredAt: new Date("2026-01-02") },
  ]);
});
