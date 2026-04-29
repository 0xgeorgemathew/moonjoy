import { expect, test } from "bun:test";
import {
  DEFAULT_MATCH_DURATION_SECONDS,
  DEFAULT_MATCH_WAGER_USD,
  DEFAULT_WARMUP_SECONDS,
  SETTLEMENT_GRACE_SECONDS,
  acceptChallenge,
  createMatch,
  getLiveEndsAt,
  getNextTransitionAt,
  getWarmupEndsAt,
  isReadyForLive,
  isReadyForSettlement,
  isSettlementGraceActive,
  isSettlementGraceExpired,
  reconcileMatchStatus,
  settleMatch,
  startLive,
  startSettling,
} from "./match.ts";

function createSeat(role) {
  return {
    userId: `${role}-user`,
    agentId: `${role}-agent`,
    smartAccountAddress: `0x${role}`,
  };
}

test("default match config follows the demo rules", () => {
  const match = createMatch({
    id: "match-1",
    creator: createSeat("creator"),
    createdAt: new Date("2026-04-29T00:00:00.000Z"),
  });

  expect(match.config.wagerUsd).toBe(DEFAULT_MATCH_WAGER_USD);
  expect(match.config.durationSeconds).toBe(DEFAULT_MATCH_DURATION_SECONDS);
  expect(match.config.warmupSeconds).toBe(DEFAULT_WARMUP_SECONDS);
  expect(match.config.settlementGraceSeconds).toBe(SETTLEMENT_GRACE_SECONDS);
});

test("accepting a challenge fills the opponent seat and starts warmup", () => {
  const createdAt = new Date("2026-04-29T00:00:00.000Z");
  const acceptedAt = new Date("2026-04-29T00:00:05.000Z");
  const match = createMatch({
    id: "match-1",
    creator: createSeat("creator"),
    createdAt,
  });

  const accepted = acceptChallenge(match, {
    opponent: createSeat("opponent"),
    acceptedAt,
  });

  expect(accepted.status).toBe("warmup");
  expect(accepted.opponent).toEqual(createSeat("opponent"));
  expect(accepted.timing.warmupStartedAt).toEqual(acceptedAt);
  expect(getWarmupEndsAt(accepted)).toEqual(
    new Date("2026-04-29T00:00:35.000Z"),
  );
});

test("reconcileMatchStatus advances warmup to live and live to settling", () => {
  const warmup = acceptChallenge(
    createMatch({
      id: "match-1",
      creator: createSeat("creator"),
      createdAt: new Date("2026-04-29T00:00:00.000Z"),
    }),
    {
      opponent: createSeat("opponent"),
      acceptedAt: new Date("2026-04-29T00:00:05.000Z"),
    },
  );

  const live = reconcileMatchStatus(
    warmup,
    new Date("2026-04-29T00:00:35.000Z"),
  );

  expect(live.status).toBe("live");
  expect(live.timing.liveStartedAt).toEqual(
    new Date("2026-04-29T00:00:35.000Z"),
  );
  expect(live.timing.liveEndsAt).toEqual(
    new Date("2026-04-29T00:05:35.000Z"),
  );

  const settling = reconcileMatchStatus(
    live,
    new Date("2026-04-29T00:05:35.000Z"),
  );

  expect(settling.status).toBe("settling");
  expect(settling.timing.settlingStartedAt).toEqual(
    new Date("2026-04-29T00:05:35.000Z"),
  );
});

test("explicit transition helpers reject invalid state changes", () => {
  const created = createMatch({
    id: "match-1",
    creator: createSeat("creator"),
    createdAt: new Date("2026-04-29T00:00:00.000Z"),
  });

  expect(() =>
    startLive(created, new Date("2026-04-29T00:00:35.000Z")),
  ).toThrow("Only warmup matches can transition to live.");

  expect(() =>
    acceptChallenge(created, {
      opponent: createSeat("creator"),
      acceptedAt: new Date("2026-04-29T00:00:10.000Z"),
    }),
  ).toThrow("Creator cannot accept their own challenge.");
});

test("timer helpers expose the next lifecycle boundary", () => {
  const warmup = acceptChallenge(
    createMatch({
      id: "match-1",
      creator: createSeat("creator"),
      createdAt: new Date("2026-04-29T00:00:00.000Z"),
    }),
    {
      opponent: createSeat("opponent"),
      acceptedAt: new Date("2026-04-29T00:00:05.000Z"),
    },
  );

  expect(getNextTransitionAt(warmup)).toEqual(
    new Date("2026-04-29T00:00:35.000Z"),
  );
  expect(
    isReadyForLive(warmup, new Date("2026-04-29T00:00:34.000Z")),
  ).toBe(false);
  expect(
    isReadyForLive(warmup, new Date("2026-04-29T00:00:35.000Z")),
  ).toBe(true);

  const live = startLive(warmup, new Date("2026-04-29T00:00:35.000Z"));
  expect(getLiveEndsAt(live)).toEqual(new Date("2026-04-29T00:05:35.000Z"));
  expect(getNextTransitionAt(live)).toEqual(
    new Date("2026-04-29T00:05:35.000Z"),
  );
  expect(
    isReadyForSettlement(live, new Date("2026-04-29T00:05:35.000Z")),
  ).toBe(true);
});

test("settlement grace closes after the configured window", () => {
  const settling = startSettling(
    startLive(
      acceptChallenge(
        createMatch({
          id: "match-1",
          creator: createSeat("creator"),
          createdAt: new Date("2026-04-29T00:00:00.000Z"),
        }),
        {
          opponent: createSeat("opponent"),
          acceptedAt: new Date("2026-04-29T00:00:05.000Z"),
        },
      ),
      new Date("2026-04-29T00:00:35.000Z"),
    ),
    new Date("2026-04-29T00:05:35.000Z"),
  );

  expect(
    isSettlementGraceActive(settling.timing.settlingStartedAt, settling),
  ).toBe(true);
  expect(
    isSettlementGraceActive(new Date("2026-04-29T00:05:50.000Z"), settling),
  ).toBe(true);
  expect(
    isSettlementGraceExpired(new Date("2026-04-29T00:05:50.000Z"), settling),
  ).toBe(false);
  expect(
    isSettlementGraceActive(new Date("2026-04-29T00:05:51.000Z"), settling),
  ).toBe(false);
  expect(
    isSettlementGraceExpired(new Date("2026-04-29T00:05:51.000Z"), settling),
  ).toBe(true);

  const settled = settleMatch(settling, {
    winnerSeat: "creator",
    settledAt: new Date("2026-04-29T00:05:40.000Z"),
  });
  expect(
    isSettlementGraceActive(new Date("2026-04-29T00:05:41.000Z"), settled),
  ).toBe(false);
  expect(
    isSettlementGraceExpired(new Date("2026-04-29T00:05:51.000Z"), settled),
  ).toBe(false);
});
