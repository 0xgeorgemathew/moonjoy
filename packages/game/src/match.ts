export const DEFAULT_MATCH_WAGER_USD = 10;
export const DEFAULT_MATCH_DURATION_SECONDS = 300;
export const DEFAULT_WARMUP_SECONDS = 30;
export const DEFAULT_STARTING_USDC = 100;
export const SETTLEMENT_GRACE_SECONDS = 15;

export type MatchStatus =
  | "created"
  | "warmup"
  | "live"
  | "settling"
  | "settled"
  | "canceled";

export type MatchSeat = "creator" | "opponent";

export type MatchParticipant = {
  userId: string;
  agentId: string;
  smartAccountAddress: string;
};

export type MatchConfig = {
  wagerUsd: number;
  durationSeconds: number;
  warmupSeconds: number;
  settlementGraceSeconds: number;
  startingCapitalUsd: number;
};

export type MatchTiming = {
  createdAt: Date;
  warmupStartedAt: Date | null;
  liveStartedAt: Date | null;
  liveEndsAt: Date | null;
  settlingStartedAt: Date | null;
  settledAt: Date | null;
};

export type MatchState = {
  id: string;
  status: MatchStatus;
  config: MatchConfig;
  creator: MatchParticipant;
  opponent: MatchParticipant | null;
  timing: MatchTiming;
};

export type MatchResult = {
  winnerSeat: MatchSeat | null;
  settledAt: Date;
};

export function createMatch(params: {
  id: string;
  creator: MatchParticipant;
  createdAt: Date;
  config?: Partial<MatchConfig>;
}): MatchState {
  return {
    id: params.id,
    status: "created",
    config: buildMatchConfig(params.config),
    creator: params.creator,
    opponent: null,
    timing: {
      createdAt: params.createdAt,
      warmupStartedAt: null,
      liveStartedAt: null,
      liveEndsAt: null,
      settlingStartedAt: null,
      settledAt: null,
    },
  };
}

export function acceptChallenge(
  match: MatchState,
  params: {
    opponent: MatchParticipant;
    acceptedAt: Date;
  },
): MatchState {
  if (match.status !== "created") {
    throw new Error("Only created matches can accept a challenger.");
  }

  if (match.opponent) {
    throw new Error("Match already has an opponent.");
  }

  if (params.opponent.agentId === match.creator.agentId) {
    throw new Error("Creator cannot accept their own challenge.");
  }

  return startWarmup(
    {
      ...match,
      opponent: params.opponent,
    },
    params.acceptedAt,
  );
}

export function startWarmup(match: MatchState, startedAt: Date): MatchState {
  if (match.status !== "created") {
    throw new Error("Only created matches can transition to warmup.");
  }

  if (!match.opponent) {
    throw new Error("Cannot start warmup without an opponent.");
  }

  return {
    ...match,
    status: "warmup",
    timing: {
      ...match.timing,
      warmupStartedAt: startedAt,
    },
  };
}

export function startLive(match: MatchState, startedAt: Date): MatchState {
  if (match.status !== "warmup") {
    throw new Error("Only warmup matches can transition to live.");
  }

  if (!match.opponent) {
    throw new Error("Cannot start a live match without an opponent.");
  }

  const warmupEndsAt = getWarmupEndsAt(match);
  if (!warmupEndsAt) {
    throw new Error("Warmup start time is required before going live.");
  }

  if (startedAt.getTime() < warmupEndsAt.getTime()) {
    throw new Error("Warmup has not ended yet.");
  }

  const liveStartedAt = warmupEndsAt;
  return {
    ...match,
    status: "live",
    timing: {
      ...match.timing,
      liveStartedAt,
      liveEndsAt: new Date(
        liveStartedAt.getTime() + match.config.durationSeconds * 1000,
      ),
    },
  };
}

export function startSettling(match: MatchState, startedAt: Date): MatchState {
  if (match.status !== "live") {
    throw new Error("Only live matches can transition to settling.");
  }

  const liveEndsAt = match.timing.liveEndsAt;
  if (!liveEndsAt || startedAt.getTime() < liveEndsAt.getTime()) {
    throw new Error("Live match has not ended yet.");
  }

  return {
    ...match,
    status: "settling",
    timing: {
      ...match.timing,
      settlingStartedAt: liveEndsAt,
    },
  };
}

export function settleMatch(
  match: MatchState,
  params: MatchResult,
): MatchState {
  if (match.status !== "settling") {
    throw new Error("Only settling matches can be settled.");
  }

  if (params.settledAt.getTime() < match.timing.settlingStartedAt!.getTime()) {
    throw new Error("Settled time cannot be before settling started.");
  }

  return {
    ...match,
    status: "settled",
    timing: {
      ...match.timing,
      settledAt: params.settledAt,
    },
  };
}

export function reconcileMatchStatus(match: MatchState, now: Date): MatchState {
  let nextMatch = match;

  if (nextMatch.status === "warmup" && isReadyForLive(nextMatch, now)) {
    nextMatch = startLive(nextMatch, now);
  }

  if (nextMatch.status === "live" && isReadyForSettlement(nextMatch, now)) {
    nextMatch = startSettling(nextMatch, now);
  }

  return nextMatch;
}

export function getWarmupEndsAt(match: MatchState): Date | null {
  if (!match.timing.warmupStartedAt) {
    return null;
  }

  return new Date(
    match.timing.warmupStartedAt.getTime() +
      match.config.warmupSeconds * 1000,
  );
}

export function getLiveEndsAt(match: MatchState): Date | null {
  return match.timing.liveEndsAt;
}

export function getNextTransitionAt(match: MatchState): Date | null {
  if (match.status === "warmup") {
    return getWarmupEndsAt(match);
  }

  if (match.status === "live") {
    return getLiveEndsAt(match);
  }

  return null;
}

export function isReadyForLive(match: MatchState, now: Date): boolean {
  const warmupEndsAt = getWarmupEndsAt(match);
  return Boolean(
    match.status === "warmup" &&
      warmupEndsAt &&
      now.getTime() >= warmupEndsAt.getTime(),
  );
}

export function isReadyForSettlement(match: MatchState, now: Date): boolean {
  const liveEndsAt = getLiveEndsAt(match);
  return Boolean(
    match.status === "live" &&
      liveEndsAt &&
      now.getTime() >= liveEndsAt.getTime(),
  );
}

export function isSettlementGraceActive(now: Date, match: MatchState): boolean {
  if (match.status !== "settling" || !match.timing.settlingStartedAt) {
    return false;
  }

  if (match.timing.settledAt) {
    return false;
  }

  const graceEndsAt =
    match.timing.settlingStartedAt.getTime() +
    match.config.settlementGraceSeconds * 1000;

  return now.getTime() <= graceEndsAt;
}

export function isSettlementGraceExpired(now: Date, match: MatchState): boolean {
  if (match.status !== "settling" || !match.timing.settlingStartedAt) {
    return false;
  }

  if (match.timing.settledAt) {
    return false;
  }

  const graceEndsAt =
    match.timing.settlingStartedAt.getTime() +
    match.config.settlementGraceSeconds * 1000;

  return now.getTime() > graceEndsAt;
}

function buildMatchConfig(overrides?: Partial<MatchConfig>): MatchConfig {
  return {
    wagerUsd: overrides?.wagerUsd ?? DEFAULT_MATCH_WAGER_USD,
    durationSeconds:
      overrides?.durationSeconds ?? DEFAULT_MATCH_DURATION_SECONDS,
    warmupSeconds: overrides?.warmupSeconds ?? DEFAULT_WARMUP_SECONDS,
    settlementGraceSeconds:
      overrides?.settlementGraceSeconds ?? SETTLEMENT_GRACE_SECONDS,
    startingCapitalUsd:
      overrides?.startingCapitalUsd ?? DEFAULT_STARTING_USDC,
  };
}
