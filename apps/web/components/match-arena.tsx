"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { createClient } from "@/lib/supabase/client";
import type { ArenaSnapshot, EnrichedTrade } from "@/lib/types/arena";
import type { MatchView } from "@/lib/types/match";
import type { PortfolioView } from "@/lib/types/trading";
import { ChallengeModal } from "@/components/challenge-modal";
import type React from "react";

// ─── Number Formatting ───────────────────────────────────

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

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "now";
  if (diff < 60) return `${diff}s`;
  return `${Math.floor(diff / 60)}m`;
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
    case "closing_window": return { label: "CLOSING", active: true, isLive: true };
    case "settling": return { label: "SETTLING", active: false, isLive: false };
    case "settled": return { label: "FINAL", active: false, isLive: false };
    default: return { label: phase.replace(/_/g, " ").toUpperCase(), active: false, isLive: false };
  }
}

// ─── Main Component ──────────────────────────────────────

export function MatchArena() {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [supabase] = useState(() => createClient());
  const feedRef = useRef<HTMLDivElement | null>(null);
  const prevTradeCountRef = useRef(0);

  const [snapshot, setSnapshot] = useState<ArenaSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [snapshotLoadedAt, setSnapshotLoadedAt] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    queueMicrotask(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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

  // Initial load
  useEffect(() => {
    if (!ready || !authenticated) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    queueMicrotask(() => void refreshSnapshot());
  }, [ready, authenticated, refreshSnapshot]);

  // Broadcast channels — agent-level
  useEffect(() => {
    if (!snapshot?.viewer.agentTopic) return;
    const channel = supabase
      .channel(snapshot.viewer.agentTopic)
      .on("broadcast", { event: "match_state_changed" }, () => { void refreshSnapshot(); })
      .on("broadcast", { event: "trade_accepted" }, () => { void refreshSnapshot(); })
      .on("broadcast", { event: "penalty_assessed" }, () => { void refreshSnapshot(); })
      .on("broadcast", { event: "valuation_refreshed" }, () => { void refreshSnapshot(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [snapshot?.viewer.agentTopic, refreshSnapshot, supabase]);

  // Broadcast channels — match-level
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

  // Postgres Changes — real-time row inserts/updates
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

  // Auto-scroll on new trades
  useEffect(() => {
    const count = snapshot?.live?.trades.length ?? 0;
    if (count > prevTradeCountRef.current && feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
    prevTradeCountRef.current = count;
  }, [snapshot?.live?.trades.length]);

  // Fallback poll during live phases
  useEffect(() => {
    if (!snapshot?.live?.match.id) return;
    const phase = snapshot.live.phase;
    const isLive = phase === "warmup" || phase === "opening_window" || phase === "midgame" || phase === "closing_window" || phase === "live";
    if (!isLive) return;

    const id = setInterval(() => { void refreshSnapshot(); }, 5000);
    return () => clearInterval(id);
  }, [snapshot?.live?.match.id, snapshot?.live?.phase, refreshSnapshot]);

  // Invite actions
  const handleCreateInvite = async (opts: { scopeType: "open" | "ens"; scopedEnsName?: string }) => {
    setCreating(true);
    setInviteLink(null);
    setActionError(null);
    try {
      const result = await fetchJson<{ inviteLink: string }>("/api/invites", {
        method: "POST",
        body: JSON.stringify({
          scopeType: opts.scopeType,
          scopedEnsName: opts.scopedEnsName,
        }),
      });
      setInviteLink(result.inviteLink);
      setChallengeOpen(false);
      await refreshSnapshot();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Invite creation failed.");
    } finally {
      setCreating(false);
    }
  };

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

  // ─── Loading / Auth states ─────────────────────────────

  if (!ready || loading) {
    return (
      <ArenaShell>
        <div className="flex items-center gap-4 p-8 text-artemis-charcoal">
          <span className="text-xl font-display font-black uppercase tracking-widest">Syncing arena</span>
          <Dots />
        </div>
      </ArenaShell>
    );
  }

  if (!authenticated) {
    return (
      <ArenaShell>
        <div className="flex flex-col items-center gap-8 p-10">
          <p className="text-xl text-artemis-charcoal text-center max-w-md">
            Connect your Moonjoy account to enter the arena.
          </p>
          <button type="button" onClick={() => void login()} className="neo-btn px-8 py-3.5 text-base">Connect to Enter</button>
        </div>
      </ArenaShell>
    );
  }

  const { viewer, readiness, activeMatch, openInvite, live } = snapshot ?? {
    viewer: { userId: "", agentId: "", userEnsName: "", agentEnsName: "", agentTopic: "" },
    readiness: { hasUser: false, hasAgent: false, hasSmartAccount: false, hasMcpApproval: false, hasUserEns: false, hasAgentEns: false, ready: false, blockers: [] },
    activeMatch: null,
    openInvite: null,
    live: null,
  };

  const snapshotAge = Math.max(0, Math.floor((now - snapshotLoadedAt) / 1000));
  const localRemaining = live ? Math.max(0, live.remainingSeconds - snapshotAge) : 0;
  const localElapsed = live ? live.elapsedSeconds + snapshotAge : 0;

  // Build a combined map: lowercase address → { symbol, decimals }
  const tokenInfoMap = new Map(live?.allowedTokens?.map(t => [t.address.toLowerCase(), { symbol: t.symbol, decimals: t.decimals }]) ?? []);

  // Agent info map
  const agentMap = new Map<string, { agentEns: string; userEns: string; seat: "creator" | "opponent" }>();
  if (activeMatch) {
    agentMap.set(activeMatch.creator.agentId, {
      agentEns: activeMatch.creator.agentEnsName || "Creator Agent",
      userEns: activeMatch.creator.userEnsName || "",
      seat: "creator",
    });
    if (activeMatch.opponent) {
      agentMap.set(activeMatch.opponent.agentId, {
        agentEns: activeMatch.opponent.agentEnsName || "Challenger Agent",
        userEns: activeMatch.opponent.userEnsName || "",
        seat: "opponent",
      });
    }
  }

  const isViewerCreator = activeMatch?.viewerSeat === "creator";

  const creatorPortfolio = live?.creatorPortfolio ?? null;
  const opponentPortfolio = live?.opponentPortfolio ?? null;
  const creatorTrades = (live?.trades ?? []).filter(t => t.seat === "creator" && t.status === "accepted");
  const opponentTrades = (live?.trades ?? []).filter(t => t.seat === "opponent" && t.status === "accepted");

  const creatorInfo = activeMatch?.creator ? agentMap.get(activeMatch.creator.agentId) ?? null : null;
  const opponentInfo = activeMatch?.opponent ? agentMap.get(activeMatch.opponent.agentId) ?? null : null;

  // ─── Render ────────────────────────────────────────────

  return (
    <ArenaShell>
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 border-b-3 border-black bg-white">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-black">Arena</h1>
          <LiveDot connected={connected} />
        </div>
        <div className="flex items-center gap-4">
          {viewer.userEnsName && (
            <span className="font-label text-sm text-artemis-charcoal">{viewer.userEnsName}</span>
          )}
          {viewer.agentEnsName && (
            <span className="arena-role-badge arena-role-badge-creator text-sm !px-3 !py-1">{viewer.agentEnsName}</span>
          )}
        </div>
      </header>

      {/* Readiness blockers */}
      {!readiness.ready && readiness.blockers.length > 0 && (
        <div className="px-8 py-5 border-b-3 border-black bg-neo-bg">
          <span className="text-xs font-label font-bold uppercase tracking-widest text-black block mb-3">Setup Required</span>
          <div className="flex flex-wrap gap-2">
            {readiness.blockers.map((b, i) => (
              <span key={i} className="text-sm font-label text-artemis-charcoal bg-white px-3 py-1.5 rounded-lg border-2 border-black">{b}</span>
            ))}
          </div>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="px-8 py-4 border-b-3 border-black bg-white">
          <div className="flex items-center justify-between">
            <span className="text-sm font-label font-bold text-artemis-red">{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} className="text-xs font-label font-bold text-artemis-red/60 uppercase hover:text-artemis-red transition-colors">Dismiss</button>
          </div>
        </div>
      )}

      {/* ── INVITE SECTION (no active match) ──────────────── */}
      {!activeMatch && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
          {!openInvite && !inviteLink && readiness.ready && (
            <div className="flex flex-col items-center gap-6">
              <div className="text-center">
                <p className="text-3xl font-display font-black uppercase tracking-tight text-black mb-2">Ready to Battle</p>
                <p className="text-base font-body text-artemis-charcoal/60">Launch a challenge or wait for a challenger</p>
              </div>
              <button
                type="button"
                onClick={() => setChallengeOpen(true)}
                className="neo-btn px-10 py-4 text-lg"
                style={{ letterSpacing: "0.12em" }}
              >
                Challenge
              </button>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-label text-xs font-bold uppercase tracking-widest text-artemis-charcoal/40">$10 &middot; 5m &middot; $100</span>
              </div>
            </div>
          )}

          {openInvite && (
            <div className="w-full max-w-lg space-y-4">
              <div className="text-center mb-4">
                <p className="text-2xl font-display font-black uppercase tracking-tight text-black">Invite Active</p>
              </div>
              <div className="flex items-center justify-between bg-white rounded-lg px-5 py-4 border-2 border-black">
                <span className={`text-base font-mono px-3 py-1 rounded-lg border-2 border-black ${openInvite.status === "open" ? "bg-white text-black" : "bg-artemis-blue text-white"}`}>
                  {openInvite.status.toUpperCase()}
                </span>
                <span className="text-base font-label text-artemis-charcoal/55">${openInvite.wagerUsd} wager</span>
              </div>
              <div className="flex items-center gap-3 bg-white rounded-lg px-5 py-3 border-2 border-black">
                <span className="text-base font-label text-artemis-charcoal/80 truncate flex-1">{`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`}</span>
                <button type="button" onClick={() => void navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`)} className="text-sm font-label font-bold text-artemis-red uppercase hover:text-artemis-red-light transition-colors">Copy</button>
              </div>
              {openInvite.status === "open" && (
                <button type="button" onClick={() => void handleRevokeInvite(openInvite.id)} className="w-full neo-btn py-3 text-sm">Revoke Invite</button>
              )}
            </div>
          )}

          {!readiness.ready && (
            <p className="text-lg text-artemis-charcoal/55 text-center max-w-md">Complete setup to create invites</p>
          )}
        </div>
      )}

      {/* ── VS ARENA (active match) ──────────────────────── */}
      {activeMatch && (
        <VsArena
          match={activeMatch}
          live={live}
          localRemaining={localRemaining}
          localElapsed={localElapsed}
          creatorInfo={creatorInfo}
          opponentInfo={opponentInfo}
          creatorPortfolio={creatorPortfolio}
          opponentPortfolio={opponentPortfolio}
          creatorTrades={creatorTrades}
          opponentTrades={opponentTrades}
          tokenInfoMap={tokenInfoMap}
          isViewerCreator={isViewerCreator}
          mandatoryWindowResults={live?.mandatoryWindowResults ?? []}
          feedRef={feedRef}
        />
      )}

      <ChallengeModal
        open={challengeOpen}
        onClose={() => setChallengeOpen(false)}
        onSubmit={handleCreateInvite}
        loading={creating}
        error={actionError}
      />
    </ArenaShell>
  );
}

// ════════════════════════════════════════════════════════════
// VS ARENA LAYOUT — full page version
// ════════════════════════════════════════════════════════════

function VsArena({
  match,
  live,
  localRemaining,
  localElapsed,
  creatorInfo,
  opponentInfo,
  creatorPortfolio,
  opponentPortfolio,
  creatorTrades,
  opponentTrades,
  tokenInfoMap,
  isViewerCreator,
  mandatoryWindowResults,
  feedRef,
}: {
  match: MatchView;
  live: ArenaSnapshot["live"];
  localRemaining: number;
  localElapsed: number;
  creatorInfo: { agentEns: string; userEns: string; seat: "creator" | "opponent" } | null;
  opponentInfo: { agentEns: string; userEns: string; seat: "creator" | "opponent" } | null;
  creatorPortfolio: PortfolioView | null;
  opponentPortfolio: PortfolioView | null;
  creatorTrades: EnrichedTrade[];
  opponentTrades: EnrichedTrade[];
  tokenInfoMap: Map<string, { symbol: string; decimals: number }>;
  isViewerCreator: boolean;
  mandatoryWindowResults: NonNullable<ArenaSnapshot["live"]>["mandatoryWindowResults"];
  feedRef: React.RefObject<HTMLDivElement | null>;
}) {
  const phase = live?.phase ?? match.status;
  const { label: phaseLabel, active: phaseActive, isLive } = phaseInfo(phase);

  const creatorScore = creatorPortfolio?.netScorePercent ?? 0;
  const opponentScore = opponentPortfolio?.netScorePercent ?? 0;
  const creatorWinning = creatorScore > opponentScore;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ═══ HEADER BAR — phase, VS titles, timer ═══ */}
      <div className="arena-header-bar" style={{ padding: "14px 24px" }}>
        <span className={`arena-phase-tag ${phaseActive && isLive ? "live" : ""}`} style={{ fontSize: "13px", padding: "5px 18px" }}>{phaseLabel}</span>

        <div className="flex items-center gap-3">
          <span className={`font-display font-black tracking-tight truncate max-w-[160px] ${isViewerCreator ? "text-artemis-red" : "text-black"}`} style={{ fontSize: "16px" }} title={creatorInfo?.agentEns}>
            {creatorInfo?.agentEns ?? "---"}
          </span>
          <span className="font-display text-2xl font-black tracking-tight text-artemis-charcoal">VS</span>
          <span className={`font-display font-black tracking-tight truncate max-w-[160px] ${!isViewerCreator ? "text-artemis-red" : "text-black"}`} style={{ fontSize: "16px" }} title={opponentInfo?.agentEns}>
            {opponentInfo?.agentEns ?? "---"}
          </span>
        </div>

        {phaseActive ? (
          <div className="arena-timer-block">
            <span className={`arena-timer-count ${localRemaining <= 30 ? "urgent" : ""}`} style={{ fontSize: "48px" }}>{fmtMmSs(localRemaining)}</span>
            <span className="arena-timer-label" style={{ fontSize: "11px", marginLeft: "8px" }}>remaining</span>
          </div>
        ) : (
          <span className={`arena-result-text ${creatorWinning ? "creator-wins" : "challenger-wins"}`} style={{ fontSize: "18px" }}>
            {creatorWinning ? "Creator Wins" : "Challenger Wins"}
          </span>
        )}
      </div>

      {/* ═══ VS SPLIT — wider columns for full page ═══ */}
      <div className="arena-vs-grid" style={{ gridTemplateColumns: "1fr 56px 1fr" }}>
        {/* LEFT — Creator */}
        <PlayerSideFull
          isViewerSide={isViewerCreator}
          portfolio={creatorPortfolio}
          trades={creatorTrades}
          tokenInfoMap={tokenInfoMap}
          isLeading={creatorWinning}
          isSettled={!phaseActive}
          feedRef={feedRef}
        />

        {/* CENTER — Divider, margin when settled */}
        <div className="arena-vs-divider" style={{ paddingTop: "28px" }}>
          {!phaseActive && (
            <div className="mt-4 mb-2 text-center">
              <span className={`font-label font-bold tabular-nums ${pnlClass(creatorScore - opponentScore) === "positive" ? "text-artemis-red" : pnlClass(creatorScore - opponentScore) === "negative" ? "text-artemis-charcoal" : "text-artemis-silver"}`} style={{ fontSize: "13px" }}>
                {pnlSign(creatorScore - opponentScore)}{((creatorScore - opponentScore) * 100).toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {/* RIGHT — Opponent */}
        <PlayerSideFull
          isViewerSide={!isViewerCreator}
          portfolio={opponentPortfolio}
          trades={opponentTrades}
          tokenInfoMap={tokenInfoMap}
          isLeading={!creatorWinning}
          isSettled={!phaseActive}
          feedRef={feedRef}
        />
      </div>

      {/* ═══ Footer bar ═══ */}
      <footer className="arena-footer-bar" style={{ padding: "10px 24px" }}>
        <div className="flex items-center gap-4">
          {!phaseActive && (
            <span className="text-xs font-label font-bold uppercase tracking-wider text-artemis-charcoal">
              ${match.wagerUsd.toFixed(0)} &middot; ${match.startingCapitalUsd.toFixed(0)} capital
            </span>
          )}
          {phaseActive && (
            <span className="text-xs font-label text-artemis-silver tabular-nums hidden sm:block">
              {fmtMmSs(localElapsed)} elapsed
            </span>
          )}
        </div>

        {mandatoryWindowResults.length > 0 && (
          <div className="flex items-center gap-2">
            {mandatoryWindowResults.map((w: { completed: boolean; penaltyUsd: number; windowName: string }, i: number) => (
              <span key={i} className={`arena-window-pill ${w.completed ? "done" : "missed"}`}>
                {w.windowName === "opening_window" ? "OPEN" : "CLOSE"} {w.completed ? "✓" : `-$${w.penaltyUsd.toFixed(2)}`}
              </span>
            ))}
          </div>
        )}
      </footer>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// PLAYER SIDE (full page version)
// ════════════════════════════════════════════════════════════

function PlayerSideFull({
  isViewerSide,
  portfolio,
  trades,
  tokenInfoMap,
  isLeading,
  isSettled,
  feedRef,
}: {
  isViewerSide: boolean;
  portfolio: PortfolioView | null;
  trades: EnrichedTrade[];
  tokenInfoMap: Map<string, { symbol: string; decimals: number }>;
  isLeading: boolean;
  isSettled: boolean;
  feedRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isYourSide = isViewerSide;

  return (
    <div className={`arena-player-col ${isYourSide ? "is-viewer" : ""}`}>
      {/* Identity header — removed: VS info lives in top bar */}
      {/* SCORE — hero element */}
      <div className="arena-score-block" style={{ padding: "20px" }}>
        {portfolio ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="arena-score-label" style={{ fontSize: "10px" }}>Net Score</span>
              {isSettled && isLeading && (
                <span className="arena-status-badge lead" style={{ fontSize: "9px", padding: "2px 10px" }}>LEADING</span>
              )}
              {!isSettled && portfolio.netScorePercent > 0 && (
                <span className="arena-status-badge up" style={{ fontSize: "9px", padding: "2px 10px" }}>UP</span>
              )}
            </div>
            <div className="flex items-baseline gap-3">
              {portfolio.balances.some(b => b.symbol !== "USDC") && (
                <div className="flex flex-wrap gap-1">
                  {portfolio.balances.filter(b => b.symbol !== "USDC").map((b) => (
                    <span key={b.tokenAddress} className="inline-flex items-center font-label px-1.5 py-0.5 rounded border-2 border-black/20 bg-white text-artemis-charcoal" style={{ fontSize: "10px" }}>
                      {b.symbol}
                    </span>
                  ))}
                </div>
              )}
              <span className={`arena-score-value ${pnlClass(portfolio.netScorePercent)}`}
                style={{ fontSize: Math.abs(portfolio.netScorePercent) >= 0.01 ? "52px" : "38px" }}
              >
                {pnlSign(portfolio.netScorePercent)}{(portfolio.netScorePercent * 100).toFixed(2)}%
              </span>
            </div>
            <div className="arena-score-row" style={{ marginTop: "10px", gap: "16px" }}>
              <span className="arena-score-current" style={{ fontSize: "18px" }}>
                ${portfolio.currentValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`arena-score-pnl ${pnlClass(portfolio.totalPnlUsd)}`} style={{ fontSize: "15px" }}>
                {pnlSign(portfolio.totalPnlUsd)}${Math.abs(portfolio.totalPnlUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            {portfolio.penaltiesUsd > 0 && (
              <span className="arena-penalty-tag" style={{ marginTop: "10px", fontSize: "13px" }}>-${portfolio.penaltiesUsd.toFixed(2)} penalties</span>
            )}
          </>
        ) : (
          <>
            <span className="arena-score-label">Net Score</span>
            <span className="arena-score-value neutral" style={{ fontSize: "42px" }}>---%</span>
            <span className="arena-pilot-line mt-2 block">Valuing...</span>
          </>
        )}
      </div>

      {/* Trade activity feed */}
      <div ref={isViewerSide ? feedRef : undefined} className="arena-trade-feed">
        {trades.length === 0 ? (
          <div className="arena-trade-empty">
            <span className="arena-trade-empty-title" style={{ fontSize: "15px" }}>No Trades Yet</span>
            <span className="arena-trade-empty-sub" style={{ fontSize: "13px" }}>Waiting for action...</span>
          </div>
        ) : (
          <div className="py-2">
            {trades.map((trade) => {
              const inInfo = tokenInfoMap.get(trade.tokenIn.toLowerCase());
              const outInfo = tokenInfoMap.get(trade.tokenOut.toLowerCase());
              const inSym = inInfo?.symbol ?? "?";
              const outSym = outInfo?.symbol ?? "?";
              const inDecimals = inInfo?.decimals ?? 18;
              const outDecimals = outInfo?.decimals ?? 18;
              const amountIn = formatAmount(trade.amountIn, inDecimals);
              const amountOut = formatAmount(trade.simulatedAmountOut || trade.quotedAmountOut, outDecimals);
              const sideLabel = (trade.tradeSide ?? "buy").toUpperCase();

              return (
                <div key={trade.id} className={`arena-trade-card ${isYourSide ? "is-viewer" : ""}`} style={{ margin: "8px 14px", padding: "12px 14px" }}>
                  <div className="arena-trade-header" style={{ marginBottom: "8px" }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`arena-trade-side-badge ${
                        sideLabel === "BUY" ? "buy" :
                        sideLabel === "SELL" ? "sell" :
                        "exit"
                      }`} style={{ fontSize: "10px", padding: "3px 8px" }}>{sideLabel}</span>
                      <div className="arena-trade-amounts">
                        <span className="arena-trade-amount" style={{ fontSize: "13px" }}>{amountIn}</span>
                        <span className="arena-trade-amount-symbol" style={{ fontSize: "11px" }}>{inSym}</span>
                        <span className="arena-trade-arrow" style={{ fontSize: "13px" }}>&rsaquo;</span>
                        <span className="arena-trade-amount-out" style={{ fontSize: "13px" }}>{amountOut}</span>
                        <span className="arena-trade-amount-symbol" style={{ fontSize: "11px" }}>{outSym}</span>
                      </div>
                    </div>
                    <span className="arena-trade-time" style={{ fontSize: "10px" }}>{timeAgo(trade.acceptedAt)}</span>
                  </div>
                  {trade.status === "accepted" && trade.realizedPnlUsd != null && trade.realizedPnlUsd !== 0 && (
                    <span className={`arena-trade-pnl ${pnlClass(trade.realizedPnlUsd)}`} style={{ fontSize: "13px", padding: "4px 10px", marginTop: "8px" }}>
                      {pnlSign(trade.realizedPnlUsd)}${Math.abs(trade.realizedPnlUsd).toFixed(2)}
                    </span>
                  )}
                  {trade.status === "rejected" && trade.failureReason && (
                    <span className="arena-trade-reject" style={{ fontSize: "11px", marginTop: "8px" }}>{trade.failureReason}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// SHELL & UTILITIES
// ════════════════════════════════════════════════════════════

function ArenaShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] flex-1 items-center justify-center bg-surface px-4 py-8">
      <section className="neo-panel flex w-full max-w-7xl flex-col overflow-hidden lg:h-[88vh]" style={{ minHeight: "80dvh" }}>
        {children}
      </section>
    </main>
  );
}

function LiveDot({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`arena-status-dot ${connected ? "arena-status-dot-connected" : "arena-status-dot-disconnected"}`} />
      <span className="font-label text-xs font-bold uppercase tracking-widest text-artemis-charcoal/60">
        {connected ? "LIVE" : "OFFLINE"}
      </span>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="inline-block h-2 w-2 rounded-full bg-current opacity-20" style={{ animation: "typing-dots 1.4s ease-in-out infinite", animationDelay: `${i * 0.2}s` }} />
      ))}
    </span>
  );
}
