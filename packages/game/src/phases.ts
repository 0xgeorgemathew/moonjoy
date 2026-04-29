export type LiveSubphase = "opening_window" | "midgame" | "closing_window";

export type MandatoryWindowName = "opening_window" | "closing_window";

export type MatchPhase =
  | "created"
  | "warmup"
  | "opening_window"
  | "midgame"
  | "closing_window"
  | "settling"
  | "settled"
  | "canceled";

export type WindowBoundary = {
  name: MandatoryWindowName;
  startsAt: Date;
  endsAt: Date;
};

export const DEFAULT_OPENING_WINDOW_SECONDS = 60;
export const DEFAULT_CLOSING_WINDOW_SECONDS = 60;

export function deriveLiveSubphase(
  liveStartedAt: Date,
  liveEndsAt: Date,
  now: Date,
  openingWindowSeconds: number = DEFAULT_OPENING_WINDOW_SECONDS,
  closingWindowSeconds: number = DEFAULT_CLOSING_WINDOW_SECONDS,
): LiveSubphase {
  const elapsedMs = now.getTime() - liveStartedAt.getTime();
  const totalMs = liveEndsAt.getTime() - liveStartedAt.getTime();
  const closingStartMs = totalMs - closingWindowSeconds * 1000;

  if (elapsedMs < 0) {
    throw new Error("now is before liveStartedAt; match has not started yet.");
  }

  if (elapsedMs < openingWindowSeconds * 1000) {
    return "opening_window";
  }

  if (elapsedMs >= closingStartMs) {
    return "closing_window";
  }

  return "midgame";
}

export function deriveMatchPhase(
  status: "created" | "warmup" | "live" | "settling" | "settled" | "canceled",
  liveStartedAt: Date | null,
  liveEndsAt: Date | null,
  now: Date,
  openingWindowSeconds: number = DEFAULT_OPENING_WINDOW_SECONDS,
  closingWindowSeconds: number = DEFAULT_CLOSING_WINDOW_SECONDS,
): MatchPhase {
  if (status === "created") return "created";
  if (status === "warmup") return "warmup";
  if (status === "settling") return "settling";
  if (status === "settled") return "settled";
  if (status === "canceled") return "canceled";

  if (status === "live") {
    if (!liveStartedAt || !liveEndsAt) {
      throw new Error("Live match must have liveStartedAt and liveEndsAt.");
    }
    return deriveLiveSubphase(
      liveStartedAt,
      liveEndsAt,
      now,
      openingWindowSeconds,
      closingWindowSeconds,
    );
  }

  return status;
}

export function getMandatoryWindows(
  liveStartedAt: Date,
  liveEndsAt: Date,
  openingWindowSeconds: number = DEFAULT_OPENING_WINDOW_SECONDS,
  closingWindowSeconds: number = DEFAULT_CLOSING_WINDOW_SECONDS,
): WindowBoundary[] {
  return [
    {
      name: "opening_window",
      startsAt: liveStartedAt,
      endsAt: new Date(liveStartedAt.getTime() + openingWindowSeconds * 1000),
    },
    {
      name: "closing_window",
      startsAt: new Date(liveEndsAt.getTime() - closingWindowSeconds * 1000),
      endsAt: liveEndsAt,
    },
  ];
}

export function isTradingAllowed(phase: MatchPhase): boolean {
  return (
    phase === "opening_window" ||
    phase === "midgame" ||
    phase === "closing_window"
  );
}

export type MandatoryWindowCheck = {
  windowName: MandatoryWindowName;
  completed: boolean;
  tradeCount: number;
};

export function checkMandatoryWindow(
  window: WindowBoundary,
  tradeTimestamps: Date[],
): MandatoryWindowCheck {
  const tradesInWindow = tradeTimestamps.filter((ts) => {
    return ts.getTime() >= window.startsAt.getTime() && ts.getTime() <= window.endsAt.getTime();
  });

  return {
    windowName: window.name,
    completed: tradesInWindow.length > 0,
    tradeCount: tradesInWindow.length,
  };
}

export function computeMandatoryWindowPenalty(
  startingPortfolioValueUsd: number,
  minPenaltyUsd: number = 2.5,
  penaltyBps: number = 250,
): number {
  const proportional = startingPortfolioValueUsd * (penaltyBps / 10000);
  return Math.max(proportional, minPenaltyUsd);
}

export function getWindowsEndingAt(
  liveStartedAt: Date,
  liveEndsAt: Date,
  now: Date,
  graceSeconds: number = 1,
  openingWindowSeconds: number = DEFAULT_OPENING_WINDOW_SECONDS,
  closingWindowSeconds: number = DEFAULT_CLOSING_WINDOW_SECONDS,
): WindowBoundary[] {
  const windows = getMandatoryWindows(
    liveStartedAt,
    liveEndsAt,
    openingWindowSeconds,
    closingWindowSeconds,
  );

  return windows.filter((w) => {
    const graceEnd = new Date(w.endsAt.getTime() + graceSeconds * 1000);
    return now.getTime() >= w.endsAt.getTime() && now.getTime() <= graceEnd.getTime();
  });
}
