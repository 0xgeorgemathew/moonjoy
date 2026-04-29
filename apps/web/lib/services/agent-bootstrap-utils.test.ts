import { describe, expect, test } from "bun:test";
import {
  buildStrategyPointer,
  deriveAgentLabel,
  MAX_USER_LABEL_LENGTH_FOR_DERIVED_AGENT,
} from "./agent-bootstrap-utils";

describe("deriveAgentLabel", () => {
  test("derives the expected agent label", () => {
    expect(deriveAgentLabel("buzz")).toEqual({
      ok: true,
      label: "agent-buzz",
      ensName: "agent-buzz.moonjoy.eth",
    });
  });

  test("rejects user labels that would overflow the registrar limit", () => {
    const tooLongLabel = "a".repeat(MAX_USER_LABEL_LENGTH_FOR_DERIVED_AGENT + 1);

    expect(deriveAgentLabel(tooLongLabel)).toEqual({
      ok: false,
      reason: "Derived agent label would exceed 32 characters.",
      maxUserLabelLength: MAX_USER_LABEL_LENGTH_FOR_DERIVED_AGENT,
    });
  });
});

describe("buildStrategyPointer", () => {
  test("is stable across object key ordering", () => {
    const first = buildStrategyPointer({
      thesis: "mean reversion",
      risk: { maxDrawdown: 0.15, rebalance: "5m" },
    });
    const second = buildStrategyPointer({
      risk: { rebalance: "5m", maxDrawdown: 0.15 },
      thesis: "mean reversion",
    });

    expect(first).toBe(second);
  });
});
