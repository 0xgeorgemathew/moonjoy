import { describe, expect, test } from "bun:test";
import { resolvePublicAgentStats } from "./agent-stats-service";

describe("resolvePublicAgentStats", () => {
  test("uses ENS stats when both records match the current database totals", () => {
    expect(
      resolvePublicAgentStats(
        { matchesPlayed: 7, streak: 3 },
        { matchesPlayed: 7, streak: 3 },
      ),
    ).toEqual({
      matchesPlayed: 7,
      streak: 3,
      source: "ens",
      syncing: false,
    });
  });

  test("falls back to database stats when streak is missing or stale", () => {
    expect(
      resolvePublicAgentStats(
        { matchesPlayed: 7, streak: 3 },
        null,
      ),
    ).toEqual({
      matchesPlayed: 7,
      streak: 3,
      source: "database",
      syncing: true,
    });

    expect(
      resolvePublicAgentStats(
        { matchesPlayed: 7, streak: 3 },
        { matchesPlayed: 7, streak: 2 },
      ),
    ).toEqual({
      matchesPlayed: 7,
      streak: 3,
      source: "database",
      syncing: true,
    });
  });
});
