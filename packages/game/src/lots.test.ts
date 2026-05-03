/**
 * Tests for lot-based FIFO position tracking
 */

import { describe, expect, it } from "bun:test";
import {
  classifyTradeSide,
  deriveTradeLabel,
  closeLotsFifoWithPnl,
  calculateExitableAmount,
  calculateOpenCostBasis,
  createLotForTrade,
  isFullExit,
  type Lot,
} from "./lots";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("classifyTradeSide", () => {
  it("classifies USDC -> token as buy", () => {
    expect(
      classifyTradeSide({
        tokenIn: USDC,
        tokenOut: "0x4200000000000000000000000000000000000006", // WETH
      })
    ).toBe("buy");
  });

  it("classifies token -> USDC as sell", () => {
    expect(
      classifyTradeSide({
        tokenIn: "0x4200000000000000000000000000000000000006", // WETH
        tokenOut: USDC,
      })
    ).toBe("sell");
  });

  it("classifies token -> token as swap", () => {
    expect(
      classifyTradeSide({
        tokenIn: "0x4200000000000000000000000000000000000006", // WETH
        tokenOut: "0x7122985658e8b5148236a3b9d2665bc6f13b6bfc", // different token (not USDC)
      })
    ).toBe("swap");
  });

  it("rejects USDC -> USDC as invalid", () => {
    expect(
      classifyTradeSide({
        tokenIn: USDC,
        tokenOut: USDC,
      })
    ).toBeNull();
  });

  it("handles mixed case addresses", () => {
    expect(
      classifyTradeSide({
        tokenIn: USDC.toUpperCase(),
        tokenOut: "0x4200000000000000000000000000000000000006".toUpperCase(),
      })
    ).toBe("buy");
  });
});

describe("deriveTradeLabel", () => {
  it("labels partial sell as 'sell'", () => {
    expect(
      deriveTradeLabel({
        tradeSide: "sell",
        currentBalanceBaseUnits: "1000000000000000000", // 1 token
        amountInBaseUnits: "500000000000000000", // 0.5 token
      })
    ).toBe("sell");
  });

  it("labels full position sell as 'exit'", () => {
    expect(
      deriveTradeLabel({
        tradeSide: "sell",
        currentBalanceBaseUnits: "1000000000000000000", // 1 token
        amountInBaseUnits: "1000000000000000000", // 1 token
      })
    ).toBe("exit");
  });

  it("labels oversell as 'exit' (agent exits entire position)", () => {
    expect(
      deriveTradeLabel({
        tradeSide: "sell",
        currentBalanceBaseUnits: "1000000000000000000", // 1 token
        amountInBaseUnits: "2000000000000000000", // 2 tokens (more than balance)
      })
    ).toBe("exit");
  });

  it("passes through buy and swap unchanged", () => {
    expect(
      deriveTradeLabel({
        tradeSide: "buy",
        currentBalanceBaseUnits: "1000000000000000000",
        amountInBaseUnits: "1000000000000000000",
      })
    ).toBe("buy");

    expect(
      deriveTradeLabel({
        tradeSide: "swap",
        currentBalanceBaseUnits: "1000000000000000000",
        amountInBaseUnits: "1000000000000000000",
      })
    ).toBe("swap");
  });
});

describe("closeLotsFifoWithPnl", () => {
  const now = new Date("2026-05-01T10:00:00Z");

  const createLot = (params: {
    acquired: string;
    remaining: string;
    costBasis: number;
    minutesAgo?: number;
  }): Lot => ({
    id: crypto.randomUUID(),
    matchId: "match-1",
    agentId: "agent-1",
    tokenAddress: "0x4200000000000000000000000000000000000006",
    acquiredAmountBaseUnits: params.acquired,
    remainingAmountBaseUnits: params.remaining,
    costBasisUsd: params.costBasis,
    acquiredAt: new Date(now.getTime() - (params.minutesAgo ?? 0) * 60 * 1000),
    sourceTradeId: "trade-1",
  });

  it("closes single lot fully", () => {
    const lots = [createLot({ acquired: "1000000000000000000", remaining: "1000000000000000000", costBasis: 100 })];

    const result = closeLotsFifoWithPnl({
      openLots: lots,
      quantityToCloseBaseUnits: "1000000000000000000",
      currentPriceUsdPerToken: 120,
      tokenDecimals: 18,
    });

    expect(result.closedLots).toHaveLength(1);
    expect(result.closedLots[0].amountClosedBaseUnits).toBe("1000000000000000000");
    expect(result.closedLots[0].costBasisClosedUsd).toBe(100);
    expect(result.closedLots[0].proceedsUsd).toBe(120);
    expect(result.closedLots[0].realizedPnlUsd).toBe(20);
    expect(result.remainingLots).toHaveLength(0);
    expect(result.totalRealizedPnlUsd).toBe(20);
    expect(result.totalClosedCostBasisUsd).toBe(100);
  });

  it("closes multiple lots FIFO", () => {
    const lots = [
      createLot({ acquired: "1000000000000000000", remaining: "1000000000000000000", costBasis: 100, minutesAgo: 30 }),
      createLot({ acquired: "1000000000000000000", remaining: "1000000000000000000", costBasis: 110, minutesAgo: 20 }),
      createLot({ acquired: "1000000000000000000", remaining: "1000000000000000000", costBasis: 120, minutesAgo: 10 }),
    ];

    const result = closeLotsFifoWithPnl({
      openLots: lots,
      quantityToCloseBaseUnits: "2000000000000000000", // Close 2 lots
      currentPriceUsdPerToken: 115,
      tokenDecimals: 18,
    });

    expect(result.closedLots).toHaveLength(2);
    expect(result.closedLots[0].lotId).toBe(lots[0].id);
    expect(result.closedLots[1].lotId).toBe(lots[1].id);
    expect(result.remainingLots).toHaveLength(1);
    expect(result.remainingLots[0].id).toBe(lots[2].id);
    expect(result.totalRealizedPnlUsd).toBeCloseTo(20, 1); // (115-100) + (115-110)
  });

  it("splits final lot precisely (no oversell)", () => {
    const lots = [createLot({ acquired: "1000000000000000000", remaining: "1000000000000000000", costBasis: 100 })];

    const result = closeLotsFifoWithPnl({
      openLots: lots,
      quantityToCloseBaseUnits: "300000000000000000", // 30% of lot
      currentPriceUsdPerToken: 120,
      tokenDecimals: 18,
    });

    expect(result.closedLots).toHaveLength(1);
    expect(result.closedLots[0].amountClosedBaseUnits).toBe("300000000000000000");
    expect(result.closedLots[0].costBasisClosedUsd).toBeCloseTo(30, 1); // 30% of 100
    expect(result.closedLots[0].proceedsUsd).toBeCloseTo(36, 1); // 0.3 * 120

    expect(result.remainingLots).toHaveLength(1);
    expect(result.remainingLots[0].remainingAmountBaseUnits).toBe("700000000000000000");
    expect(result.remainingLots[0].costBasisUsd).toBeCloseTo(70, 1); // 70% of 100
  });

  it("handles zero quantity to close", () => {
    const lots = [createLot({ acquired: "1000000000000000000", remaining: "1000000000000000000", costBasis: 100 })];

    const result = closeLotsFifoWithPnl({
      openLots: lots,
      quantityToCloseBaseUnits: "0",
      currentPriceUsdPerToken: 120,
      tokenDecimals: 18,
    });

    expect(result.closedLots).toHaveLength(0);
    expect(result.remainingLots).toHaveLength(1);
    expect(result.totalRealizedPnlUsd).toBe(0);
  });

  it("throws on insufficient balance", () => {
    const lots = [createLot({ acquired: "1000000000000000000", remaining: "1000000000000000000", costBasis: 100 })];

    expect(() =>
      closeLotsFifoWithPnl({
        openLots: lots,
        quantityToCloseBaseUnits: "2000000000000000000", // More than available
        currentPriceUsdPerToken: 120,
        tokenDecimals: 18,
      })
    ).toThrow("Insufficient balance");
  });

  it("throws on negative quantity", () => {
    const lots = [createLot({ acquired: "1000000000000000000", remaining: "1000000000000000000", costBasis: 100 })];

    expect(() =>
      closeLotsFifoWithPnl({
        openLots: lots,
        quantityToCloseBaseUnits: "-100000000000000000",
        currentPriceUsdPerToken: 120,
        tokenDecimals: 18,
      })
    ).toThrow("Quantity to close must be non-negative");
  });

  it("skips already-closed lots", () => {
    const lots = [
      createLot({ acquired: "1000000000000000000", remaining: "1000000000000000000", costBasis: 100, minutesAgo: 30 }),
      createLot({ acquired: "1000000000000000000", remaining: "0", costBasis: 110, minutesAgo: 20 }),
      createLot({ acquired: "1000000000000000000", remaining: "1000000000000000000", costBasis: 120, minutesAgo: 10 }),
    ];

    const result = closeLotsFifoWithPnl({
      openLots: lots,
      quantityToCloseBaseUnits: "1000000000000000000",
      currentPriceUsdPerToken: 115,
      tokenDecimals: 18,
    });

    // Should close first lot (oldest open), skip the closed lot
    expect(result.closedLots).toHaveLength(1);
    expect(result.closedLots[0].lotId).toBe(lots[0].id);
  });
});

describe("calculateExitableAmount", () => {
  const now = new Date("2026-05-01T10:00:00Z");

  it("sums open lot amounts", () => {
    const lots: Lot[] = [
      {
        id: "1",
        matchId: "match-1",
        agentId: "agent-1",
        tokenAddress: "0xtoken",
        acquiredAmountBaseUnits: "1000000000000000000",
        remainingAmountBaseUnits: "1000000000000000000",
        costBasisUsd: 100,
        acquiredAt: now,
      },
      {
        id: "2",
        matchId: "match-1",
        agentId: "agent-1",
        tokenAddress: "0xtoken",
        acquiredAmountBaseUnits: "500000000000000000",
        remainingAmountBaseUnits: "500000000000000000",
        costBasisUsd: 50,
        acquiredAt: now,
      },
    ];

    expect(calculateExitableAmount(lots)).toBe("1500000000000000000");
  });

  it("excludes closed lots", () => {
    const lots: Lot[] = [
      {
        id: "1",
        matchId: "match-1",
        agentId: "agent-1",
        tokenAddress: "0xtoken",
        acquiredAmountBaseUnits: "1000000000000000000",
        remainingAmountBaseUnits: "1000000000000000000",
        costBasisUsd: 100,
        acquiredAt: now,
      },
      {
        id: "2",
        matchId: "match-1",
        agentId: "agent-1",
        tokenAddress: "0xtoken",
        acquiredAmountBaseUnits: "500000000000000000",
        remainingAmountBaseUnits: "0",
        costBasisUsd: 50,
        acquiredAt: now,
        closedAt: now,
      },
    ];

    expect(calculateExitableAmount(lots)).toBe("1000000000000000000");
  });
});

describe("calculateOpenCostBasis", () => {
  const now = new Date("2026-05-01T10:00:00Z");

  it("sums cost basis of open lots", () => {
    const lots: Lot[] = [
      {
        id: "1",
        matchId: "match-1",
        agentId: "agent-1",
        tokenAddress: "0xtoken",
        acquiredAmountBaseUnits: "1000000000000000000",
        remainingAmountBaseUnits: "1000000000000000000",
        costBasisUsd: 100,
        acquiredAt: now,
      },
      {
        id: "2",
        matchId: "match-1",
        agentId: "agent-1",
        tokenAddress: "0xtoken",
        acquiredAmountBaseUnits: "500000000000000000",
        remainingAmountBaseUnits: "500000000000000000",
        costBasisUsd: 50,
        acquiredAt: now,
      },
    ];

    expect(calculateOpenCostBasis(lots)).toBe(150);
  });

  it("excludes closed lots", () => {
    const lots: Lot[] = [
      {
        id: "1",
        matchId: "match-1",
        agentId: "agent-1",
        tokenAddress: "0xtoken",
        acquiredAmountBaseUnits: "1000000000000000000",
        remainingAmountBaseUnits: "1000000000000000000",
        costBasisUsd: 100,
        acquiredAt: now,
      },
      {
        id: "2",
        matchId: "match-1",
        agentId: "agent-1",
        tokenAddress: "0xtoken",
        acquiredAmountBaseUnits: "500000000000000000",
        remainingAmountBaseUnits: "0",
        costBasisUsd: 50,
        acquiredAt: now,
        closedAt: now,
      },
    ];

    expect(calculateOpenCostBasis(lots)).toBe(100);
  });
});

describe("isFullExit", () => {
  it("returns true for full position exit", () => {
    expect(
      isFullExit({
        currentBalanceBaseUnits: "1000000000000000000",
        amountInBaseUnits: "1000000000000000000",
      })
    ).toBe(true);
  });

  it("returns true for oversell (exits entire position)", () => {
    expect(
      isFullExit({
        currentBalanceBaseUnits: "1000000000000000000",
        amountInBaseUnits: "2000000000000000000",
      })
    ).toBe(true);
  });

  it("returns false for partial sell", () => {
    expect(
      isFullExit({
        currentBalanceBaseUnits: "1000000000000000000",
        amountInBaseUnits: "500000000000000000",
      })
    ).toBe(false);
  });
});
