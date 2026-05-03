import type { MatchSeat, MatchStatus } from "@moonjoy/game";

export type MatchRow = {
  id: string;
  creator_user_id: string;
  creator_agent_id: string;
  creator_smart_account_address: string;
  invited_user_id: string | null;
  invite_code: string | null;
  opponent_user_id: string | null;
  opponent_agent_id: string | null;
  opponent_smart_account_address: string | null;
  status: MatchStatus;
  wager_usd: number;
  live_duration_seconds: number;
  warmup_duration_seconds: number;
  settlement_grace_seconds: number;
  starting_capital_usd: number;
  trade_rules_version: "buy_only_v1" | "bidirectional_v2";
  winner_seat: MatchSeat | null;
  winner_agent_id: string | null;
  result_summary: Record<string, unknown>;
  created_at: string;
  warmup_started_at: string | null;
  live_started_at: string | null;
  live_ends_at: string | null;
  settling_started_at: string | null;
  settled_at: string | null;
  updated_at: string;
};

export type MatchEventRow = {
  id: string;
  match_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type MatchParticipantView = {
  userId: string;
  agentId: string;
  smartAccountAddress: string;
  userEnsName: string;
  agentEnsName: string;
};

export type MatchStrategySummaryView = {
  id: string;
  name: string;
  strategyKind: "public" | "secret_sauce";
  sourceType: string;
  manifestPointer: string;
  updatedAt: string;
};

export type WarmupPreparationView = {
  totalReadyAgents: number;
  readyAgentIds: string[];
  viewerReadyMarked: boolean;
  opponentReadyMarked: boolean;
  viewerPublicStrategy: MatchStrategySummaryView | null;
  viewerSecretStrategy: MatchStrategySummaryView | null;
  opponentPublicStrategy: MatchStrategySummaryView | null;
  guidance: string;
};

export type MatchView = {
  id: string;
  status: MatchStatus;
  viewerSeat: MatchSeat | null;
  wagerUsd: number;
  liveDurationSeconds: number;
  warmupDurationSeconds: number;
  settlementGraceSeconds: number;
  startingCapitalUsd: number;
  tradeRulesVersion: "buy_only_v1" | "bidirectional_v2";
  creator: MatchParticipantView;
  invite: MatchInviteView | null;
  opponent: MatchParticipantView | null;
  createdAt: string;
  warmupStartedAt: string | null;
  liveStartedAt: string | null;
  liveEndsAt: string | null;
  settlingStartedAt: string | null;
  settledAt: string | null;
  nextTransitionAt: string | null;
  resultSummary: Record<string, unknown> | null;
  warmupPreparation: WarmupPreparationView | null;
};

export type MatchInviteView = {
  invitedUserId: string | null;
  inviteCode: string | null;
  invitePath: string | null;
};

export type MatchViewer = {
  userId: string;
  agentId: string;
  userEnsName: string;
  agentEnsName: string;
  agentTopic: string;
};

export type ActiveMatchSnapshot = {
  viewer: MatchViewer;
  activeMatch: MatchView | null;
  recentSettledMatch: MatchView | null;
  generatedAt: string;
};
