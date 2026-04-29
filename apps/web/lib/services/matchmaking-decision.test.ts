import { expect, test } from "bun:test";
import { decideMatchmakingAction } from "./matchmaking-decision";
import type {
  ActiveMatchSnapshot,
  MatchParticipantView,
  MatchView,
  MatchViewer,
  OpenChallengeSnapshot,
} from "@/lib/types/match";

const viewer: MatchViewer = {
  userId: "viewer-user",
  agentId: "viewer-agent",
  userEnsName: "viewer.moonjoy.eth",
  agentEnsName: "agent-viewer.moonjoy.eth",
  agentTopic: "agent:viewer-agent:matches",
};

const creator: MatchParticipantView = {
  userId: "creator-user",
  agentId: "creator-agent",
  smartAccountAddress: "0xcreator",
  userEnsName: "creator.moonjoy.eth",
  agentEnsName: "agent-creator.moonjoy.eth",
};

function snapshot(activeMatch: MatchView | null): ActiveMatchSnapshot {
  return {
    viewer,
    activeMatch,
    openChallengeCount: 0,
    generatedAt: "2026-04-29T00:00:00.000Z",
  };
}

function openChallenges(challenges: MatchView[]): OpenChallengeSnapshot {
  return {
    viewer,
    challenges,
    generatedAt: "2026-04-29T00:00:00.000Z",
  };
}

function match(params: {
  id: string;
  viewerSeat: "creator" | "opponent" | null;
  opponent?: MatchParticipantView | null;
  createdAt?: string;
}): MatchView {
  return {
    id: params.id,
    status: "created",
    viewerSeat: params.viewerSeat,
    wagerUsd: 10,
    liveDurationSeconds: 300,
    warmupDurationSeconds: 30,
    settlementGraceSeconds: 15,
    startingCapitalUsd: 100,
    creator,
    invite: null,
    opponent: params.opponent ?? null,
    createdAt: params.createdAt ?? "2026-04-29T00:00:00.000Z",
    warmupStartedAt: null,
    liveStartedAt: null,
    liveEndsAt: null,
    settlingStartedAt: null,
    settledAt: null,
    nextTransitionAt: null,
    resultSummary: null,
  };
}

test("selects an existing joinable challenge when the agent has no active match", () => {
  const joinable = match({ id: "joinable-match", viewerSeat: null });
  const decision = decideMatchmakingAction(
    snapshot(null),
    openChallenges([joinable]),
  );

  expect(decision.selectedChallenge?.id).toBe("joinable-match");
  expect(decision.joinableChallengeCount).toBe(1);
  expect(decision.nextRecommendedTool).toBe("moonjoy_auto");
  expect(decision.nextActionReason).toBe("Accept the selected joinable challenge.");
});

test("prefers canceling an own open challenge before accepting a joinable challenge", () => {
  const ownOpen = match({
    id: "own-match",
    viewerSeat: "creator",
    createdAt: "2026-04-29T00:00:02.000Z",
  });
  const joinable = match({
    id: "joinable-match",
    viewerSeat: null,
    createdAt: "2026-04-29T00:00:01.000Z",
  });
  const decision = decideMatchmakingAction(
    snapshot(ownOpen),
    openChallenges([joinable]),
  );

  expect(decision.selectedChallenge?.id).toBe("joinable-match");
  expect(decision.joinableChallengeCount).toBe(1);
  expect(decision.nextRecommendedTool).toBe("moonjoy_auto");
  expect(decision.nextActionReason).toBe(
    "This agent created the later open challenge; cancel it and accept the earlier challenge.",
  );
  expect(decision.coordination).toEqual({
    mode: "yield_to_joinable",
    ownMatchId: "own-match",
    targetMatchId: "joinable-match",
  });
});

test("holds the canonical own challenge when both agents have open challenges", () => {
  const ownOpen = match({
    id: "own-match",
    viewerSeat: "creator",
    createdAt: "2026-04-29T00:00:01.000Z",
  });
  const joinable = match({
    id: "joinable-match",
    viewerSeat: null,
    createdAt: "2026-04-29T00:00:02.000Z",
  });
  const decision = decideMatchmakingAction(
    snapshot(ownOpen),
    openChallenges([joinable]),
  );

  expect(decision.selectedChallenge).toBeNull();
  expect(decision.joinableChallengeCount).toBe(1);
  expect(decision.nextRecommendedTool).toBeNull();
  expect(decision.nextActionReason).toBe(
    "Coordination hold: this agent created the earlier open challenge. The later creator must cancel and accept this match.",
  );
  expect(decision.coordination).toEqual({
    mode: "hold_own_challenge",
    ownMatchId: "own-match",
    targetMatchId: "joinable-match",
  });
});

test("monitors an own open challenge when no joinable challenge exists", () => {
  const ownOpen = match({ id: "own-match", viewerSeat: "creator" });
  const decision = decideMatchmakingAction(snapshot(ownOpen), openChallenges([]));

  expect(decision.selectedChallenge).toBeNull();
  expect(decision.joinableChallengeCount).toBe(0);
  expect(decision.nextRecommendedTool).toBeNull();
  expect(decision.nextActionReason).toBe(
    "Active match own-match is in status=created. Monitor only.",
  );
});

test("recommends creating a challenge when no active or joinable match exists", () => {
  const decision = decideMatchmakingAction(snapshot(null), openChallenges([]));

  expect(decision.selectedChallenge).toBeNull();
  expect(decision.joinableChallengeCount).toBe(0);
  expect(decision.nextRecommendedTool).toBe("moonjoy_auto");
  expect(decision.nextActionReason).toBe(
    "No active or joinable match exists; create a new challenge.",
  );
});
