import { rankLeaderboard, type LeaderboardRow } from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeValuation,
  getTotalPenalties,
  getAllBalances,
  type ValuationResult,
} from "@/lib/services/portfolio-ledger-service";

export type LeaderboardEntry = {
  rank: number;
  agentId: string;
  seat: "creator" | "opponent";
  currentValueUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  pnlPercent: number;
  penaltiesUsd: number;
  penaltyImpactUsd: number;
  netScoreUsd: number;
  netScorePercent: number;
  mandatoryWindowsCompleted: number;
  failedTradeCount: number;
  maxDrawdownPercent: number;
};

export async function getLeaderboardForMatch(
  matchId: string,
): Promise<LeaderboardEntry[]> {
  const supabase = createAdminClient();

  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .single();

  if (!match) return [];

  const row = match as Record<string, unknown>;
  const creatorAgentId = row.creator_agent_id as string;
  const opponentAgentId = row.opponent_agent_id as string;
  const startingCapital = Number(row.starting_capital_usd);

  if (!opponentAgentId) return [];

  const creatorAddress = row.creator_smart_account_address as string;
  const opponentAddress = row.opponent_smart_account_address as string;

  const [creatorVal, opponentVal, creatorPenalties, opponentPenalties] =
    await Promise.all([
      getLatestValuation(matchId, creatorAgentId),
      getLatestValuation(matchId, opponentAgentId),
      getTotalPenalties(matchId, creatorAgentId),
      getTotalPenalties(matchId, opponentAgentId),
    ]);

  const [creatorWindows, opponentWindows, creatorFailed, opponentFailed] =
    await Promise.all([
      countCompletedWindows(matchId, creatorAgentId),
      countCompletedWindows(matchId, opponentAgentId),
      countFailedTrades(matchId, creatorAgentId),
      countFailedTrades(matchId, opponentAgentId),
    ]);

  const rows: LeaderboardRow[] = [
    {
      agentId: creatorAgentId,
      seat: "creator",
      startingValueUsd: startingCapital,
      currentValueUsd: creatorVal?.currentValueUsd ?? startingCapital,
      realizedPnlUsd: creatorVal?.realizedPnlUsd ?? 0,
      unrealizedPnlUsd: creatorVal?.unrealizedPnlUsd ?? 0,
      totalPnlUsd: creatorVal?.totalPnlUsd ?? 0,
      pnlPercent: creatorVal?.pnlPercent ?? 0,
      penaltiesUsd: creatorPenalties,
      netScoreUsd: creatorVal?.netScoreUsd ?? 0,
      netScorePercent: creatorVal?.netScorePercent ?? 0,
      mandatoryWindowsCompleted: creatorWindows,
      failedTradeCount: creatorFailed,
      maxDrawdownPercent: creatorVal?.maxDrawdownPercent ?? 0,
      lastProfitableTradeAt: null,
    },
    {
      agentId: opponentAgentId,
      seat: "opponent",
      startingValueUsd: startingCapital,
      currentValueUsd: opponentVal?.currentValueUsd ?? startingCapital,
      realizedPnlUsd: opponentVal?.realizedPnlUsd ?? 0,
      unrealizedPnlUsd: opponentVal?.unrealizedPnlUsd ?? 0,
      totalPnlUsd: opponentVal?.totalPnlUsd ?? 0,
      pnlPercent: opponentVal?.pnlPercent ?? 0,
      penaltiesUsd: opponentPenalties,
      netScoreUsd: opponentVal?.netScoreUsd ?? 0,
      netScorePercent: opponentVal?.netScorePercent ?? 0,
      mandatoryWindowsCompleted: opponentWindows,
      failedTradeCount: opponentFailed,
      maxDrawdownPercent: opponentVal?.maxDrawdownPercent ?? 0,
      lastProfitableTradeAt: null,
    },
  ];

  const ranked = rankLeaderboard(rows);

  return ranked.map((r, i) => ({
    rank: i + 1,
    agentId: r.agentId,
    seat: r.seat,
    currentValueUsd: r.currentValueUsd,
    realizedPnlUsd: r.realizedPnlUsd,
    unrealizedPnlUsd: r.unrealizedPnlUsd,
    totalPnlUsd: r.totalPnlUsd,
    pnlPercent: r.pnlPercent,
    penaltiesUsd: r.penaltiesUsd,
    penaltyImpactUsd: -r.penaltiesUsd,
    netScoreUsd: r.netScoreUsd,
    netScorePercent: r.netScorePercent,
    mandatoryWindowsCompleted: r.mandatoryWindowsCompleted,
    failedTradeCount: r.failedTradeCount,
    maxDrawdownPercent: r.maxDrawdownPercent,
  }));
}

async function getLatestValuation(
  matchId: string,
  agentId: string,
): Promise<ValuationResult | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("portfolio_valuation_snapshots")
    .select("*")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const d = data as Record<string, unknown>;
  return {
    startingValueUsd: Number(d.starting_value_usd),
    currentValueUsd: Number(d.current_value_usd),
    realizedPnlUsd: Number(d.realized_pnl_usd),
    unrealizedPnlUsd: Number(d.unrealized_pnl_usd),
    totalPnlUsd: Number(d.total_pnl_usd),
    pnlPercent: Number(d.pnl_percent),
    penaltiesUsd: Number(d.penalties_usd),
    penaltyImpactUsd: -Number(d.penalties_usd),
    netScoreUsd: Number(d.total_pnl_usd) - Number(d.penalties_usd),
    netScorePercent: Number(d.net_score_percent),
    maxDrawdownPercent: Number(d.max_drawdown_percent),
    stale: Boolean(d.stale),
    quoteSnapshotIds: (d.quote_snapshot_ids as string[]) ?? [],
  };
}

async function countCompletedWindows(
  matchId: string,
  agentId: string,
): Promise<number> {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from("mandatory_window_results")
    .select("id", { count: "exact", head: true })
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .eq("completed", true);

  return count ?? 0;
}

async function countFailedTrades(
  matchId: string,
  agentId: string,
): Promise<number> {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from("simulated_trades")
    .select("id", { count: "exact", head: true })
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .eq("status", "rejected");

  return count ?? 0;
}
