import { describe, expect, test } from "bun:test";
import { validateTradePhaseRules } from "./trade-service";

describe("validateTradePhaseRules", () => {
  test("allows token-to-USDC exits during cycle_out", () => {
    expect(
      validateTradePhaseRules({
        phase: "cycle_out",
        tradeSide: "sell",
        tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      }),
    ).toEqual({ allowed: true });
  });

  test("rejects buys during cycle_out", () => {
    expect(
      validateTradePhaseRules({
        phase: "cycle_out",
        tradeSide: "buy",
        tokenOut: "0x4200000000000000000000000000000000000006",
      }),
    ).toEqual({
      allowed: false,
      reason: "Cycle-out phase does not allow new positions. Exit back into USDC only.",
    });
  });

  test("rejects non-USDC rotations during cycle_out", () => {
    expect(
      validateTradePhaseRules({
        phase: "cycle_out",
        tradeSide: "swap",
        tokenOut: "0x4200000000000000000000000000000000000006",
      }),
    ).toEqual({
      allowed: false,
      reason: "Cycle-out phase only allows exits back into USDC.",
    });
  });

  test("keeps earlier live phases unrestricted", () => {
    expect(
      validateTradePhaseRules({
        phase: "midgame",
        tradeSide: "buy",
        tokenOut: "0x4200000000000000000000000000000000000006",
      }),
    ).toEqual({ allowed: true });
  });
});
