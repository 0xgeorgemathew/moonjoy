import type {
  ActiveMatchSnapshot,
  MatchView,
  OpenChallengeSnapshot,
} from "@/lib/types/match";

export type MatchmakingDecision = {
  joinableChallenges: MatchView[];
  selectedChallenge: MatchView | null;
  joinableChallengeCount: number;
  nextRecommendedTool: "moonjoy_auto" | null;
  nextActionReason: string;
  coordination: {
    mode: "none" | "yield_to_joinable" | "hold_own_challenge";
    ownMatchId: string | null;
    targetMatchId: string | null;
  };
};

export function decideMatchmakingAction(
  snapshot: ActiveMatchSnapshot,
  open: OpenChallengeSnapshot,
): MatchmakingDecision {
  const joinableChallenges = open.challenges
    .filter((candidate) => candidate.opponent === null)
    .sort(compareChallengePriority);
  const selectedChallenge = joinableChallenges[0] ?? null;
  const ownOpenChallenge =
    snapshot.activeMatch?.status === "created" &&
    snapshot.activeMatch.viewerSeat === "creator" &&
    snapshot.activeMatch.opponent === null
      ? snapshot.activeMatch
      : null;

  if (selectedChallenge) {
    if (
      ownOpenChallenge &&
      compareChallengePriority(ownOpenChallenge, selectedChallenge) <= 0
    ) {
      return {
        joinableChallenges,
        selectedChallenge: null,
        joinableChallengeCount: joinableChallenges.length,
        nextRecommendedTool: null,
        nextActionReason:
          "Coordination hold: this agent created the earlier open challenge. The later creator must cancel and accept this match.",
        coordination: {
          mode: "hold_own_challenge",
          ownMatchId: ownOpenChallenge.id,
          targetMatchId: selectedChallenge.id,
        },
      };
    }

    return {
      joinableChallenges,
      selectedChallenge,
      joinableChallengeCount: joinableChallenges.length,
      nextRecommendedTool: "moonjoy_auto",
      nextActionReason: ownOpenChallenge
        ? "This agent created the later open challenge; cancel it and accept the earlier challenge."
        : "Accept the selected joinable challenge.",
      coordination: {
        mode: ownOpenChallenge ? "yield_to_joinable" : "none",
        ownMatchId: ownOpenChallenge?.id ?? null,
        targetMatchId: selectedChallenge.id,
      },
    };
  }

  if (!snapshot.activeMatch) {
    return {
      joinableChallenges,
      selectedChallenge: null,
      joinableChallengeCount: 0,
      nextRecommendedTool: "moonjoy_auto",
      nextActionReason: "No active or joinable match exists; create a new challenge.",
      coordination: {
        mode: "none",
        ownMatchId: null,
        targetMatchId: null,
      },
    };
  }

  return {
    joinableChallenges,
    selectedChallenge: null,
    joinableChallengeCount: 0,
    nextRecommendedTool: null,
    nextActionReason: `Active match ${snapshot.activeMatch.id} is in status=${snapshot.activeMatch.status}. Monitor only.`,
    coordination: {
      mode: ownOpenChallenge ? "hold_own_challenge" : "none",
      ownMatchId: ownOpenChallenge?.id ?? null,
      targetMatchId: null,
    },
  };
}

function compareChallengePriority(left: MatchView, right: MatchView): number {
  const leftCreatedAt = Date.parse(left.createdAt);
  const rightCreatedAt = Date.parse(right.createdAt);

  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  return left.id.localeCompare(right.id);
}
