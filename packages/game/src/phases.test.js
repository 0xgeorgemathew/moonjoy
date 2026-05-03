import { expect, test } from "bun:test";
import {
  checkMandatoryWindow,
  computeMandatoryWindowPenalty,
  deriveLiveSubphase,
  deriveMatchPhase,
  getMandatoryWindows,
  getWindowsEndingAt,
  isTradingAllowed,
} from "./phases.ts";

const T0 = new Date("2026-04-29T00:00:35.000Z");
const LIVE_END = new Date("2026-04-29T00:05:35.000Z");

test("deriveLiveSubphase returns opening_window in first 60s", () => {
  expect(deriveLiveSubphase(T0, LIVE_END, new Date("2026-04-29T00:01:00.000Z"))).toBe("opening_window");
  expect(deriveLiveSubphase(T0, LIVE_END, new Date("2026-04-29T00:01:34.999Z"))).toBe("opening_window");
});

test("deriveLiveSubphase returns midgame between windows", () => {
  expect(deriveLiveSubphase(T0, LIVE_END, new Date("2026-04-29T00:01:35.000Z"))).toBe("midgame");
  expect(deriveLiveSubphase(T0, LIVE_END, new Date("2026-04-29T00:04:34.000Z"))).toBe("midgame");
});

test("deriveLiveSubphase returns cycle_out in final 60s", () => {
  expect(deriveLiveSubphase(T0, LIVE_END, new Date("2026-04-29T00:04:35.000Z"))).toBe("cycle_out");
  expect(deriveLiveSubphase(T0, LIVE_END, LIVE_END)).toBe("cycle_out");
});

test("deriveMatchPhase delegates to live subphase for live status", () => {
  expect(deriveMatchPhase("live", T0, LIVE_END, new Date("2026-04-29T00:00:50.000Z"))).toBe("opening_window");
  expect(deriveMatchPhase("live", T0, LIVE_END, new Date("2026-04-29T00:02:00.000Z"))).toBe("midgame");
  expect(deriveMatchPhase("live", T0, LIVE_END, new Date("2026-04-29T00:05:00.000Z"))).toBe("cycle_out");
});

test("deriveMatchPhase passes through non-live statuses", () => {
  expect(deriveMatchPhase("created", null, null, new Date())).toBe("created");
  expect(deriveMatchPhase("warmup", null, null, new Date())).toBe("warmup");
  expect(deriveMatchPhase("settling", null, null, new Date())).toBe("settling");
  expect(deriveMatchPhase("settled", null, null, new Date())).toBe("settled");
  expect(deriveMatchPhase("canceled", null, null, new Date())).toBe("canceled");
});

test("isTradingAllowed only allows live subphases", () => {
  expect(isTradingAllowed("opening_window")).toBe(true);
  expect(isTradingAllowed("midgame")).toBe(true);
  expect(isTradingAllowed("cycle_out")).toBe(true);
  expect(isTradingAllowed("created")).toBe(false);
  expect(isTradingAllowed("warmup")).toBe(false);
  expect(isTradingAllowed("settling")).toBe(false);
  expect(isTradingAllowed("settled")).toBe(false);
});

test("getMandatoryWindows returns two windows", () => {
  const windows = getMandatoryWindows(T0, LIVE_END);
  expect(windows).toHaveLength(2);
  expect(windows[0].name).toBe("opening_window");
  expect(windows[1].name).toBe("closing_window");
  expect(windows[0].startsAt).toEqual(T0);
  expect(windows[0].endsAt).toEqual(new Date("2026-04-29T00:01:35.000Z"));
  expect(windows[1].startsAt).toEqual(new Date("2026-04-29T00:04:35.000Z"));
  expect(windows[1].endsAt).toEqual(LIVE_END);
});

test("checkMandatoryWindow detects completed and incomplete windows", () => {
  const windows = getMandatoryWindows(T0, LIVE_END);
  const tradeInWindow = [new Date("2026-04-29T00:01:00.000Z")];
  const tradeOutside = [new Date("2026-04-29T00:02:00.000Z")];

  expect(checkMandatoryWindow(windows[0], tradeInWindow).completed).toBe(true);
  expect(checkMandatoryWindow(windows[0], tradeOutside).completed).toBe(false);
  expect(checkMandatoryWindow(windows[0], []).completed).toBe(false);
});

test("computeMandatoryWindowPenalty returns max of proportional and minimum", () => {
  expect(computeMandatoryWindowPenalty(100)).toBe(2.5);
  expect(computeMandatoryWindowPenalty(1000)).toBe(25);
});

test("getWindowsEndingAt returns windows whose end matches now within grace", () => {
  const openingEnd = new Date("2026-04-29T00:01:35.000Z");
  const ending = getWindowsEndingAt(T0, LIVE_END, openingEnd, 1);
  expect(ending).toHaveLength(1);
  expect(ending[0].name).toBe("opening_window");

  const beforeWindow = getWindowsEndingAt(T0, LIVE_END, new Date("2026-04-29T00:01:00.000Z"), 1);
  expect(beforeWindow).toHaveLength(0);

  const afterGrace = getWindowsEndingAt(T0, LIVE_END, new Date("2026-04-29T00:01:37.000Z"), 1);
  expect(afterGrace).toHaveLength(0);
});
