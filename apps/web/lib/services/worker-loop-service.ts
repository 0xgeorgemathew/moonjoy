import {
  checkMandatoryWindow,
  computeMandatoryWindowPenalty,
  getMandatoryWindows,
  rankLeaderboard,
  selectMatchWinner,
  type LeaderboardRow,
} from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeValuation,
  initializeStartingBalances,
  getTotalPenalties,
  applyPenaltyLedger,
  type ValuationResult,
} from "@/lib/services/portfolio-ledger-service";
import { initializeMatchTokenAllowlist } from "@/lib/services/token-universe-service";

export type WorkerTickResult = {
  matchId: string;
  previousPhase: string;
  currentPhase: string;
  actions: string[];
};

export async function tickActiveMatch(
  matchId: string,
  now: Date,
): Promise<WorkerTickResult> {
  const actions: string[] = [];
  const supabase = createAdminClient();

  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .single();

  if (!match) {
    return { matchId, previousPhase: "unknown", currentPhase: "unknown", actions };
  }

  const row = match as Record<string, unknown>;
  const status = row.status as string;
  const liveStartedAt = row.live_started_at ? new Date(row.live_started_at as string) : null;
  const liveEndsAt = row.live_ends_at ? new Date(row.live_ends_at as string) : null;

  if (!["live", "settling"].includes(status)) {
    return {
      matchId,
      previousPhase: status,
      currentPhase: status,
      actions,
    };
  }

  const previousPhase = status;

  // Transition live → settling when match time expires
  if (status === "live" && liveEndsAt && now.getTime() >= liveEndsAt.getTime()) {
    await supabase
      .from("matches")
      .update({ status: "settling", settling_started_at: liveEndsAt.toISOString(), updated_at: now.toISOString() })
      .eq("id", matchId)
      .eq("status", "live");
    actions.push("transitioned_to_settling");
    return { matchId, previousPhase, currentPhase: "settling", actions };
  }

  if (status === "live" && liveStartedAt && liveEndsAt) {
    const creatorAgentId = row.creator_agent_id as string;
    const opponentAgentId = row.opponent_agent_id as string;
    const startingCapital = Number(row.starting_capital_usd);
    const creatorAddress = row.creator_smart_account_address as string;
    const opponentAddress = row.opponent_smart_account_address as string;

    // Initialize portfolios per-agent if not done yet
    for (const agentId of [creatorAgentId, opponentAgentId]) {
      const { data: existingEntries } = await supabase
        .from("portfolio_ledger_entries")
        .select("id")
        .eq("match_id", matchId)
        .eq("agent_id", agentId)
        .eq("entry_type", "starting_balance")
        .limit(1);

      if (!existingEntries || existingEntries.length === 0) {
        await initializeStartingBalances(matchId, agentId, startingCapital);
        actions.push(`initialized_portfolio_${agentId === creatorAgentId ? "creator" : "opponent"}`);
      }
    }

    // Initialize token allowlist once
    const { data: existingAllowlist } = await supabase
      .from("match_token_allowlists")
      .select("id")
      .eq("match_id", matchId)
      .limit(1);
    if (!existingAllowlist || existingAllowlist.length === 0) {
      await initializeMatchTokenAllowlist(matchId);
      actions.push("initialized_token_allowlist");
    }

    // Refresh valuations
    const creatorValuation = await computeValuation(
      matchId,
      creatorAgentId,
      "live",
      startingCapital,
      creatorAddress,
    );
    const opponentValuation = await computeValuation(
      matchId,
      opponentAgentId,
      "live",
      startingCapital,
      opponentAddress,
    );
    actions.push("refreshed_valuations");

    await broadcastValuationRefreshed(matchId, creatorAgentId, opponentAgentId);

    // Check mandatory windows
    const windows = getMandatoryWindows(liveStartedAt, liveEndsAt);
    for (const window of windows) {
      if (now.getTime() >= window.endsAt.getTime()) {
        await assessWindowForAgent(
          matchId,
          creatorAgentId,
          window,
          startingCapital,
        );
        await assessWindowForAgent(
          matchId,
          opponentAgentId,
          window,
          startingCapital,
        );
      }
    }
  }

  if (status === "settling") {
    await settleMatchFromWorker(matchId, now);
    actions.push("settled");
  }

  return {
    matchId,
    previousPhase,
    currentPhase: status,
    actions,
  };
}

async function assessWindowForAgent(
  matchId: string,
  agentId: string,
  window: { name: "opening_window" | "closing_window"; startsAt: Date; endsAt: Date },
  startingCapital: number,
): Promise<void> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("mandatory_window_results")
    .select("id")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .eq("window_name", window.name)
    .maybeSingle();

  if (existing) return;

  const { data: trades } = await supabase
    .from("simulated_trades")
    .select("accepted_at")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .eq("status", "accepted");

  const timestamps = (trades ?? []).map((t) => new Date(t.accepted_at as string));
  const check = checkMandatoryWindow(window, timestamps);

  const penaltyUsd = check.completed ? 0 : computeMandatoryWindowPenalty(startingCapital);

  await supabase.from("mandatory_window_results").insert({
    match_id: matchId,
    agent_id: agentId,
    window_name: window.name,
    completed: check.completed,
    penalty_usd: penaltyUsd,
  });

  if (!check.completed && penaltyUsd > 0) {
    await applyPenaltyLedger(matchId, agentId, penaltyUsd, window.name);
  }
}

async function settleMatchFromWorker(
  matchId: string,
  now: Date,
): Promise<void> {
  const supabase = createAdminClient();

  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .single();

  if (!match || (match as Record<string, unknown>).status !== "settling") return;

  const row = match as Record<string, unknown>;
  const creatorAgentId = row.creator_agent_id as string;
  const opponentAgentId = row.opponent_agent_id as string;
  const startingCapital = Number(row.starting_capital_usd);
  const creatorAddress = row.creator_smart_account_address as string;
  const opponentAddress = row.opponent_smart_account_address as string;

  // Final valuations
  const creatorValuation = await computeValuation(
    matchId,
    creatorAgentId,
    "settling",
    startingCapital,
    creatorAddress,
    { requireFresh: true, final: true },
  );
  const opponentValuation = await computeValuation(
    matchId,
    opponentAgentId,
    "settling",
    startingCapital,
    opponentAddress,
    { requireFresh: true, final: true },
  );

  // Assess any remaining mandatory windows
  const liveStartedAt = row.live_started_at ? new Date(row.live_started_at as string) : null;
  const liveEndsAt = row.live_ends_at ? new Date(row.live_ends_at as string) : null;

  if (liveStartedAt && liveEndsAt) {
    const windows = getMandatoryWindows(liveStartedAt, liveEndsAt);
    for (const window of windows) {
      await assessWindowForAgent(matchId, creatorAgentId, window, startingCapital);
      await assessWindowForAgent(matchId, opponentAgentId, window, startingCapital);
    }
  }

  const creatorPenalties = await getTotalPenalties(matchId, creatorAgentId);
  const opponentPenalties = await getTotalPenalties(matchId, opponentAgentId);

  const { count: creatorFailedCount } = await supabase
    .from("simulated_trades")
    .select("id", { count: "exact", head: true })
    .eq("match_id", matchId)
    .eq("agent_id", creatorAgentId)
    .eq("status", "rejected");

  const { count: opponentFailedCount } = await supabase
    .from("simulated_trades")
    .select("id", { count: "exact", head: true })
    .eq("match_id", matchId)
    .eq("agent_id", opponentAgentId)
    .eq("status", "rejected");

  const { data: creatorLastProfitable } = await supabase
    .from("simulated_trades")
    .select("accepted_at")
    .eq("match_id", matchId)
    .eq("agent_id", creatorAgentId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: opponentLastProfitable } = await supabase
    .from("simulated_trades")
    .select("accepted_at")
    .eq("match_id", matchId)
    .eq("agent_id", opponentAgentId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const creatorRow: LeaderboardRow = {
    agentId: creatorAgentId,
    seat: "creator",
    startingValueUsd: startingCapital,
    currentValueUsd: creatorValuation.currentValueUsd,
    usdcBalanceUsd: creatorValuation.usdcBalanceUsd,
    realizedPnlUsd: creatorValuation.realizedPnlUsd,
    unrealizedPnlUsd: creatorValuation.unrealizedPnlUsd,
    totalPnlUsd: creatorValuation.totalPnlUsd,
    pnlPercent: creatorValuation.pnlPercent,
    penaltiesUsd: creatorPenalties,
    netScoreUsd: creatorValuation.netScoreUsd,
    netScorePercent: creatorValuation.netScorePercent,
    mandatoryWindowsCompleted: 0,
    failedTradeCount: creatorFailedCount ?? 0,
    maxDrawdownPercent: creatorValuation.maxDrawdownPercent,
    lastProfitableTradeAt: creatorLastProfitable
      ? new Date(creatorLastProfitable.accepted_at as string)
      : null,
  };

  const opponentRow: LeaderboardRow = {
    agentId: opponentAgentId,
    seat: "opponent",
    startingValueUsd: startingCapital,
    currentValueUsd: opponentValuation.currentValueUsd,
    usdcBalanceUsd: opponentValuation.usdcBalanceUsd,
    realizedPnlUsd: opponentValuation.realizedPnlUsd,
    unrealizedPnlUsd: opponentValuation.unrealizedPnlUsd,
    totalPnlUsd: opponentValuation.totalPnlUsd,
    pnlPercent: opponentValuation.pnlPercent,
    penaltiesUsd: opponentPenalties,
    netScoreUsd: opponentValuation.netScoreUsd,
    netScorePercent: opponentValuation.netScorePercent,
    mandatoryWindowsCompleted: 0,
    failedTradeCount: opponentFailedCount ?? 0,
    maxDrawdownPercent: opponentValuation.maxDrawdownPercent,
    lastProfitableTradeAt: opponentLastProfitable
      ? new Date(opponentLastProfitable.accepted_at as string)
      : null,
  };

  const result = selectMatchWinner(creatorRow, opponentRow);

  await supabase
    .from("matches")
    .update({
      status: "settled",
      settled_at: now.toISOString(),
      winner_seat: result.winnerSeat,
      winner_agent_id: result.winnerAgentId,
      result_summary: {
        scoreMetric: "net_normalized_pnl_percent",
        outcome: result.outcome,
        winnerSeat: result.winnerSeat,
        spreadUsd: result.spreadUsd,
        spreadPnlPercent: result.spreadPnlPercent,
        creator: {
          currentValueUsd: creatorValuation.currentValueUsd,
          usdcBalanceUsd: creatorValuation.usdcBalanceUsd,
          totalPnlUsd: creatorValuation.totalPnlUsd,
          pnlPercent: creatorValuation.pnlPercent,
          netScorePercent: creatorValuation.netScorePercent,
          penaltiesUsd: creatorPenalties,
        },
        opponent: {
          currentValueUsd: opponentValuation.currentValueUsd,
          usdcBalanceUsd: opponentValuation.usdcBalanceUsd,
          totalPnlUsd: opponentValuation.totalPnlUsd,
          pnlPercent: opponentValuation.pnlPercent,
          netScorePercent: opponentValuation.netScorePercent,
          penaltiesUsd: opponentPenalties,
        },
      },
      updated_at: now.toISOString(),
    })
    .eq("id", matchId)
    .eq("status", "settling");
}

export async function getActiveMatchesForWorker(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("matches")
    .select("id")
    .in("status", ["live", "settling"]);

  if (!data) return [];
  return data.map((r) => (r as { id: string }).id);
}

async function broadcastValuationRefreshed(
  matchId: string,
  creatorAgentId: string,
  opponentAgentId: string,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return;

  const topics = [
    `match:${matchId}`,
    `agent:${creatorAgentId}:matches`,
    `agent:${opponentAgentId}:matches`,
  ];

  await Promise.all(
    topics.map(async (topic) => {
      try {
        await fetch(`${url}/rest/v1/rpc/broadcast`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            topic,
            event: "valuation_refreshed",
            payload: {
              eventType: "valuation.refreshed",
              matchId,
              updatedAt: new Date().toISOString(),
            },
            private: false,
          }),
        });
      } catch {
        // Broadcast is best-effort
      }
    }),
  );
}
