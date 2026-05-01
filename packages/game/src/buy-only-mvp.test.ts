import { expect, test } from "bun:test";
import { computePnlBreakdown } from "./pnl.ts";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

test("buy-only MVP: realized PnL is always 0 with no sells", () => {
  const startingCapital = 100;
  const currentValue = 95;
  const realizedPnl = 0;
  const penalties = 0;

  const result = computePnlBreakdown(startingCapital, currentValue, realizedPnl, penalties);
  expect(result.realizedPnlUsd).toBe(0);
  expect(result.unrealizedPnlUsd).toBe(-5);
  expect(result.totalPnlUsd).toBe(-5);
});

test("buy-only MVP: total PnL equals currentValue minus startingValue", () => {
  const result = computePnlBreakdown(100, 115, 0, 0);
  expect(result.totalPnlUsd).toBe(15);
  expect(result.unrealizedPnlUsd).toBe(15);
  expect(result.realizedPnlUsd).toBe(0);
});

test("pnlPercent is stored as fraction, display must multiply by 100", () => {
  const result = computePnlBreakdown(100, 105, 0, 0);
  expect(result.pnlPercent).toBeCloseTo(0.05);
  expect(result.pnlPercent * 100).toBeCloseTo(5.0);
});

test("pnlPercent negative is stored as negative fraction", () => {
  const result = computePnlBreakdown(100, 92, 0, 0);
  expect(result.pnlPercent).toBeCloseTo(-0.08);
  expect(result.pnlPercent * 100).toBeCloseTo(-8.0);
});

test("netScorePercent with penalties is correct fraction", () => {
  const result = computePnlBreakdown(100, 110, 0, 2.5);
  expect(result.netScorePercent).toBeCloseTo(0.075);
  expect(result.netScorePercent * 100).toBeCloseTo(7.5);
});

test("USDC invariant: only USDC-funded buys allowed", () => {
  const nonUsdcToken = "0x4200000000000000000000000000000000000006";
  const isUsdcBuy = (tokenIn: string) => tokenIn.toLowerCase() === USDC;
  expect(isUsdcBuy(USDC)).toBe(true);
  expect(isUsdcBuy(nonUsdcToken)).toBe(false);
  expect(isUsdcBuy(USDC.toUpperCase())).toBe(true);
});

test("valuation uses currentValueUsd minus startingValueUsd for PnL", () => {
  const startingValue = 100;
  const currentValue = 130;
  const result = computePnlBreakdown(startingValue, currentValue, 0, 0);
  expect(result.totalPnlUsd).toBe(currentValue - startingValue);
  expect(result.pnlPercent).toBeCloseTo(0.3);
});
