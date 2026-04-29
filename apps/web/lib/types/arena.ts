import type { MatchView, MatchViewer, OpenChallengeSnapshot } from "@/lib/types/match";
import type { LeaderboardEntry } from "@/lib/services/leaderboard-service";
import type { PortfolioView } from "@/lib/types/trading";

export type PlanningMessage = {
  id: string;
  agentId: string;
  userId: string;
  matchId: string | null;
  strategyId: string | null;
  role: "user" | "agent" | "system";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ArenaReadiness = {
  hasUser: boolean;
  hasAgent: boolean;
  hasSmartAccount: boolean;
  hasMcpApproval: boolean;
  hasUserEns: boolean;
  hasAgentEns: boolean;
  hasStrategy: boolean;
  ready: boolean;
  blockers: string[];
};

export type ArenaStrategySummary = {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  createdAt: string;
};

export type LiveMatchData = {
  match: MatchView;
  phase: string;
  elapsedSeconds: number;
  remainingSeconds: number;
  mandatoryWindows: Array<{
    name: string;
    startsAt: string;
    endsAt: string;
    completed: boolean;
  }>;
  trades: Array<Record<string, unknown>>;
  leaderboard: LeaderboardEntry[];
  viewerPortfolio: PortfolioView | null;
  opponentPortfolio: PortfolioView | null;
  allowedTokens: Array<{
    address: string;
    symbol: string;
    decimals: number;
    riskTier: string;
  }>;
};

export type ArenaSnapshot = {
  viewer: MatchViewer;
  readiness: ArenaReadiness;
  planning: PlanningMessage[];
  strategies: ArenaStrategySummary[];
  activeMatch: MatchView | null;
  openChallenges: OpenChallengeSnapshot | null;
  live: LiveMatchData | null;
  generatedAt: string;
};
