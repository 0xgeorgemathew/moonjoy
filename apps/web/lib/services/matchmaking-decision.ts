/** @deprecated Agent matchmaking is retired. Humans create and accept invites through the web app. */
export type MatchmakingDecision = {
  nextRecommendedTool: null;
  nextActionReason: string;
};

/** @deprecated Agent matchmaking is retired. Use invite links instead. */
export function decideMatchmakingAction(): MatchmakingDecision {
  throw new Error(
    "Agent matchmaking is retired. Humans create and accept invites through the web app.",
  );
}
