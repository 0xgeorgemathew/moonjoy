"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { createClient } from "@/lib/supabase/client";
import type { ArenaEventLogEntry, ArenaSnapshot, EnrichedTrade } from "@/lib/types/arena";
import type { MatchView } from "@/lib/types/match";
import type { PortfolioView } from "@/lib/types/trading";
import { MatchResultModal } from "@/components/match-result-modal";

// ─── Number Formatting ────────────────────────────

function formatAmount(raw: string, decimals: number): string {
  const n = parseFloat(raw) / Math.pow(10, decimals);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n === 0) return "0";
  if (n < 0.001 && n > 0) return "<0.001";
  if (n > -0.001 && n < 0) return ">-0.001";
  return n.toFixed(Math.max(2, 4 - Math.floor(Math.log10(Math.abs(n)))));
}

function fmtMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function pnlSign(val: number): string {
  return val >= 0 ? "+" : "";
}

function pnlClass(val: number): "positive" | "negative" | "neutral" {
  if (val > 0) return "positive";
  if (val < 0) return "negative";
  return "neutral";
}

function phaseInfo(phase: string): { label: string; active: boolean; isLive: boolean } {
  switch (phase) {
    case "warmup": return { label: "WARM UP", active: true, isLive: false };
    case "opening_window": return { label: "OPENING", active: true, isLive: true };
    case "midgame":
    case "live": return { label: "LIVE", active: true, isLive: true };
    case "cycle_out": return { label: "CYCLE OUT", active: true, isLive: true };
    case "settling": return { label: "SETTLING", active: false, isLive: false };
    case "settled": return { label: "FINAL", active: false, isLive: false };
    default: return { label: phase.replace(/_/g, " ").toUpperCase(), active: false, isLive: false };
  }
}

function firstLabel(ens: string): string {
  const dot = ens.indexOf(".");
  return dot > 0 ? ens.slice(0, dot) : ens;
}

// ─── Main Component ──────────────────────────────

export function ArenaPanel() {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [supabase] = useState(() => createClient());
  const feedRef = useRef<HTMLDivElement>(null);
  const prevTradeCountRef = useRef(0);

  const [snapshot, setSnapshot] = useState<ArenaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [snapshotLoadedAt, setSnapshotLoadedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [resultDismissed, setResultDismissed] = useState(false);
  const prevSettledMatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const matchId = snapshot?.recentSettledMatch?.id ?? null;
    if (matchId !== prevSettledMatchIdRef.current) {
      prevSettledMatchIdRef.current = matchId;
      setResultDismissed(false);
    }
  }, [snapshot?.recentSettledMatch?.id]);

  const fetchJson = useCallback(
    async <T,>(url: string, opts?: RequestInit): Promise<T> => {
      const token = await getAccessToken();
      if (!token) throw new Error("Missing access token.");
      const res = await fetch(url, {
        ...opts,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...opts?.headers },
      });
      const body = (await res.json()) as T | { error?: string };
      if (!res.ok) {
        const errMsg = body && typeof body === "object" && "error" in body ? body.error : "Request failed.";
        throw new Error(errMsg);
      }
      return body as T;
    },
    [getAccessToken],
  );

  const refreshSnapshot = useCallback(async () => {
    try {
      const snap = await fetchJson<ArenaSnapshot>("/api/arena/state");
      setSnapshot(snap);
      setConnected(true);
      setSnapshotLoadedAt(Date.now());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  useEffect(() => {
    if (!ready || !authenticated) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    queueMicrotask(() => void refreshSnapshot());
  }, [ready, authenticated, refreshSnapshot]);

  useEffect(() => {
    if (!snapshot?.viewer.agentTopic) return;
    const channel = supabase
      .channel(snapshot.viewer.agentTopic)
      .on("broadcast", { event: "match_state_changed" }, () => { void refreshSnapshot(); })
      .on("broadcast", { event: "invite_joined" }, () => { void refreshSnapshot(); })
      .on("broadcast", { event: "trade_accepted" }, () => { void refreshSnapshot(); })
      .on("broadcast", { event: "penalty_assessed" }, () => { void refreshSnapshot(); })
      .on("broadcast", { event: "valuation_refreshed" }, () => { void refreshSnapshot(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [snapshot?.viewer.agentTopic, refreshSnapshot, supabase]);

  useEffect(() => {
    if (!snapshot?.live?.match.id) return;
    const channel = supabase
      .channel(`match:${snapshot.live.match.id}`)
      .on("broadcast", { event: "match_state_changed" }, () => { void refreshSnapshot(); })
      .on("broadcast", { event: "trade_accepted" }, () => { void refreshSnapshot(); })
      .on("broadcast", { event: "penalty_assessed" }, () => { void refreshSnapshot(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [snapshot?.live?.match.id, refreshSnapshot, supabase]);

  useEffect(() => {
    if (!snapshot?.live?.match.id) return;
    const matchId = snapshot.live.match.id;

    const channel = supabase
      .channel(`arena-pg:${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "simulated_trades", filter: `match_id=eq.${matchId}` },
        () => { void refreshSnapshot(); },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "match_events", filter: `match_id=eq.${matchId}` },
        () => { void refreshSnapshot(); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "portfolio_valuation_snapshots", filter: `match_id=eq.${matchId}` },
        () => { void refreshSnapshot(); },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        () => { void refreshSnapshot(); },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [snapshot?.live?.match.id, refreshSnapshot, supabase]);

  useEffect(() => {
    const count = snapshot?.live?.trades.length ?? 0;
    if (count > prevTradeCountRef.current && feedRef.current) {
      const parent = feedRef.current.closest(".arena-battleground");
      if (parent) {
        parent.querySelectorAll(".arena-battleground-col").forEach(col => {
          if (col instanceof HTMLElement) col.scrollTop = 0;
        });
      }
    }
    prevTradeCountRef.current = count;
  }, [snapshot?.live?.trades.length]);

  useEffect(() => {
    if (!snapshot?.live?.match.id) return;
    const phase = snapshot.live.phase;
    const isLive = phase === "warmup" || phase === "opening_window" || phase === "midgame" || phase === "cycle_out" || phase === "live";
    if (!isLive) return;

    const id = setInterval(() => { void refreshSnapshot(); }, 5000);
    return () => clearInterval(id);
  }, [snapshot?.live?.match.id, snapshot?.live?.phase, refreshSnapshot]);

  const handleRevokeInvite = async (inviteId: string) => {
    setActionError(null);
    try {
      await fetchJson<void>("/api/invites", {
        method: "DELETE",
        body: JSON.stringify({ inviteId }),
      });
      await refreshSnapshot();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Revoke failed.");
    }
  };

  if (!ready || loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-6 bg-white">
        <div className="flex items-center gap-3">
          <span className="text-sm font-label font-bold uppercase tracking-widest text-artemis-charcoal">Syncing arena</span>
          <Dots />
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-6 p-8 bg-white">
        <p className="font-body text-artemis-charcoal text-center max-w-sm text-[15px]">Connect your Moonjoy account to enter the arena.</p>
        <button type="button" onClick={() => void login()} className="neo-btn px-6 py-3 text-sm">Connect to Enter</button>
      </div>
    );
  }

  const { viewer: _viewer, readiness, activeMatch, openInvite, live } = snapshot ?? {
    viewer: { userId: "", agentId: "", userEnsName: "", agentEnsName: "", agentTopic: "" },
    readiness: { hasUser: false, hasAgent: false, hasSmartAccount: false, hasMcpApproval: false, hasUserEns: false, hasAgentEns: false, ready: false, blockers: [] },
    activeMatch: null,
    recentSettledMatch: null,
    recentSettledPortfolios: null,
    openInvite: null,
    live: null,
  };
  const recentSettledMatch = snapshot?.recentSettledMatch ?? null;
  const recentSettledPortfolios = snapshot?.recentSettledPortfolios ?? null;

  const snapshotAge = Math.max(0, Math.floor((now - snapshotLoadedAt) / 1000));
  const localRemaining = live ? Math.max(0, live.remainingSeconds - snapshotAge) : 0;
  const tokenInfoMap = new Map(live?.allowedTokens?.map(t => [t.address.toLowerCase(), { symbol: t.symbol, decimals: t.decimals }]) ?? []);

  const agentMap = new Map<string, { agentEns: string; userEns: string; seat: "creator" | "opponent"; address: string }>();
  if (activeMatch) {
    agentMap.set(activeMatch.creator.agentId, {
      agentEns: activeMatch.creator.agentEnsName || "Creator Agent",
      userEns: activeMatch.creator.userEnsName || "",
      seat: "creator",
      address: activeMatch.creator.smartAccountAddress ?? "",
    });
    if (activeMatch.opponent) {
      agentMap.set(activeMatch.opponent.agentId, {
        agentEns: activeMatch.opponent.agentEnsName || "Challenger Agent",
        userEns: activeMatch.opponent.userEnsName || "",
        seat: "opponent",
        address: activeMatch.opponent.smartAccountAddress ?? "",
      });
    }
  }

  const creatorPortfolio = live?.creatorPortfolio ?? null;
  const opponentPortfolio = live?.opponentPortfolio ?? null;
  const creatorInfo = activeMatch?.creator ? agentMap.get(activeMatch.creator.agentId) ?? null : null;
  const opponentInfo = activeMatch?.opponent ? agentMap.get(activeMatch.opponent.agentId) ?? null : null;
  const allTrades = (live?.trades ?? [])
    .filter(t => t.status === "accepted")
    .sort((a, b) => new Date(b.acceptedAt).getTime() - new Date(a.acceptedAt).getTime());

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#fafaf8]">
      <header className="flex items-center justify-between px-5 py-2.5 border-b-3 border-black bg-white">
        <div className="flex items-center gap-3">
          <span className={`arena-phase-tag ${live ? (phaseInfo(live.phase).isLive ? "live" : "") : ""}`}>
            {live ? phaseInfo(live.phase).label : "ARENA"}
          </span>
          <LiveDot connected={connected} />
          {snapshot && (
            <span className="text-[11px] font-mono font-bold tabular-nums text-artemis-silver">
              {snapshotAge < 5 ? "● live" : snapshotAge < 30 ? `· ${snapshotAge}s ago` : `· ${snapshotAge}s`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {live && (
            <span className={`arena-timer-count ${localRemaining <= 30 ? "urgent" : ""}`}>
              {fmtMmSs(localRemaining)}
            </span>
          )}
          {activeMatch && (
            <span className="arena-wager-badge">${activeMatch.wagerUsd} WAGER</span>
          )}
        </div>
      </header>

      {!activeMatch && openInvite && openInvite.status === "open" && (
        <div className="flex items-center gap-2 px-4 py-2 border-b-3 border-black bg-[#fafaf8]">
          <span className="text-[10px] font-label font-bold uppercase tracking-widest text-artemis-charcoal/50 shrink-0">Invite</span>
          <span className="text-[11px] font-mono text-artemis-charcoal truncate flex-1">
            {`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`}
          </span>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`)}
            className="text-[10px] font-label font-bold uppercase bg-artemis-red text-white px-2.5 py-1 rounded border-2 border-black shrink-0 hover:bg-artemis-red-light transition-colors"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => void handleRevokeInvite(openInvite.id)}
            className="text-[10px] font-label font-bold uppercase text-artemis-red/50 hover:text-artemis-red transition-colors shrink-0 underline underline-offset-2"
          >
            Revoke
          </button>
        </div>
      )}

      {actionError && (
        <div className="px-5 py-2 border-b-3 border-black bg-artemis-red/10">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-label font-bold text-artemis-red">{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} className="text-[10px] font-label font-bold uppercase text-artemis-red/60 hover:text-artemis-red transition-colors">Dismiss</button>
          </div>
        </div>
      )}

      {activeMatch ? (
        <MatchHud
          match={activeMatch}
          live={live}
          creatorInfo={creatorInfo}
          opponentInfo={opponentInfo}
          creatorPortfolio={creatorPortfolio}
          opponentPortfolio={opponentPortfolio}
          allTrades={allTrades}
          tokenInfoMap={tokenInfoMap}
          eventLog={live?.eventLog ?? []}
          feedRef={feedRef}
        />
      ) : (
        <NoMatchView
          openInvite={openInvite}
          readiness={readiness}
          onRevoke={handleRevokeInvite}
        />
      )}

      {recentSettledMatch && recentSettledPortfolios && !resultDismissed && (
        <MatchResultModal
          open
          onClose={() => setResultDismissed(true)}
          match={recentSettledMatch}
          creatorPortfolio={recentSettledPortfolios.creator}
          opponentPortfolio={recentSettledPortfolios.opponent}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MATCH HUD — VS Arena + Trade Feed
// ══════════════════════════════════════════════════════════

function MatchHud({
  live,
  creatorInfo,
  opponentInfo,
  creatorPortfolio,
  opponentPortfolio,
  allTrades,
  tokenInfoMap,
  eventLog,
  feedRef,
}: {
  match: MatchView;
  live: ArenaSnapshot["live"];
  creatorInfo: { agentEns: string; userEns: string; seat: "creator" | "opponent"; address: string } | null;
  opponentInfo: { agentEns: string; userEns: string; seat: "creator" | "opponent"; address: string } | null;
  creatorPortfolio: PortfolioView | null;
  opponentPortfolio: PortfolioView | null;
  allTrades: EnrichedTrade[];
  tokenInfoMap: Map<string, { symbol: string; decimals: number }>;
  eventLog: ArenaEventLogEntry[];
  feedRef: React.RefObject<HTMLDivElement | null>;
}) {
  const creatorScore = creatorPortfolio?.netScorePercent ?? 0;
  const opponentScore = opponentPortfolio?.netScorePercent ?? 0;
  const creatorWinning = creatorScore > opponentScore;
  const scoresEqual = creatorScore === opponentScore;

  const creatorBarWidth = scoresEqual
    ? 50
    : Math.max(5, Math.min(95, 50 + (creatorScore - opponentScore) * 100 * 8));

  const opponentBarWidth = 100 - creatorBarWidth;

  const creatorTrades = allTrades.filter(t => t.seat === "creator");
  const opponentTrades = allTrades.filter(t => t.seat === "opponent");
  const statsSyncEvent = [...eventLog].reverse().find((event) =>
    event.eventType === "agent_stats.syncing" ||
    event.eventType === "agent_stats.synced" ||
    event.eventType === "agent_stats.sync_deferred"
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="arena-scoreboard">
        <div className="arena-scoreboard-players">
          <PlayerIdentity
            agentEns={creatorInfo?.agentEns ?? null}
            portfolio={creatorPortfolio}
            score={creatorScore}
            isWinner={creatorWinning && !scoresEqual}
            borderRight
          />
          <PlayerIdentity
            agentEns={opponentInfo?.agentEns ?? null}
            portfolio={opponentPortfolio}
            score={opponentScore}
            isWinner={!creatorWinning && !scoresEqual}
          />
          <span className="arena-vs-badge">VS</span>
        </div>

        <div className="arena-scoreboard-tug">
          <div className="arena-tug-bar">
            <div
              className="arena-tug-fill-creator"
              style={{ width: `${creatorBarWidth}%` }}
            />
            <div
              className="arena-tug-fill-opponent"
              style={{ width: `${opponentBarWidth}%` }}
            />
          </div>
        </div>
      </div>

      {statsSyncEvent && (
        <div className="border-b-3 border-black bg-[#fafaf8] px-4 py-2">
          <span className="font-label text-[10px] font-bold uppercase tracking-widest text-artemis-charcoal/60">
            {statsSyncEvent.eventType === "agent_stats.synced"
              ? "Agent ENS stats synced"
              : statsSyncEvent.eventType === "agent_stats.sync_deferred"
                ? "Agent ENS stats queued"
                : "Agent ENS stats syncing"}
          </span>
        </div>
      )}

      <div className="arena-battleground">
        <div
          ref={feedRef}
          className="arena-battleground-col arena-battleground-creator"
        >
          {creatorTrades.length === 0 ? (
            <BattlegroundEmptyState />
          ) : (
            creatorTrades.map(trade => (
              <TradeActionCard key={trade.id} trade={trade} tokenInfoMap={tokenInfoMap} seat="creator" />
            ))
          )}
        </div>
        <div className="arena-battleground-divider" />
        <div className="arena-battleground-col arena-battleground-opponent">
          {opponentTrades.length === 0 ? (
            <BattlegroundEmptyState />
          ) : (
            opponentTrades.map(trade => (
              <TradeActionCard key={trade.id} trade={trade} tokenInfoMap={tokenInfoMap} seat="opponent" />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// PLAYER IDENTITY — score block for one side
// ══════════════════════════════════════════════════════════

function PlayerIdentity({
  agentEns,
  portfolio,
  score,
  isWinner,
  borderRight,
}: {
  agentEns: string | null;
  portfolio: PortfolioView | null;
  score: number;
  isWinner: boolean;
  borderRight?: boolean;
}) {
  return (
    <div
      className={`arena-player-identity ${isWinner ? "is-winner" : ""} ${borderRight ? "border-r-3 border-black" : ""}`}
    >
      <span
        className="font-display font-black tracking-tight text-center text-black"
        style={{ fontSize: "18px" }}
        title={agentEns ?? undefined}
      >
        {agentEns ? firstLabel(agentEns) : "---"}
      </span>
      <span
        className="font-display font-black tabular-nums"
        style={{
          fontSize: portfolio ? "64px" : "48px",
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: score > 0 ? "var(--artemis-red)" : score < 0 ? "var(--artemis-charcoal)" : "var(--artemis-silver)",
        }}
      >
        {portfolio ? `${pnlSign(score)}${(score * 100).toFixed(2)}%` : "---%"}
      </span>
      {portfolio && (
        <span className="font-label text-[12px] font-bold tabular-nums text-artemis-charcoal">
          ${portfolio.currentValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// BATTLEGROUND EMPTY STATE — dashed-border waiting box
// ══════════════════════════════════════════════════════════

function BattlegroundEmptyState() {
  return (
    <div className="arena-battleground-empty">
      <span className="arena-battleground-empty-text">Waiting for agent execution...</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// TRADE ACTION CARD — per-seat brutalist card
// ══════════════════════════════════════════════════════════

function TradeActionCard({
  trade,
  tokenInfoMap,
  seat,
}: {
  trade: EnrichedTrade;
  tokenInfoMap: Map<string, { symbol: string; decimals: number }>;
  seat: "creator" | "opponent";
}) {
  const inInfo = tokenInfoMap.get(trade.tokenIn.toLowerCase());
  const outInfo = tokenInfoMap.get(trade.tokenOut.toLowerCase());
  const inSym = inInfo?.symbol ?? "?";
  const outSym = outInfo?.symbol ?? "?";
  const inDecimals = inInfo?.decimals ?? 18;
  const outDecimals = outInfo?.decimals ?? 18;
  const amountIn = formatAmount(trade.amountIn, inDecimals);
  const amountOut = formatAmount(trade.simulatedAmountOut || trade.quotedAmountOut, outDecimals);
  const sideLabel = (trade.tradeSide ?? "buy").toUpperCase();
  const pnl = trade.realizedPnlUsd;

  return (
    <div className="arena-trade-action-card">
      <div className="arena-trade-action-row-top">
        <span className={`arena-trade-action-side ${seat}`}>{sideLabel}</span>
        <span className="arena-trade-action-asset">{outSym}</span>
        <span className="arena-trade-action-price">
          {trade.outputValueUsd != null ? `$${trade.outputValueUsd.toFixed(2)}` : "---"}
        </span>
      </div>
      <div className="arena-trade-action-row-bottom">
        <span className="arena-trade-action-swap">{amountIn} {inSym} → {amountOut} {outSym}</span>
        {pnl != null && pnl !== 0 && (
          <span className={`arena-trade-action-pnl ${pnlClass(pnl)}`}>
            {pnlSign(pnl)}${Math.abs(pnl).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// NO MATCH VIEW — idle moon, pending invite, or locked
// ══════════════════════════════════════════════════════════

function NoMatchView({
  openInvite,
  readiness,
  onRevoke,
}: {
  openInvite: ArenaSnapshot["openInvite"];
  readiness: ArenaSnapshot["readiness"];
  onRevoke: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (openInvite) {
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`;

    const handleCopy = () => {
      void navigator.clipboard.writeText(inviteUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };

    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 bg-white">
        <span className="font-display text-xl font-black uppercase tracking-tight text-black">Invite Pending</span>
        <div className="flex items-center gap-2">
          <span className="arena-idle-term-chip">${openInvite.wagerUsd}</span>
          <span className="arena-idle-term-chip">{Math.floor(openInvite.durationSeconds / 60)}m</span>
          <span className="arena-idle-term-chip">${openInvite.startingCapitalUsd}</span>
        </div>
        {openInvite.status === "open" && (
          <>
            <button
              type="button"
              onClick={handleCopy}
              className="w-full max-w-md flex items-center gap-3 bg-white rounded-lg px-4 py-3 border-3 border-black shadow-[4px_4px_0_0_var(--artemis-blue)] hover:shadow-[5px_5px_0_0_var(--artemis-blue)] hover:translate-[-1px] transition-all cursor-pointer"
            >
              <span className="text-[12px] font-mono text-artemis-charcoal truncate flex-1 text-left select-all">
                {inviteUrl}
              </span>
              <span className={`text-[11px] font-label font-bold uppercase tracking-wider shrink-0 px-3 py-1 rounded-md border-2 border-black transition-colors ${
                copied
                  ? "bg-artemis-red text-white"
                  : "bg-artemis-red text-white"
              }`}>
                {copied ? "Copied!" : "Copy Link"}
              </span>
            </button>
            <div className="flex items-center gap-3 mt-1">
              <span className="arena-waiting-text">Waiting for opponent...</span>
              <button
                type="button"
                onClick={() => void onRevoke(openInvite.id)}
                className="text-[10px] font-label font-bold uppercase text-artemis-red/50 hover:text-artemis-red transition-colors underline underline-offset-2"
              >
                Revoke
              </button>
            </div>
          </>
        )}
        {openInvite.status !== "open" && (
          <p className="arena-waiting-text">Waiting for opponent...</p>
        )}
      </div>
    );
  }

  if (!readiness.ready) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 bg-white">
        <div className="arena-idle-moon" style={{ width: 120, height: 120, opacity: 0.5 }} />
        <span className="font-display text-lg font-black uppercase tracking-tight text-artemis-charcoal/40">Arena Locked</span>
        <p className="text-[13px] font-body text-artemis-silver">Complete setup to enter matches</p>
        {readiness.blockers.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center">
            {readiness.blockers.map((b, i) => (
              <span key={i} className="arena-blocker-badge">{b}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 bg-white">
      <div className="arena-idle-moon" />
      <span className="font-display text-2xl font-black uppercase tracking-tight text-black">Enter the Arena</span>
      <div className="flex items-center gap-2">
        <span className="arena-idle-term-chip">$10</span>
        <span className="arena-idle-term-chip">5m</span>
        <span className="arena-idle-term-chip">$100</span>
      </div>
      <p className="text-[14px] font-body text-artemis-charcoal/55">Create a match from the main view to start trading</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MINI COMPONENTS
// ══════════════════════════════════════════════════════════

function LiveDot({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`arena-status-dot ${connected ? "arena-status-dot-connected" : "arena-status-dot-disconnected"}`} />
      <span className={`font-label text-[10px] font-bold uppercase tracking-widest ${connected ? "text-artemis-red" : "text-artemis-silver"}`}>
        {connected ? "LIVE" : "OFFLINE"}
      </span>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="inline-block h-2 w-2 rounded-full bg-current opacity-20"
          style={{ animation: "typing-dots 1.4s ease-in-out infinite", animationDelay: `${i * 0.2}s` }} />
      ))}
    </span>
  );
}
