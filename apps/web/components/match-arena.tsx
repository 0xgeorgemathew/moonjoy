"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { createClient } from "@/lib/supabase/client";
import type { ArenaSnapshot, EnrichedTrade } from "@/lib/types/arena";
import type { MatchView } from "@/lib/types/match";

function fmtClock(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function fmtTimeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

function fmtMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function shortAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function pnlSign(val: number): string {
  return val >= 0 ? "+" : "";
}

function pnlColor(val: number): string {
  if (val > 0) return "text-green-400";
  if (val < 0) return "text-red-400";
  return "text-on-surface-variant";
}

function phaseLabel(phase: string): { text: string; color: string } {
  switch (phase) {
    case "opening_window": return { text: "OPENING WINDOW", color: "bg-yellow-600" };
    case "midgame": return { text: "LIVE TRADING", color: "bg-green-600" };
    case "closing_window": return { text: "CLOSING WINDOW", color: "bg-orange-600" };
    case "warmup": return { text: "WARMUP", color: "bg-blue-600" };
    case "settling": return { text: "SETTLING", color: "bg-purple-600" };
    case "settled": return { text: "SETTLED", color: "bg-artemis-charcoal" };
    default: return { text: phase.toUpperCase(), color: "bg-artemis-charcoal" };
  }
}

export function MatchArena() {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [supabase] = useState(() => createClient());
  const feedRef = useRef<HTMLDivElement>(null);
  const snapshotLoadedAtRef = useRef(Date.now());
  const prevTradeCountRef = useRef(0);

  const [snapshot, setSnapshot] = useState<ArenaSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [inviteScope, setInviteScope] = useState<"open" | "ens">("open");
  const [inviteEnsName, setInviteEnsName] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"live" | "events">("live");
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
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
        const errMsg = body && typeof body === "object" && "error" in body && body.error ? body.error : "Request failed.";
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
      setLastUpdatedAt(new Date());
      snapshotLoadedAtRef.current = Date.now();
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
    void refreshSnapshot();
  }, [ready, authenticated, refreshSnapshot]);

  // Broadcast channels for immediate push
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

  // Postgres Changes: real-time INSERT on trades and events
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

  // Auto-scroll trade feed when new trades arrive
  useEffect(() => {
    const count = snapshot?.live?.trades.length ?? 0;
    if (count > prevTradeCountRef.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
    prevTradeCountRef.current = count;
  }, [snapshot?.live?.trades.length]);

  // Periodic refresh during live match as fallback
  useEffect(() => {
    if (!snapshot?.live?.match.id) return;
    const phase = snapshot.live.phase;
    const isLive = phase === "warmup" || phase === "opening_window" || phase === "midgame" || phase === "closing_window" || phase === "live";
    if (!isLive) return;

    const id = setInterval(() => { void refreshSnapshot(); }, 8000);
    return () => clearInterval(id);
  }, [snapshot?.live?.match.id, snapshot?.live?.phase, refreshSnapshot]);

  const handleCreateInvite = async () => {
    setCreating(true);
    setInviteLink(null);
    setActionError(null);
    try {
      const result = await fetchJson<{ inviteLink: string }>("/api/invites", {
        method: "POST",
        body: JSON.stringify({
          scopeType: inviteScope,
          scopedEnsName: inviteScope === "ens" ? inviteEnsName : undefined,
        }),
      });
      setInviteLink(result.inviteLink);
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

  const handleCopyLink = (link: string) => {
    void navigator.clipboard.writeText(link);
  };

  if (!ready || loading) {
    return (
      <ArenaShell>
        <div className="flex items-center gap-3 p-8 text-on-surface-variant">
          <span className="text-base font-mono uppercase tracking-widest">Syncing arena...</span>
          <Dots />
        </div>
      </ArenaShell>
    );
  }

  if (!authenticated) {
    return (
      <ArenaShell>
        <div className="flex flex-col items-center gap-6 p-10">
          <p className="text-lg text-on-surface-variant text-center max-w-md">
            Connect your Moonjoy account to enter the arena.
          </p>
          <button type="button" onClick={() => void login()} className="neo-btn px-8 py-3.5 text-base">
            Connect to Enter
          </button>
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

  const snapshotAge = Math.floor((now - snapshotLoadedAtRef.current) / 1000);
  const localRemaining = live ? Math.max(0, live.remainingSeconds - snapshotAge) : 0;
  const localElapsed = live ? live.elapsedSeconds + snapshotAge : 0;

  const tokenMap = new Map(
    (live?.allowedTokens ?? []).map(t => [t.address.toLowerCase(), t.symbol]),
  );

  const agentMap = new Map<string, { agentEns: string; userEns: string; smartAccountAddress: string; seat: "creator" | "opponent" }>();
  if (activeMatch) {
    agentMap.set(activeMatch.creator.agentId, {
      agentEns: activeMatch.creator.agentEnsName || shortAddr(activeMatch.creator.smartAccountAddress),
      userEns: activeMatch.creator.userEnsName || shortAddr(activeMatch.creator.smartAccountAddress),
      smartAccountAddress: activeMatch.creator.smartAccountAddress,
      seat: "creator",
    });
    if (activeMatch.opponent) {
      agentMap.set(activeMatch.opponent.agentId, {
        agentEns: activeMatch.opponent.agentEnsName || shortAddr(activeMatch.opponent.smartAccountAddress),
        userEns: activeMatch.opponent.userEnsName || shortAddr(activeMatch.opponent.smartAccountAddress),
        smartAccountAddress: activeMatch.opponent.smartAccountAddress,
        seat: "opponent",
      });
    }
  }

  const isViewerCreator = activeMatch?.viewerSeat === "creator";
  const viewerAgentInfo = isViewerCreator
    ? agentMap.get(activeMatch?.creator.agentId ?? "")
    : agentMap.get(activeMatch?.opponent?.agentId ?? "");
  const opponentAgentInfo = isViewerCreator
    ? agentMap.get(activeMatch?.opponent?.agentId ?? "")
    : agentMap.get(activeMatch?.creator.agentId ?? "");

  return (
    <ArenaShell>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
        <div className="flex items-center gap-3">
          <span className="font-display text-2xl font-black uppercase tracking-tight text-on-surface">Arena</span>
          <LiveIndicator connected={connected} lastUpdated={lastUpdatedAt} />
        </div>
        <div className="flex items-center gap-3">
          {viewer.userEnsName && (
            <span className="font-mono text-base text-on-surface-variant">{viewer.userEnsName}</span>
          )}
          {viewer.agentEnsName && (
            <span className="arena-role-badge arena-role-badge-creator text-sm !px-3 !py-1">
              {viewer.agentEnsName}
            </span>
          )}
        </div>
      </div>

      {/* Readiness blockers */}
      {!readiness.ready && readiness.blockers.length > 0 && (
        <div className="px-6 py-4 border-b border-outline-variant bg-primary-container">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold uppercase tracking-widest text-primary">Setup Required</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {readiness.blockers.map((b, i) => (
              <span key={i} className="text-base font-mono text-on-surface-variant bg-surface-container px-3 py-1.5 rounded">
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="px-6 py-3 border-b border-outline-variant bg-red-900/20">
          <div className="flex items-center justify-between">
            <span className="text-base font-mono text-red-400">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-sm font-bold text-red-400/70 uppercase hover:text-red-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Match phase / clock */}
      <MatchPhaseBar
        match={activeMatch}
        live={live}
        localRemaining={localRemaining}
        localElapsed={localElapsed}
        agentMap={agentMap}
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Invite creation when no active match */}
        {!activeMatch && !openInvite && (
          <div className="px-6 py-5 border-b border-outline-variant">
            <div className="flex items-center gap-3 mb-4">
              <button
                type="button"
                onClick={() => void handleCreateInvite()}
                disabled={creating || !readiness.ready}
                className="neo-btn px-6 py-3 text-base disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creating ? "Creating..." : "Create Invite Link"}
              </button>
              {readiness.ready && <span className="text-base font-mono text-on-surface-variant">$10 Wager</span>}
            </div>
            <div className="flex items-center gap-3 mb-4">
              <label className="text-base font-bold uppercase tracking-widest text-on-surface-variant cursor-pointer">
                <input
                  type="radio"
                  name="inviteScope"
                  value="open"
                  checked={inviteScope === "open"}
                  onChange={() => setInviteScope("open")}
                  className="mr-2"
                />
                Open
              </label>
              <label className="text-base font-bold uppercase tracking-widest text-on-surface-variant cursor-pointer">
                <input
                  type="radio"
                  name="inviteScope"
                  value="ens"
                  checked={inviteScope === "ens"}
                  onChange={() => setInviteScope("ens")}
                  className="mr-2"
                />
                ENS-Scoped
              </label>
              {inviteScope === "ens" && (
                <input
                  type="text"
                  value={inviteEnsName}
                  onChange={(e) => setInviteEnsName(e.target.value)}
                  placeholder="e.g. vitally.moonjoy.eth"
                  className="flex-1 bg-surface-container text-on-surface text-base font-mono px-3 py-2.5 rounded border border-outline-variant focus:border-primary focus:outline-none placeholder:text-on-surface-variant"
                />
              )}
            </div>
            {inviteLink && (
              <div className="flex items-center gap-2 bg-surface-container rounded px-4 py-3">
                <span className="text-base font-mono text-on-surface truncate flex-1">{inviteLink}</span>
                <button
                  type="button"
                  onClick={() => handleCopyLink(inviteLink)}
                  className="text-sm font-bold text-primary uppercase tracking-wider hover:text-primary/80"
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}

        {/* Open invite display */}
        {!activeMatch && openInvite && (
          <div className="px-6 py-5 border-b border-outline-variant">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base font-bold uppercase tracking-widest text-on-surface-variant">Open Invite</span>
              <span className={`text-sm font-mono px-3 py-1 rounded ${
                openInvite.status === "open"
                  ? "bg-green-900/30 text-green-400"
                  : openInvite.status === "joined"
                    ? "bg-blue-900/30 text-blue-400"
                    : "bg-red-900/30 text-red-400"
              }`}>
                {openInvite.status.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-2 bg-surface-container rounded px-4 py-3 mb-3">
              <span className="text-base font-mono text-on-surface truncate flex-1">
                {`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`}
              </span>
              <button
                type="button"
                onClick={() => handleCopyLink(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`)}
                className="text-sm font-bold text-primary uppercase tracking-wider hover:text-primary/80"
              >
                Copy
              </button>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-base font-mono text-on-surface-variant">
                {openInvite.scopeType === "ens" ? `ENS: ${openInvite.scopedEnsName}` : "Open invite"}
              </span>
              <span className="text-base font-mono text-on-surface-variant">${openInvite.wagerUsd} wager</span>
              {openInvite.status === "open" && (
                <button
                  type="button"
                  onClick={() => void handleRevokeInvite(openInvite.id)}
                  className="text-sm font-bold text-red-400 uppercase tracking-wider hover:text-red-300"
                >
                  Revoke
                </button>
              )}
            </div>
          </div>
        )}

        {/* Waiting state */}
        {!activeMatch && !inviteLink && !openInvite && (
          <div className="px-6 py-5 border-b border-outline-variant">
            <p className="text-base font-mono text-on-surface-variant text-center">
              Create an invite link above or open an invite link from another player to start a match.
            </p>
          </div>
        )}

        {/* Live match view */}
        {live && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Scoreboard — fixed, always visible */}
            <div className="grid grid-cols-2 gap-4 px-6 py-4 border-b border-outline-variant">
              <PlayerCard
                label="YOUR AGENT"
                agentEns={viewerAgentInfo?.agentEns ?? ""}
                userEns={viewerAgentInfo?.userEns ?? ""}
                portfolio={live.viewerPortfolio}
                isViewer
              />
              <PlayerCard
                label="OPPONENT"
                agentEns={opponentAgentInfo?.agentEns ?? ""}
                userEns={opponentAgentInfo?.userEns ?? ""}
                portfolio={live.opponentPortfolio}
                isViewer={false}
              />
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-outline-variant">
              <button
                type="button"
                onClick={() => setActiveTab("live")}
                className={`px-6 py-3 text-base font-bold uppercase tracking-widest transition-colors ${
                  activeTab === "live"
                    ? "text-primary border-b-2 border-primary bg-primary-container"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                Live Activity ({live.trades.length} trades)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("events")}
                className={`px-6 py-3 text-base font-bold uppercase tracking-widest transition-colors ${
                  activeTab === "events"
                    ? "text-primary border-b-2 border-primary bg-primary-container"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                Events ({live.eventLog.length})
              </button>
            </div>

            <div ref={feedRef} className="flex-1 overflow-y-auto">
              {activeTab === "live" && (
                <LiveActivityFeed
                  trades={live.trades}
                  viewerAgentId={viewer.agentId}
                  agentMap={agentMap}
                  tokenMap={tokenMap}
                  mandatoryWindowResults={live.mandatoryWindowResults}
                  allowedTokens={live.allowedTokens}
                  viewerPortfolio={live.viewerPortfolio}
                  opponentPortfolio={live.opponentPortfolio}
                />
              )}
              {activeTab === "events" && <EventLog entries={live.eventLog} />}
            </div>
          </div>
        )}

        {/* Leaderboard */}
        {live && live.leaderboard.length > 0 && (
          <div className="border-t border-outline-variant px-6 py-4">
            <LeaderboardBar
              entries={live.leaderboard}
              viewerAgentId={viewer.agentId}
              agentMap={agentMap}
            />
          </div>
        )}
      </div>
    </ArenaShell>
  );
}

function ArenaShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] flex-1 items-center justify-center bg-surface px-4 py-8">
      <section className="neu-convex flex w-full max-w-5xl flex-col overflow-hidden" style={{ minHeight: "80dvh" }}>
        {children}
      </section>
    </main>
  );
}

function LiveIndicator({ connected, lastUpdated }: { connected: boolean; lastUpdated: Date | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`arena-status-dot ${connected ? "arena-status-dot-connected" : "arena-status-dot-disconnected"}`} />
      <span className="font-mono text-sm font-bold uppercase tracking-widest text-on-surface-variant">
        {connected ? "Live" : "Offline"}
      </span>
      {connected && lastUpdated && (
        <span className="font-mono text-xs text-on-surface-variant/60">
          updated {fmtTimeAgo(lastUpdated.toISOString())}
        </span>
      )}
    </div>
  );
}

function MatchPhaseBar({
  match,
  live,
  localRemaining,
  localElapsed,
  agentMap,
}: {
  match: MatchView | null;
  live: ArenaSnapshot["live"];
  localRemaining: number;
  localElapsed: number;
  agentMap: Map<string, { agentEns: string; userEns: string; smartAccountAddress: string; seat: "creator" | "opponent" }>;
}) {
  if (!match) {
    return (
      <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between">
        <span className="text-base font-mono text-on-surface-variant uppercase tracking-wider">No Active Match</span>
      </div>
    );
  }

  const status = live?.phase ?? match.status;
  const { text, color } = phaseLabel(status);
  const isTimed = status === "warmup" || status.startsWith("opening") || status === "midgame" || status.startsWith("closing") || status === "live";

  const creatorInfo = agentMap.get(match.creator.agentId);
  const opponentInfo = match.opponent ? agentMap.get(match.opponent.agentId) : null;

  return (
    <div className="px-6 py-4 border-b border-outline-variant">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`${color} text-sm font-bold text-white uppercase tracking-widest px-3 py-1.5 rounded`}>
            {text}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {live && isTimed && (
            <span className={`font-display text-3xl font-black tabular-nums ${localRemaining <= 30 ? "text-red-400 arena-timer-urgent" : "text-on-surface"}`}>
              {fmtMmSs(localRemaining)}
            </span>
          )}
          {live && localElapsed > 0 && (
            <span className="text-base font-mono text-on-surface-variant">
              {fmtMmSs(localElapsed)} elapsed
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-6 mt-3">
        <span className="text-base font-mono text-on-surface-variant">
          Wager: ${match.wagerUsd.toFixed(0)} &middot; Capital: ${match.startingCapitalUsd.toFixed(0)}
        </span>
        {live && (live.phase === "opening_window" || live.phase === "midgame" || live.phase === "closing_window") && (
          <span className="text-sm font-mono text-primary/80">
            Winner = Most USDC at end
          </span>
        )}
      </div>
      {/* Player matchup with ENS */}
      <div className="grid grid-cols-2 gap-4 mt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Creator</span>
          <span className="text-base font-mono font-bold text-on-surface">
            {creatorInfo?.agentEns ?? shortAddr(match.creator.smartAccountAddress)}
          </span>
          {creatorInfo?.userEns && (
            <span className="text-sm font-mono text-on-surface-variant">
              by {creatorInfo.userEns}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Opponent</span>
          {opponentInfo ? (
            <>
              <span className="text-base font-mono font-bold text-on-surface">
                {opponentInfo.agentEns}
              </span>
              {opponentInfo.userEns && (
                <span className="text-sm font-mono text-on-surface-variant">
                  by {opponentInfo.userEns}
                </span>
              )}
            </>
          ) : (
            <span className="text-base font-mono text-on-surface-variant">Waiting...</span>
          )}
        </div>
      </div>
      {live && live.mandatoryWindowResults.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          {live.mandatoryWindowResults.map((w, i) => (
            <span
              key={i}
              className={`text-base font-mono px-3 py-1 rounded ${
                w.completed
                  ? "bg-green-900/30 text-green-400"
                  : "bg-red-900/30 text-red-400"
              }`}
            >
              {w.windowName === "opening_window" ? "OPEN" : "CLOSE"}: {w.completed ? "DONE" : `$${w.penaltyUsd.toFixed(2)} PEN`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerCard({
  label,
  agentEns,
  userEns,
  portfolio,
  isViewer,
}: {
  label: string;
  agentEns: string;
  userEns: string;
  portfolio: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["viewerPortfolio"];
  isViewer: boolean;
}) {
  return (
    <div className={`rounded-xl p-4 ${isViewer ? "bg-primary-container/50 ring-1 ring-primary/30" : "bg-surface-container ring-1 ring-outline-variant"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
        {portfolio?.stale && <span className="text-sm text-yellow-400 font-mono font-bold">STALE</span>}
      </div>

      {/* Agent ENS identity */}
      <div className="mb-3">
        <span className={`text-lg font-bold font-mono block ${isViewer ? "text-primary" : "text-on-surface"}`}>
          {agentEns}
        </span>
        {userEns && userEns !== agentEns && (
          <span className="text-sm font-mono text-on-surface-variant">
            operated for {userEns}
          </span>
        )}
      </div>

      {!portfolio ? (
        <span className="text-base text-on-surface-variant">No valuation yet</span>
      ) : (
        <>
          {/* USDC CASH — the score that matters */}
          <div className="mb-3 p-3 rounded-lg bg-surface-container-low ring-1 ring-outline-variant/50">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold uppercase tracking-widest text-primary">USDC Cash</span>
              <span className="text-xs font-mono text-on-surface-variant/60">= Final Score</span>
            </div>
            <span className="text-3xl font-black font-mono text-on-surface tabular-nums">
              ${portfolio.usdcBalanceUsd.toFixed(2)}
            </span>
            {portfolio.penaltiesUsd > 0 && (
              <div className="mt-1 text-sm font-mono text-red-400">
                -${portfolio.penaltiesUsd.toFixed(2)} penalties &rarr; ${(portfolio.usdcBalanceUsd - portfolio.penaltiesUsd).toFixed(2)} net
              </div>
            )}
          </div>

          {/* Total portfolio value — secondary */}
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-sm font-mono text-on-surface-variant">Portfolio</span>
            <span className="text-lg font-bold font-mono text-on-surface tabular-nums">
              ${portfolio.currentValueUsd.toFixed(2)}
            </span>
            <span className={`text-sm font-bold font-mono ${pnlColor(portfolio.totalPnlUsd)} tabular-nums`}>
              {pnlSign(portfolio.totalPnlUsd)}${portfolio.totalPnlUsd.toFixed(2)}
            </span>
          </div>

          {/* Token balances */}
          {portfolio.balances.length > 0 && (
            <div className="mt-2 pt-2 border-t border-outline-variant/40 space-y-1">
              {portfolio.balances.map((b) => (
                <div key={b.tokenAddress} className="flex items-center justify-between text-sm font-mono">
                  <span className={`font-bold ${b.symbol === "USDC" ? "text-primary" : "text-on-surface-variant"}`}>
                    {b.symbol}
                  </span>
                  <span className={`tabular-nums ${b.symbol === "USDC" ? "text-primary font-bold" : "text-on-surface"}`}>
                    ${b.valueUsd > 0 ? b.valueUsd.toFixed(2) : "---"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Unified live activity feed — merges portfolio context with trade stream */
function LiveActivityFeed({
  trades,
  viewerAgentId,
  agentMap,
  tokenMap,
  mandatoryWindowResults,
  allowedTokens,
  viewerPortfolio,
  opponentPortfolio,
}: {
  trades: EnrichedTrade[];
  viewerAgentId: string;
  agentMap: Map<string, { agentEns: string; userEns: string; smartAccountAddress: string; seat: "creator" | "opponent" }>;
  tokenMap: Map<string, string>;
  mandatoryWindowResults: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["mandatoryWindowResults"];
  allowedTokens: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["allowedTokens"];
  viewerPortfolio: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["viewerPortfolio"];
  opponentPortfolio: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["opponentPortfolio"];
}) {
  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="text-2xl font-display font-black uppercase tracking-tight text-on-surface-variant/50">
          Awaiting Trades
        </div>
        <div className="text-base text-on-surface-variant">
          Both agents are analyzing the market and preparing strategies
        </div>
        {/* Show starting balances while waiting */}
        <div className="grid grid-cols-2 gap-6 mt-4 w-full max-w-lg">
          <div className="text-center">
            <div className="text-sm font-mono text-on-surface-variant mb-1">Your Capital</div>
            <div className="text-xl font-black font-mono text-on-surface tabular-nums">
              ${viewerPortfolio?.currentValueUsd.toFixed(2) ?? "100.00"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm font-mono text-on-surface-variant mb-1">Opponent Capital</div>
            <div className="text-xl font-black font-mono text-on-surface tabular-nums">
              ${opponentPortfolio?.currentValueUsd.toFixed(2) ?? "100.00"}
            </div>
          </div>
        </div>
        {/* Show allowed tokens */}
        {allowedTokens.length > 0 && (
          <div className="mt-6 w-full max-w-lg">
            <div className="text-sm font-bold uppercase tracking-widest text-on-surface-variant mb-2">
              Tradeable Tokens
            </div>
            <div className="flex flex-wrap gap-2">
              {allowedTokens.map((t) => (
                <span key={t.address} className="text-sm font-mono px-3 py-1.5 bg-surface-container rounded text-on-surface-variant">
                  {t.symbol} <span className="text-on-surface-variant/60">({t.riskTier.replace("_", " ")})</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* USDC spread bar at top of feed */}
      {viewerPortfolio && opponentPortfolio && (
        <div className="px-6 py-3 border-b border-outline-variant bg-surface-container-low">
          <SpreadBar
            viewerPortfolio={viewerPortfolio}
            opponentPortfolio={opponentPortfolio}
            viewerEns={agentMap.get(viewerAgentId)?.agentEns ?? "You"}
            opponentEns={Array.from(agentMap.values()).find(a => a.agentEns !== agentMap.get(viewerAgentId)?.agentEns)?.agentEns ?? "Opponent"}
          />
        </div>
      )}

      {/* Trade feed */}
      <div className="divide-y divide-outline-variant">
        {trades.map((trade) => {
          const isOwn = trade.agentId === viewerAgentId;
          const info = agentMap.get(trade.agentId);
          const tokenInSym = tokenMap.get(trade.tokenIn.toLowerCase()) ?? shortAddr(trade.tokenIn);
          const tokenOutSym = tokenMap.get(trade.tokenOut.toLowerCase()) ?? shortAddr(trade.tokenOut);
          const amountInNum = parseFloat(trade.amountIn);
          const amountOutNum = parseFloat(trade.simulatedAmountOut || trade.quotedAmountOut);

          return (
            <div
              key={trade.id}
              className={`arena-trade-enter px-6 py-4 ${isOwn ? "bg-primary-container/15" : "bg-transparent"}`}
            >
              {/* Row 1: Who traded + timestamp */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className={`arena-role-badge ${isOwn ? "arena-role-badge-creator" : "arena-role-badge-opponent"} !text-sm`}>
                    {info?.seat === "creator" ? "CREATOR" : "CHALLENGER"}
                  </span>
                  <span className={`text-base font-bold ${isOwn ? "text-primary" : "text-on-surface"}`}>
                    {info?.agentEns ?? shortAddr(trade.agentId)}
                  </span>
                  {info?.userEns && (
                    <span className="text-sm text-on-surface-variant">
                      for {info.userEns}
                    </span>
                  )}
                  <span className="text-sm text-on-surface-variant/60">executed a trade</span>
                </div>
                <span className="text-sm font-mono text-on-surface-variant tabular-nums">{fmtClock(trade.acceptedAt)}</span>
              </div>

              {/* Row 2: Trade details — big and prominent */}
              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-center gap-2 text-lg">
                  <span className="text-on-surface-variant font-mono">{amountInNum > 0 ? amountInNum.toLocaleString(undefined, { maximumFractionDigits: 4 }) : trade.amountIn}</span>
                  <span className="font-bold text-on-surface">{tokenInSym}</span>
                  <span className="text-on-surface-variant">&rarr;</span>
                  <span className="text-on-surface-variant font-mono">{amountOutNum > 0 ? amountOutNum.toLocaleString(undefined, { maximumFractionDigits: 4 }) : trade.quotedAmountOut}</span>
                  <span className="font-bold text-on-surface">{tokenOutSym}</span>
                </div>
                <span className={`text-sm font-bold px-2.5 py-1 rounded ${
                  trade.status === "accepted"
                    ? "bg-green-900/30 text-green-400"
                    : "bg-red-900/30 text-red-400"
                }`}>
                  {trade.status === "accepted" ? "FILLED" : "REJECTED"}
                </span>
              </div>

              {/* Row 3: Quote metadata */}
              {trade.status === "accepted" && (
                <div className="flex items-center gap-4 text-sm font-mono text-on-surface-variant">
                  {trade.quote?.routing && <span>Via {trade.quote.routing}</span>}
                  {trade.quote?.gasFeeUsd != null && (
                    <span>Gas: ${trade.quote.gasFeeUsd.toFixed(2)}</span>
                  )}
                  {trade.quote?.priceImpactBps != null && (
                    <span>Impact: {(trade.quote.priceImpactBps / 100).toFixed(2)}%</span>
                  )}
                </div>
              )}
              {trade.status === "rejected" && trade.failureReason && (
                <span className="text-sm font-mono text-red-400/70 mt-1 block">{trade.failureReason}</span>
              )}
            </div>
          );
        })}
      </div>

      {mandatoryWindowResults.length > 0 && (
        <div className="px-6 py-4 border-t border-outline-variant">
          <span className="text-base font-bold uppercase tracking-widest text-on-surface-variant block mb-3">Mandatory Windows</span>
          {mandatoryWindowResults.map((w, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3 bg-surface-container rounded mb-2">
              <span className="text-base font-mono text-on-surface-variant">
                {w.windowName === "opening_window" ? "Opening" : "Closing"}
              </span>
              <span className={`text-base font-mono font-bold ${w.completed ? "text-green-400" : "text-red-400"}`}>
                {w.completed ? "Completed" : `Penalty: $${w.penaltyUsd.toFixed(2)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Visual USDC spread bar showing who's winning */
function SpreadBar({
  viewerPortfolio,
  opponentPortfolio,
  viewerEns,
  opponentEns,
}: {
  viewerPortfolio: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["viewerPortfolio"];
  opponentPortfolio: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["opponentPortfolio"];
  viewerEns: string;
  opponentEns: string;
}) {
  const viewerUsdc = viewerPortfolio ? viewerPortfolio.usdcBalanceUsd - viewerPortfolio.penaltiesUsd : 0;
  const opponentUsdc = opponentPortfolio ? opponentPortfolio.usdcBalanceUsd - opponentPortfolio.penaltiesUsd : 0;
  const diff = viewerUsdc - opponentUsdc;

  if (Math.abs(diff) < 0.01) {
    return (
      <div className="flex items-center justify-between text-sm font-mono text-on-surface-variant">
        <span>{viewerEns}</span>
        <span className="text-xs text-primary font-bold">EVEN</span>
        <span>{opponentEns}</span>
      </div>
    );
  }

  const viewerPct = Math.max(10, Math.min(90, 50 + diff * 3));

  return (
    <div>
      <div className="flex items-center justify-between text-sm font-mono mb-1">
        <span className={viewerUsdc >= opponentUsdc ? "text-green-400 font-bold" : "text-on-surface-variant"}>
          {viewerEns} ${viewerUsdc.toFixed(2)}
        </span>
        <span className={`text-xs font-bold ${diff > 0 ? "text-green-400" : diff < 0 ? "text-red-400" : "text-on-surface-variant"}`}>
          {diff > 0 ? `${viewerEns}` : `${opponentEns}`} by ${Math.abs(diff).toFixed(2)}
        </span>
        <span className={opponentUsdc > viewerUsdc ? "text-green-400 font-bold" : "text-on-surface-variant"}>
          {opponentEns} ${opponentUsdc.toFixed(2)}
        </span>
      </div>
      <div className="arena-spread-bar">
        <div
          className="arena-spread-fill"
          style={{ width: `${viewerPct}%` }}
        />
      </div>
    </div>
  );
}

function EventLog({ entries }: { entries: Array<{ id: string; eventType: string; payload: Record<string, unknown>; createdAt: string }> }) {
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-base font-mono text-on-surface-variant">No events yet</span>
      </div>
    );
  }
  return (
    <div className="divide-y divide-outline-variant">
      {entries.map((e) => (
        <div key={e.id} className="px-6 py-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold uppercase tracking-wider text-on-surface">{e.eventType}</span>
            <span className="text-sm font-mono text-on-surface-variant">{fmtClock(e.createdAt)}</span>
          </div>
          {Object.keys(e.payload).length > 0 && (
            <pre className="text-sm font-mono text-on-surface-variant mt-1 overflow-x-auto">
              {JSON.stringify(e.payload, null, 1)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function LeaderboardBar({
  entries,
  viewerAgentId,
  agentMap,
}: {
  entries: Array<{ rank: number; agentId: string; seat: string; usdcBalanceUsd: number; netScorePercent: number; netScoreUsd: number; totalPnlUsd: number; penaltiesUsd: number }>;
  viewerAgentId: string;
  agentMap: Map<string, { agentEns: string; userEns: string; smartAccountAddress: string; seat: "creator" | "opponent" }>;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-base font-bold uppercase tracking-widest text-on-surface-variant">Rank</span>
      {entries.map((e) => {
        const info = agentMap.get(e.agentId);
        const netUsdc = e.usdcBalanceUsd - e.penaltiesUsd;
        return (
          <div
            key={e.agentId}
            className={`flex items-center gap-3 px-4 py-2 rounded-lg ${
              e.agentId === viewerAgentId ? "bg-primary-container ring-1 ring-primary/30" : "bg-surface-container ring-1 ring-outline-variant"
            }`}
          >
            <span className="text-xl font-black text-on-surface">#{e.rank}</span>
            {info && (
              <span className="text-base font-mono text-on-surface">{info.agentEns}</span>
            )}
            <span className="text-base font-black font-mono text-primary tabular-nums">
              ${netUsdc.toFixed(2)} USDC
            </span>
            {e.penaltiesUsd > 0 && (
              <span className="text-sm font-mono text-red-400">-${e.penaltiesUsd.toFixed(2)} pen</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-20"
          style={{ animation: "typing-dots 1.4s ease-in-out infinite", animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}
