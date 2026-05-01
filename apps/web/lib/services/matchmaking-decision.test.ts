import { expect, test } from "bun:test";
import { decideMatchmakingAction } from "./matchmaking-decision";

test("deprecated matchmaking throws instead of matching", () => {
  expect(() => decideMatchmakingAction()).toThrow("Agent matchmaking is retired");
});
