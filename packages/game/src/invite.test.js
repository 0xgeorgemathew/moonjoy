import { describe, test, expect } from "bun:test";
import {
  createInvite,
  isInviteExpired,
  canJoinInvite,
  joinInvite,
  revokeInvite,
  expireInvite,
  DEFAULT_MATCH_WAGER_USD,
  DEFAULT_MATCH_DURATION_SECONDS,
  DEFAULT_STARTING_USDC,
  DEFAULT_WARMUP_SECONDS,
} from "./match";

function makeInvite(overrides = {}) {
  return createInvite({
    id: crypto.randomUUID(),
    createdByUserId: crypto.randomUUID(),
    creatorAgentId: crypto.randomUUID(),
    inviteToken: crypto.randomUUID(),
    scopeType: "open",
    ...overrides,
  });
}

describe("createInvite", () => {
  test("creates open invite with defaults", () => {
    const invite = makeInvite();
    expect(invite.status).toBe("open");
    expect(invite.scopeType).toBe("open");
    expect(invite.scopedEnsName).toBeNull();
    expect(invite.wagerUsd).toBe(DEFAULT_MATCH_WAGER_USD);
    expect(invite.durationSeconds).toBe(DEFAULT_MATCH_DURATION_SECONDS);
    expect(invite.startingCapitalUsd).toBe(DEFAULT_STARTING_USDC);
    expect(invite.warmupSeconds).toBe(DEFAULT_WARMUP_SECONDS);
    expect(invite.createdMatchId).toBeNull();
  });

  test("creates ens-scoped invite", () => {
    const invite = makeInvite({
      scopeType: "ens",
      scopedEnsName: "vitalik.moonjoy.eth",
    });
    expect(invite.scopeType).toBe("ens");
    expect(invite.scopedEnsName).toBe("vitalik.moonjoy.eth");
  });

  test("sets expiresAt when provided", () => {
    const future = new Date(Date.now() + 86400000);
    const invite = makeInvite({ expiresAt: future });
    expect(invite.expiresAt).toEqual(future);
  });

  test("defaults expiresAt to null", () => {
    const invite = makeInvite();
    expect(invite.expiresAt).toBeNull();
  });
});

describe("isInviteExpired", () => {
  test("returns false when no expiresAt", () => {
    const invite = makeInvite();
    expect(isInviteExpired(invite, new Date())).toBe(false);
  });

  test("returns false when expiresAt is in the future", () => {
    const invite = makeInvite({ expiresAt: new Date(Date.now() + 3600000) });
    expect(isInviteExpired(invite, new Date())).toBe(false);
  });

  test("returns true when expiresAt is in the past", () => {
    const invite = makeInvite({ expiresAt: new Date(Date.now() - 1000) });
    expect(isInviteExpired(invite, new Date())).toBe(true);
  });
});

describe("canJoinInvite", () => {
  test("open invite can be joined", () => {
    const invite = makeInvite();
    expect(canJoinInvite(invite, new Date())).toBe(true);
  });

  test("expired invite cannot be joined", () => {
    const invite = makeInvite({ expiresAt: new Date(Date.now() - 1000) });
    expect(canJoinInvite(invite, new Date())).toBe(false);
  });

  test("joined invite cannot be joined", () => {
    const invite = makeInvite();
    const joined = joinInvite(invite, new Date());
    expect(canJoinInvite(joined, new Date())).toBe(false);
  });

  test("revoked invite cannot be joined", () => {
    const invite = makeInvite();
    const revoked = revokeInvite(invite);
    expect(canJoinInvite(revoked, new Date())).toBe(false);
  });
});

describe("joinInvite", () => {
  test("transitions open to joined", () => {
    const invite = makeInvite();
    const joined = joinInvite(invite, new Date());
    expect(joined.status).toBe("joined");
  });

  test("throws for non-open invite", () => {
    const invite = makeInvite();
    const joined = joinInvite(invite, new Date());
    expect(() => joinInvite(joined, new Date())).toThrow();
  });
});

describe("revokeInvite", () => {
  test("transitions open to revoked", () => {
    const invite = makeInvite();
    const revoked = revokeInvite(invite);
    expect(revoked.status).toBe("revoked");
  });

  test("throws for non-open invite", () => {
    const invite = makeInvite();
    const joined = joinInvite(invite, new Date());
    expect(() => revokeInvite(joined)).toThrow();
  });
});

describe("expireInvite", () => {
  test("transitions open to expired", () => {
    const invite = makeInvite();
    const expired = expireInvite(invite);
    expect(expired.status).toBe("expired");
  });

  test("throws for non-open invite", () => {
    const invite = makeInvite();
    const revoked = revokeInvite(invite);
    expect(() => expireInvite(revoked)).toThrow();
  });
});
