export const DEFAULT_MATCH_DURATION_SECONDS = 180;
export const DEFAULT_STARTING_USDC = 100;
export const SETTLEMENT_GRACE_SECONDS = 15;

export type MatchStatus =
  | "draft"
  | "open"
  | "accepted"
  | "ready"
  | "live"
  | "settling"
  | "complete"
  | "cancelled";

export type MatchSeatRole = "creator" | "opponent";

export type MatchAction =
  | "connect_agent"
  | "delegate_wallet"
  | "start_match"
  | "submit_trade"
  | "hold_position"
  | "settle_match";

export type MatchTiming = {
  startsAt: Date | null;
  endsAt: Date | null;
  settledAt: Date | null;
};

export type MatchReadiness = {
  hasCreator: boolean;
  hasOpponent: boolean;
  creatorAgentConnected: boolean;
  opponentAgentConnected: boolean;
  creatorWalletDelegated: boolean;
  opponentWalletDelegated: boolean;
};

export function isMatchReady(readiness: MatchReadiness): boolean {
  return (
    readiness.hasCreator &&
    readiness.hasOpponent &&
    readiness.creatorAgentConnected &&
    readiness.opponentAgentConnected &&
    readiness.creatorWalletDelegated &&
    readiness.opponentWalletDelegated
  );
}

export function getAvailableMatchActions(
  status: MatchStatus,
  readiness: MatchReadiness,
): MatchAction[] {
  if (status === "draft" || status === "open" || status === "accepted") {
    const actions: MatchAction[] = [];

    if (!readiness.creatorAgentConnected || !readiness.opponentAgentConnected) {
      actions.push("connect_agent");
    }

    if (!readiness.creatorWalletDelegated || !readiness.opponentWalletDelegated) {
      actions.push("delegate_wallet");
    }

    if (isMatchReady(readiness)) {
      actions.push("start_match");
    }

    return actions;
  }

  if (status === "live") {
    return ["submit_trade", "hold_position"];
  }

  if (status === "settling") {
    return ["settle_match"];
  }

  return [];
}

export function isSettlementGraceActive(now: Date, timing: MatchTiming): boolean {
  if (!timing.endsAt || timing.settledAt) {
    return false;
  }

  const graceEndsAt =
    timing.endsAt.getTime() + SETTLEMENT_GRACE_SECONDS * 1000;

  return now.getTime() <= graceEndsAt;
}
