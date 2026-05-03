import type { MatchView, MatchViewer } from "@/lib/types/match";
import type { LeaderboardEntry } from "@/lib/services/leaderboard-service";
import type { PortfolioView } from "@/lib/types/trading";
import type { InviteView } from "@/lib/services/invite-service";

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

export type EnrichedTrade = {
  id: string;
  agentId: string;
  seat: "creator" | "opponent";
  phase: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  quotedAmountOut: string;
  simulatedAmountOut: string;
  slippageBps: number;
  tradeSide: "buy" | "sell" | "swap" | "exit" | null;
  realizedPnlUsd: number | null;
  closedCostBasisUsd: number | null;
  inputValueUsd: number | null;
  outputValueUsd: number | null;
  retryable: boolean;
  status: "accepted" | "rejected";
  failureReason: string | null;
  acceptedAt: string;
  quote: {
    routing: string;
    routeSummary: Record<string, unknown>;
    gasEstimate: string | null;
    gasFeeUsd: number | null;
    priceImpactBps: number | null;
    fetchedAt: string;
  } | null;
};

export type MandatoryWindowResult = {
  windowName: "opening_window" | "closing_window";
  completed: boolean;
  penaltyUsd: number;
  assessedAt: string;
};

export type ArenaEventLogEntry = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
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
  mandatoryWindowResults: MandatoryWindowResult[];
  trades: EnrichedTrade[];
  leaderboard: LeaderboardEntry[];
  creatorPortfolio: PortfolioView | null;
  opponentPortfolio: PortfolioView | null;
  allowedTokens: Array<{
    address: string;
    symbol: string;
    decimals: number;
    riskTier: string;
  }>;
  eventLog: ArenaEventLogEntry[];
};

export type ArenaSnapshot = {
  viewer: MatchViewer;
  readiness: ArenaReadiness;
  planning: PlanningMessage[];
  strategies: ArenaStrategySummary[];
  activeMatch: MatchView | null;
  openInvite: InviteView | null;
  live: LiveMatchData | null;
  generatedAt: string;
};
