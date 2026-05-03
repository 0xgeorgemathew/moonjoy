"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { createClient } from "@/lib/supabase/client";
import type { ArenaSnapshot, EnrichedTrade } from "@/lib/types/arena";
import type { MatchView } from "@/lib/types/match";
import type { PortfolioView } from "@/lib/types/trading";

// ─── Types ──────────────────────────────────────

type MatchCreationContext = {
  readiness: {
    ready: boolean;
    blockers: string[];
  };
  ensPreference: {
    parsed: {
      durationSeconds: number | null;
      wagerUsd: number | null;
      capitalUsd: { min: number | null; max: number | null };
    };
    warnings: string[];
  } | null;
  suggestedTerms: {
    wagerUsd: number;
    durationSeconds: number;
    startingCapitalUsd: number;
    warmupSeconds: number;
  };
  requiredInputs: string[];
  constraints: {
    scopeTypes: readonly string[];
    wagerUsd: readonly number[];
    durationSeconds: readonly number[];
    startingCapitalUsd: readonly number[];
    warmupSeconds: readonly number[];
  };
  openInvite: {
    id: string;
    inviteToken: string;
    status: string;
    wagerUsd: number;
    durationSeconds: number;
    startingCapitalUsd: number;
    scopeType: string;
    scopedEnsName: string | null;
  } | null;
  arenaPath: string;
};

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

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "now";
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

function shortAddr(address: string | undefined): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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

function formatPreferenceSummary(preference: NonNullable<MatchCreationContext["ensPreference"]>): string {
  const duration = preference.parsed.durationSeconds
    ? `${Math.floor(preference.parsed.durationSeconds / 60)}m`
    : "any duration";
  const wager = preference.parsed.wagerUsd ? `$${preference.parsed.wagerUsd}` : "any wager";
  const minCapital = preference.parsed.capitalUsd.min;
  const maxCapital = preference.parsed.capitalUsd.max;
  const capital =
    minCapital && maxCapital
      ? `$${minCapital}-$${maxCapital} capital`
      : minCapital
        ? `$${minCapital}+ capital`
        : maxCapital
          ? `up to $${maxCapital} capital`
          : "any capital";

  return `${wager} · ${capital} · ${duration}`;
}

// ─── Main Component ──────────────────────────────

export function ArenaPanel() {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [supabase] = useState(() => createClient());
  const feedRef = useRef<HTMLDivElement>(null);
  const prevTradeCountRef = useRef(0);

  const [snapshot, setSnapshot] = useState<ArenaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Create-match form state
  const [creationCtx, setCreationCtx] = useState<MatchCreationContext | null>(null);
  const [inviteScope, setInviteScope] = useState<"open" | "ens">("open");
  const [inviteEnsName, setInviteEnsName] = useState("");
  const [wagerUsd, setWagerUsd] = useState<number>(10);
  const [durationSeconds, setDurationSeconds] = useState<number>(300);
  const [startingCapitalUsd, setStartingCapitalUsd] = useState<number>(100);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
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
      .on("broadcast", { event: "invite_joined" }, () => { void refreshSnapshot(); })
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

  // Fetch creation context alongside snapshot
  useEffect(() => {
    if (!ready || !authenticated) return;
    queueMicrotask(async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/matches/create", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const ctx = await res.json() as MatchCreationContext;
          setCreationCtx(ctx);
          setWagerUsd(ctx.suggestedTerms.wagerUsd);
          setDurationSeconds(ctx.suggestedTerms.durationSeconds);
          setStartingCapitalUsd(ctx.suggestedTerms.startingCapitalUsd);
        }
      } catch {
        // non-critical
      }
    });
  }, [ready, authenticated, getAccessToken]);

  const handleCreateInvite = async () => {
    setCreating(true);
    setInviteLink(null);
    setActionError(null);
    try {
      const result = await fetchJson<{ inviteLink: string; inviteToken: string }>("/api/matches", {
        method: "POST",
        body: JSON.stringify({
          scopeType: inviteScope,
          scopedEnsName: inviteScope === "ens" ? inviteEnsName : undefined,
          wagerUsd,
          durationSeconds,
          startingCapitalUsd,
        }),
      });
      setInviteLink(result.inviteLink);
      await refreshSnapshot();
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/matches/create", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setCreationCtx(await res.json() as MatchCreationContext);
        }
      } catch { /* non-critical */ }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Match creation failed.");
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

  const { viewer, readiness, activeMatch, openInvite, live } = snapshot ?? {
    viewer: { userId: "", agentId: "", userEnsName: "", agentEnsName: "", agentTopic: "" },
    readiness: { hasUser: false, hasAgent: false, hasSmartAccount: false, hasMcpApproval: false, hasUserEns: false, hasAgentEns: false, ready: false, blockers: [] },
    activeMatch: null,
    openInvite: null,
    live: null,
  };

  const snapshotAge = Math.max(0, Math.floor((now - snapshotLoadedAt) / 1000));
  const localRemaining = live ? Math.max(0, live.remainingSeconds - snapshotAge) : 0;

  // Combined token info map: address → { symbol, decimals }
  const tokenInfoMap = new Map(live?.allowedTokens?.map(t => [t.address.toLowerCase(), { symbol: t.symbol, decimals: t.decimals }]) ?? []);

  // Agent info map with addresses
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

  const isViewerCreator = activeMatch?.viewerSeat === "creator";

  const creatorPortfolio = live?.creatorPortfolio ?? null;
  const opponentPortfolio = live?.opponentPortfolio ?? null;
  const creatorTrades = (live?.trades ?? []).filter(t => t.seat === "creator" && t.status === "accepted");
  const opponentTrades = (live?.trades ?? []).filter(t => t.seat === "opponent" && t.status === "accepted");

  const creatorInfo = activeMatch?.creator ? agentMap.get(activeMatch.creator.agentId) ?? null : null;
  const opponentInfo = activeMatch?.opponent ? agentMap.get(activeMatch.opponent.agentId) ?? null : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#fafaf8]">
      {/* ═══ HEADER STRIP ═══ */}
      <header className="flex items-center justify-between px-5 py-3 border-b-3 border-black bg-white">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-lg font-black uppercase tracking-tight text-black">Match</h1>
          <LiveDot connected={connected} />
          {snapshot && (
            <span className="text-[11px] font-mono font-bold tabular-nums text-artemis-silver">
              {snapshotAge < 5 ? "● live" : snapshotAge < 30 ? `· ${snapshotAge}s ago` : `· ${snapshotAge}s`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {viewer.userEnsName && (
            <span className="font-label text-[13px] text-artemis-charcoal/70">{viewer.userEnsName}</span>
          )}
          {viewer.agentEnsName && (
            <span className="arena-role-badge arena-role-badge-creator text-[11px] !px-3 !py-1">{viewer.agentEnsName}</span>
          )}
        </div>
      </header>

      {/* Readiness blockers */}
      {!readiness.ready && readiness.blockers.length > 0 && (
        <div className="px-5 py-4 border-b-3 border-black bg-[#fff5e6]">
          <span className="text-[11px] font-label font-bold uppercase tracking-widest text-black block mb-2">Setup Required</span>
          <div className="flex flex-wrap gap-2">
            {readiness.blockers.map((b, i) => (
              <span key={i} className="text-[12px] font-label text-artemis-charcoal bg-white px-3 py-1.5 rounded-lg border-2 border-black">{b}</span>
            ))}
          </div>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="px-5 py-3 border-b-3 border-black bg-artemis-red/10">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-label font-bold text-artemis-red">{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} className="text-[10px] font-label font-bold uppercase text-artemis-red/60 hover:text-artemis-red transition-colors">Dismiss</button>
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT — match view only ═══ */}
      {activeMatch ? (
        <div className="flex-1 min-w-0 min-h-0">
          <MatchView
            match={activeMatch}
            live={live}
            localRemaining={localRemaining}
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
            snapshotAge={snapshotAge}
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 bg-white">
          {openInvite ? (
            <div className="max-w-md text-center space-y-3">
              <span className="font-display text-xl font-black uppercase tracking-tight text-black">Invite Pending</span>
              <div className="flex items-center gap-2 bg-white rounded-lg px-4 py-2.5 border-2 border-black mx-auto w-fit">
                <span className={`text-[11px] font-mono px-2 py-1 rounded border-2 border-black ${openInvite.status === "open" ? "bg-white text-black" : "bg-artemis-blue text-white"}`}>
                  {openInvite.status.toUpperCase()}
                </span>
                <span className="text-[12px] font-label text-artemis-charcoal">${openInvite.wagerUsd} wager</span>
              </div>
              {openInvite.status === "open" && (
                <div className="flex flex-col items-center gap-2 mt-2">
                  <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2.5 border-2 border-black w-full max-w-sm">
                    <span className="text-[11px] font-mono text-artemis-charcoal truncate flex-1 text-left">{`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`}</span>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`)}
                      className="text-[10px] font-label font-bold text-artemis-red uppercase hover:text-artemis-red-light transition-colors shrink-0"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="text-[12px] font-body text-artemis-charcoal/50">Share this link with your opponent</p>
                </div>
              )}
              <p className="text-[13px] font-body text-artemis-charcoal/60">Waiting for opponent to join...</p>
            </div>
          ) : readiness.ready ? (
            <div className="max-w-md text-center space-y-3">
              <span className="font-display text-2xl font-black uppercase tracking-tight text-black">No Active Match</span>
              <p className="text-[14px] font-body text-artemis-charcoal/55">Create a match from the main view to start trading</p>
            </div>
          ) : (
            <div className="max-w-sm text-center space-y-2">
              <span className="font-display text-lg font-black uppercase tracking-tight text-artemis-charcoal/40">Arena Locked</span>
              <p className="text-[13px] font-body text-artemis-silver">Complete setup to enter matches</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MATCH VIEW — distinct section inside the same dialog
// ══════════════════════════════════════════════════════════

function MatchView({
  match,
  live,
  localRemaining,
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
  snapshotAge,
}: {
  match: MatchView;
  live: ArenaSnapshot["live"];
  localRemaining: number;
  creatorInfo: { agentEns: string; userEns: string; seat: "creator" | "opponent"; address: string } | null;
  opponentInfo: { agentEns: string; userEns: string; seat: "creator" | "opponent"; address: string } | null;
  creatorPortfolio: PortfolioView | null;
  opponentPortfolio: PortfolioView | null;
  creatorTrades: EnrichedTrade[];
  opponentTrades: EnrichedTrade[];
  tokenInfoMap: Map<string, { symbol: string; decimals: number }>;
  isViewerCreator: boolean;
  mandatoryWindowResults: NonNullable<ArenaSnapshot["live"]>["mandatoryWindowResults"];
  feedRef: React.RefObject<HTMLDivElement | null>;
  snapshotAge: number;
}) {
  const phase = live?.phase ?? match.status;
  const { label: phaseLabel, active: phaseActive, isLive } = phaseInfo(phase);

  const creatorScore = creatorPortfolio?.netScorePercent ?? 0;
  const opponentScore = opponentPortfolio?.netScorePercent ?? 0;
  const creatorWinning = creatorScore > opponentScore;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ═══ MATCH HEADER — phase, VS identities, timer ═══ */}
      <div className="flex items-center justify-between px-5 py-3 border-b-3 border-black bg-white">
        <div className="flex items-center gap-3">
          <span className={`arena-phase-tag ${phaseActive && isLive ? "live" : ""}`} style={{ fontSize: "12px", padding: "5px 16px" }}>{phaseLabel}</span>

          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <span className={`font-display font-black tracking-tight truncate max-w-[140px] ${isViewerCreator ? "text-artemis-red" : "text-black"}`}
                style={{ fontSize: "15px" }}
                title={creatorInfo?.agentEns}>
                {creatorInfo?.agentEns ?? "---"}
              </span>
              {creatorInfo?.address && (
                <span className="font-mono text-[10px] text-artemis-silver truncate max-w-[140px]" title={creatorInfo.address}>
                  {shortAddr(creatorInfo.address)}
                </span>
              )}
            </div>

            <span className="font-display text-xl font-black tracking-tight text-artemis-charcoal/40">VS</span>

            <div className="flex flex-col">
              <span className={`font-display font-black tracking-tight truncate max-w-[140px] ${!isViewerCreator ? "text-artemis-red" : "text-black"}`}
                style={{ fontSize: "15px" }}
                title={opponentInfo?.agentEns}>
                {opponentInfo?.agentEns ?? "---"}
              </span>
              {opponentInfo?.address && (
                <span className="font-mono text-[10px] text-artemis-silver truncate max-w-[140px]" title={opponentInfo.address}>
                  {shortAddr(opponentInfo.address)}
                </span>
              )}
            </div>
          </div>
        </div>

        {phaseActive ? (
          <div className="flex items-baseline gap-2">
            <span className={`arena-timer-count ${localRemaining <= 30 ? "urgent" : ""}`}
              style={{ fontSize: "42px" }}>{fmtMmSs(localRemaining)}</span>
            <span className="arena-timer-label" style={{ fontSize: "11px" }}>remaining</span>
            <span className="text-[10px] font-mono text-artemis-silver/50 tabular-nums ml-2">
              elapsed {fmtMmSs(live ? live.elapsedSeconds + snapshotAge : 0)}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className={`arena-result-text ${creatorWinning ? "creator-wins" : "challenger-wins"}`}
              style={{ fontSize: "16px" }}>
              {creatorWinning ? "Creator Wins" : "Challenger Wins"}
            </span>
            <span className={`text-[13px] font-label font-bold tabular-nums ${pnlClass(creatorScore - opponentScore) === "positive" ? "text-artemis-red" : pnlClass(creatorScore - opponentScore) === "negative" ? "text-artemis-charcoal" : "text-artemis-silver"}`}>
              {pnlSign(creatorScore - opponentScore)}{((creatorScore - opponentScore) * 100).toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {/* ═══ VS SPLIT — unified player columns ═══ */}
      <div className="arena-vs-grid" style={{ gridTemplateColumns: "1fr 52px 1fr" }}>
        <PlayerColumn
          isViewerSide={isViewerCreator}
          portfolio={creatorPortfolio}
          trades={creatorTrades}
          tokenInfoMap={tokenInfoMap}
          isLeading={creatorWinning}
          isSettled={!phaseActive}
          feedRef={feedRef}
          info={creatorInfo}
        />

        <div className="arena-vs-divider" style={{ paddingTop: "20px" }}>
          {!phaseActive && (
            <div className="mt-3 mb-2 text-center">
              <span className={`text-[12px] font-label font-bold tabular-nums ${pnlClass(creatorScore - opponentScore) === "positive" ? "text-artemis-red" : pnlClass(creatorScore - opponentScore) === "negative" ? "text-artemis-charcoal" : "text-artemis-silver"}`}>
                {pnlSign(creatorScore - opponentScore)}{((creatorScore - opponentScore) * 100).toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        <PlayerColumn
          isViewerSide={!isViewerCreator}
          portfolio={opponentPortfolio}
          trades={opponentTrades}
          tokenInfoMap={tokenInfoMap}
          isLeading={!creatorWinning}
          isSettled={!phaseActive}
          feedRef={feedRef}
          info={opponentInfo}
        />
      </div>

      {/* ═══ Footer bar ═══ */}
      <footer className="arena-footer-bar" style={{ padding: "10px 16px" }}>
        <div className="flex items-center gap-3">
          {!phaseActive && (
            <span className="text-[11px] font-label font-bold uppercase tracking-wider text-artemis-charcoal">
              ${match.wagerUsd.toFixed(0)} &middot; ${match.startingCapitalUsd.toFixed(0)} capital
            </span>
          )}
          {phaseActive && (
            <span className="text-[11px] font-label text-artemis-silver tabular-nums hidden sm:block">
              {fmtMmSs(live ? live.elapsedSeconds + snapshotAge : 0)} elapsed
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

// ══════════════════════════════════════════════════════════
// PLAYER COLUMN — merged identity + score + holdings + trades
// ══════════════════════════════════════════════════════════

function PlayerColumn({
  isViewerSide,
  portfolio,
  trades,
  tokenInfoMap,
  isLeading,
  isSettled,
  feedRef,
  info,
}: {
  isViewerSide: boolean;
  portfolio: PortfolioView | null;
  trades: EnrichedTrade[];
  tokenInfoMap: Map<string, { symbol: string; decimals: number }>;
  isLeading: boolean;
  isSettled: boolean;
  feedRef: React.RefObject<HTMLDivElement | null>;
  info: { agentEns: string; userEns: string; seat: "creator" | "opponent"; address: string } | null;
}) {
  const isYourSide = isViewerSide;

  return (
    <div className={`arena-player-col ${isYourSide ? "is-viewer" : ""}`}>
      {/* ═══ Identity + Address ═══ */}
      <div className="px-4 py-3 border-b-2 border-black/20 bg-white">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className={`font-display font-black truncate block ${isYourSide ? "text-artemis-red" : "text-black"}`}
              style={{ fontSize: "15px" }}>
              {info?.agentEns ?? "---"}
            </span>
            {info?.address && (
              <span className="font-mono text-[11px] text-artemis-charcoal/50 block mt-0.5" title={info.address}>
                {info.address}
              </span>
            )}
          </div>
          {isYourSide && (
            <span className="arena-you-chip shrink-0">YOU</span>
          )}
        </div>
      </div>

      {/* ═══ Score Block — hero numbers ═══ */}
      <div className="arena-score-block" style={{ padding: "14px 16px" }}>
        {portfolio ? (
          <>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="arena-score-label" style={{ fontSize: "11px" }}>Net Score</span>
              {isSettled && isLeading && (
                <span className="arena-status-badge lead" style={{ fontSize: "10px", padding: "2px 10px" }}>LEADING</span>
              )}
              {!isSettled && portfolio.netScorePercent > 0 && (
                <span className="arena-status-badge up" style={{ fontSize: "10px", padding: "2px 10px" }}>UP</span>
              )}
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              {portfolio.balances.some(b => b.symbol !== "USDC") && (
                <div className="flex flex-wrap gap-1">
                  {portfolio.balances.filter(b => b.symbol !== "USDC").map((b) => (
                    <span key={b.tokenAddress}
                      className="inline-flex items-center font-label px-2 py-0.5 rounded border-2 text-[11px] border-black/20 bg-white text-artemis-charcoal">
                      {b.symbol}
                      <span className="text-[9px] text-artemis-silver ml-0.5">${b.valueUsd.toFixed(0)}</span>
                    </span>
                  ))}
                </div>
              )}
              <span className={`arena-score-value ${pnlClass(portfolio.netScorePercent)}`}
                style={{ fontSize: Math.abs(portfolio.netScorePercent) >= 0.01 ? "44px" : "34px" }}>
                {pnlSign(portfolio.netScorePercent)}{(portfolio.netScorePercent * 100).toFixed(2)}%
              </span>
            </div>
            <div className="arena-score-row" style={{ marginTop: "10px", gap: "14px" }}>
              <span className="arena-score-current" style={{ fontSize: "17px" }}>
                ${portfolio.currentValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`arena-score-pnl ${pnlClass(portfolio.totalPnlUsd)}`} style={{ fontSize: "15px" }}>
                {pnlSign(portfolio.totalPnlUsd)}${Math.abs(portfolio.totalPnlUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            {portfolio.penaltiesUsd > 0 && (
              <span className="arena-penalty-tag" style={{ marginTop: "8px", fontSize: "12px" }}>-${portfolio.penaltiesUsd.toFixed(2)} penalties</span>
            )}
          </>
        ) : (
          <>
            <span className="arena-score-label">Net Score</span>
            <span className="arena-score-value neutral" style={{ fontSize: "38px" }}>---%</span>
            <span className="arena-pilot-line mt-2 block" style={{ fontSize: "12px" }}>Valuing...</span>
          </>
        )}
      </div>

      {/* ═══ Trade Activity Feed ═══ */}
      <div ref={isViewerSide ? feedRef : undefined} className="arena-trade-feed">
        {trades.length === 0 ? (
          <div className="arena-trade-empty">
            <span className="arena-trade-empty-title" style={{ fontSize: "14px" }}>No Trades Yet</span>
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
                <div key={trade.id} className={`arena-trade-card ${isYourSide ? "is-viewer" : ""}`}
                  style={{ margin: "7px 12px", padding: "12px 14px" }}>
                  <div className="arena-trade-header" style={{ marginBottom: "8px" }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`arena-trade-side-badge ${
                        sideLabel === "BUY" ? "buy" :
                        sideLabel === "SELL" ? "sell" :
                        "exit"
                      }`} style={{ fontSize: "10px", padding: "3px 9px" }}>{sideLabel}</span>
                      <div className="arena-trade-amounts">
                        <span className="arena-trade-amount" style={{ fontSize: "14px" }}>{amountIn}</span>
                        <span className="arena-trade-amount-symbol" style={{ fontSize: "12px" }}>{inSym}</span>
                        <span className="arena-trade-arrow" style={{ fontSize: "14px" }}>&rsaquo;</span>
                        <span className="arena-trade-amount-out" style={{ fontSize: "14px" }}>{amountOut}</span>
                        <span className="arena-trade-amount-symbol" style={{ fontSize: "12px" }}>{outSym}</span>
                      </div>
                    </div>
                    <span className="arena-trade-time" style={{ fontSize: "10px" }}>{timeAgo(trade.acceptedAt)}</span>
                  </div>
                  {trade.status === "accepted" && trade.realizedPnlUsd != null && trade.realizedPnlUsd !== 0 && (
                    <span className={`arena-trade-pnl ${pnlClass(trade.realizedPnlUsd)}`}
                      style={{ fontSize: "13px", padding: "4px 10px", marginTop: "8px" }}>
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

// ══════════════════════════════════════════════════════════
// CREATE MATCH FORM — clean white neo-brutalist
// ══════════════════════════════════════════════════════════

function CreateMatchForm({
  creating,
  creationCtx,
  inviteScope,
  setInviteScope,
  inviteEnsName,
  setInviteEnsName,
  wagerUsd,
  setWagerUsd,
  durationSeconds,
  setDurationSeconds,
  startingCapitalUsd,
  setStartingCapitalUsd,
  inviteLink,
  onCreate,
  openInvite,
  onRevoke,
  readinessReady,
  compact = false,
}: {
  creating: boolean;
  creationCtx: MatchCreationContext | null;
  inviteScope: "open" | "ens";
  setInviteScope: (v: "open" | "ens") => void;
  inviteEnsName: string;
  setInviteEnsName: (v: string) => void;
  wagerUsd: number;
  setWagerUsd: (v: number) => void;
  durationSeconds: number;
  setDurationSeconds: (v: number) => void;
  startingCapitalUsd: number;
  setStartingCapitalUsd: (v: number) => void;
  inviteLink: string | null;
  onCreate: () => void;
  openInvite: ArenaSnapshot["openInvite"];
  onRevoke: (id: string) => void;
  readinessReady: boolean;
  compact?: boolean;
}) {
  const constraints = creationCtx?.constraints ?? {
    wagerUsd: [10],
    durationSeconds: [180, 300, 600],
    startingCapitalUsd: [100, 250, 500],
    warmupSeconds: [30],
    scopeTypes: ["open", "ens"],
  };

  function fmtDuration(s: number): string {
    const m = Math.floor(s / 60);
    return m < 2 ? `${s}s` : `${m}m`;
  }

  const preferenceSummary = creationCtx?.ensPreference
    ? formatPreferenceSummary(creationCtx.ensPreference)
    : null;

  if (compact) {
    return (
      <div className="flex h-full flex-col gap-0 overflow-y-auto bg-[#f5f5f0] p-4">
        <div className="flex items-center justify-between border-b-2 border-black/20 pb-2 mb-3">
          <span className="font-display text-[13px] font-black uppercase tracking-tight text-black">Create</span>
          {openInvite && (
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border border-black ${openInvite.status === "open" ? "bg-white" : "bg-artemis-blue text-white"}`}>
              {openInvite.status.toUpperCase()}
            </span>
          )}
        </div>

        {openInvite && (
          <div className="mb-3">
            <button type="button"
              onClick={() => void navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`)}
              className="w-full text-left text-[11px] font-label text-artemis-charcoal bg-white rounded-lg px-2.5 py-2 border-2 border-black truncate hover:bg-neo-bg transition-colors">
              Copy invite link
            </button>
            {openInvite.status === "open" && (
              <button type="button" onClick={() => void onRevoke(openInvite.id)}
                className="w-full mt-1.5 text-[10px] font-label font-bold text-artemis-red uppercase hover:text-artemis-red-light transition-colors">
                Revoke
              </button>
            )}
          </div>
        )}

        {!openInvite && readinessReady && (
          <>
            <div className="mb-2">
              <span className="text-[9px] font-label font-bold uppercase tracking-widest text-artemis-charcoal/40 block mb-1.5">Opponent</span>
              <div className="flex gap-1.5">
                {(["open", "ens"] as const).map((scope) => (
                  <button key={scope} type="button" onClick={() => setInviteScope(scope)}
                    className={`flex-1 px-2 py-1.5 rounded border-2 border-black text-[10px] font-label font-bold uppercase tracking-wider transition-all ${
                      inviteScope === scope ? "bg-black text-white shadow-[2px_2px_0_0_var(--artemis-blue)]" : "bg-white text-artemis-charcoal hover:bg-[#eee]"
                    }`}>
                    {scope === "open" ? "Open" : "ENS"}
                  </button>
                ))}
              </div>
              {inviteScope === "ens" && (
                <input type="text" value={inviteEnsName} onChange={(e) => setInviteEnsName(e.target.value)}
                  placeholder="ENS name"
                  className="mt-1.5 w-full bg-white text-black text-[11px] font-label px-2 py-1.5 rounded border-2 border-black focus:border-artemis-blue focus:outline-none placeholder:text-artemis-silver/30" />
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {[{ label: "$", values: constraints.wagerUsd, val: wagerUsd, set: setWagerUsd },
                { label: "", values: constraints.durationSeconds.map(fmtDuration), val: durationSeconds, set: setDurationSeconds },
                { label: "$", values: constraints.startingCapitalUsd, val: startingCapitalUsd, set: setStartingCapitalUsd },
              ].map(({ label, values, val, set }) => (
                <div key={label + String(val)} className="flex flex-col gap-1">
                  <select value={val} onChange={(e) => set(Number(e.target.value))}
                    className="w-full bg-white text-black text-[11px] font-label font-bold tabular-nums px-1.5 py-1.5 rounded border-2 border-black focus:border-artemis-blue focus:outline-none">
                    {values.map((v) => (
                      <option key={v} value={v}>{label}{v}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <button type="button" onClick={() => void onCreate()}
              disabled={creating || (inviteScope === "ens" && !inviteEnsName.trim())}
              className="neo-btn w-full py-2 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0">
              {creating ? "Creating..." : "Create Match"}
            </button>

            {inviteLink && (
              <div className="mt-2 flex items-center gap-1.5 bg-white rounded-lg px-2.5 py-2 border-2 border-black animate-trade-enter">
                <span className="text-[9px] font-label font-bold uppercase text-artemis-red shrink-0">Ready</span>
                <button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)}
                  className="text-[11px] font-label text-artemis-charcoal truncate flex-1 text-left hover:text-black transition-colors">
                  Copy link
                </button>
              </div>
            )}
          </>
        )}

        {!readinessReady && (
          <p className="text-[11px] text-artemis-silver/50 text-center py-4">Setup required</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <section className="mx-auto flex max-w-[520px] flex-col gap-4 rounded-xl border-3 border-black bg-white p-5 shadow-[6px_6px_0_0_var(--artemis-blue)]">
        <div className="flex items-start justify-between gap-3 border-b-2 border-black pb-3">
          <div>
            <span className="font-display text-lg font-black uppercase tracking-tight text-black">Create Match</span>
            {preferenceSummary && (
              <p className="mt-1 text-[11px] font-label font-bold uppercase tracking-wide text-artemis-charcoal/55">
                {preferenceSummary}
              </p>
            )}
          </div>
          {creationCtx?.ensPreference && (
            <span className="shrink-0 rounded border-2 border-black bg-[#f0f0ec] px-2.5 py-1 text-[10px] font-label font-bold uppercase tracking-wider text-black">
              ENS prefs
            </span>
          )}
        </div>

        {/* Open invite display — shown inline when exists */}
        {openInvite && (
          <div className="rounded-lg border-2 border-dashed border-artemis-charcoal/30 px-4 py-3 bg-[#fafaf8]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-label font-bold uppercase tracking-widest text-artemis-charcoal/40">Invite Active</span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border-2 border-black ${openInvite.status === "open" ? "bg-white text-black" : "bg-artemis-blue text-white"}`}>
                {openInvite.status.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 mb-1.5 border-2 border-black">
              <span className="text-[12px] font-label text-artemis-charcoal truncate flex-1">{`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`}</span>
              <button type="button"
                onClick={() => void navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`)}
                className="text-[10px] font-label font-bold text-artemis-red uppercase hover:text-artemis-red-light transition-colors shrink-0">
                Copy
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-label text-artemis-charcoal/55">${openInvite.wagerUsd} wager &middot; {fmtDuration(openInvite.durationSeconds)}</span>
              {openInvite.status === "open" && (
                <button type="button" onClick={() => void onRevoke(openInvite.id)}
                  className="text-[10px] font-label font-bold text-artemis-red uppercase hover:text-artemis-red-light transition-colors">
                  Revoke
                </button>
              )}
            </div>
          </div>
        )}

        {!openInvite && readinessReady && (
          <>
            <div>
              <span className="text-[11px] font-label font-bold uppercase tracking-widest text-artemis-charcoal/50 block mb-2">Opponent</span>
              <div className="flex gap-2">
                {(["open", "ens"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setInviteScope(scope)}
                    className={`flex-1 px-3 py-2.5 rounded-lg border-2 border-black text-[12px] font-label font-bold uppercase tracking-wider transition-all ${
                      inviteScope === scope
                        ? "bg-black text-white shadow-[3px_3px_0_0_var(--artemis-blue)]"
                        : "bg-white text-artemis-charcoal hover:bg-[#f5f5f0]"
                    }`}
                  >
                    {scope === "open" ? "Anyone" : "ENS Target"}
                  </button>
                ))}
              </div>
              {inviteScope === "ens" && (
                <input
                  type="text"
                  value={inviteEnsName}
                  onChange={(e) => setInviteEnsName(e.target.value)}
                  placeholder="e.g. vitally.moonjoy.eth"
                  className="mt-2 w-full bg-white text-black text-[13px] font-label px-3 py-2.5 rounded-lg border-2 border-black focus:border-artemis-blue focus:outline-none placeholder:text-artemis-silver/30"
                />
              )}
            </div>

            <TermRow
              label="Wager"
              values={constraints.wagerUsd}
              selected={wagerUsd}
              onSelect={setWagerUsd}
              format={(v) => `$${v}`}
            />

            <TermRow
              label="Duration"
              values={constraints.durationSeconds}
              selected={durationSeconds}
              onSelect={setDurationSeconds}
              format={fmtDuration}
            />

            <TermRow
              label="Capital"
              values={constraints.startingCapitalUsd}
              selected={startingCapitalUsd}
              onSelect={setStartingCapitalUsd}
              format={(v) => `$${v}`}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border-2 border-black/15 bg-[#f8f8f6] px-3 py-2.5">
                <span className="text-[10px] font-label font-bold uppercase tracking-widest text-artemis-charcoal/50">Stakes</span>
                <span className="truncate text-[12px] font-label font-bold text-black tabular-nums">${wagerUsd} wager &middot; ${startingCapitalUsd} capital &middot; {fmtDuration(durationSeconds)}</span>
              </div>
              <button
                type="button"
                onClick={() => void onCreate()}
                disabled={creating || (inviteScope === "ens" && !inviteEnsName.trim())}
                className="neo-btn px-5 py-2.5 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>

            {inviteLink && (
              <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2.5 border-2 border-black animate-trade-enter">
                <span className="text-[10px] font-label font-bold uppercase tracking-widest text-artemis-red">Link Ready</span>
                <span className="text-[12px] font-label text-artemis-charcoal truncate flex-1">{inviteLink}</span>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(inviteLink)}
                  className="text-[10px] font-label font-bold text-artemis-red uppercase hover:text-artemis-red-light transition-colors shrink-0"
                >
                  Copy
                </button>
              </div>
            )}
          </>
        )}

        {!readinessReady && (
          <div className="text-center py-6">
            <p className="text-[13px] text-artemis-charcoal/55">Complete setup to create invites</p>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Term Row — pill toggle selector for discrete values ─────

function TermRow({
  label,
  values,
  selected,
  onSelect,
  format,
}: {
  label: string;
  values: readonly number[];
  selected: number;
  onSelect: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div>
      <span className="text-[11px] font-label font-bold uppercase tracking-widest text-artemis-charcoal/50 block mb-2">{label}</span>
      <div className="flex gap-2">
        {values.map((v) => {
          const isActive = v === selected;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onSelect(v)}
              className={`flex-1 px-3 py-2 rounded-lg border-2 border-black text-[13px] font-label font-bold tabular-nums transition-all ${
                isActive
                  ? "bg-black text-white shadow-[3px_3px_0_0_var(--artemis-blue)]"
                  : "bg-white text-artemis-charcoal hover:bg-[#f5f5f0]"
              }`}
            >
              {format(v)}
            </button>
          );
        })}
      </div>
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
