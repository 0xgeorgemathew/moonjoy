"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { createClient } from "@/lib/supabase/client";
import type { ArenaSnapshot } from "@/lib/types/arena";
import type { MatchView } from "@/lib/types/match";

function fmtClock(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
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

function pnlColor(val: number): string {
  if (val > 0) return "text-green-400";
  if (val < 0) return "text-red-400";
  return "text-on-surface-variant";
}

function phaseLabel(phase: string): { text: string; color: string } {
  switch (phase) {
    case "opening_window": return { text: "OPENING", color: "bg-yellow-600" };
    case "midgame": return { text: "LIVE", color: "bg-green-600" };
    case "closing_window": return { text: "CLOSING", color: "bg-orange-600" };
    case "warmup": return { text: "WARMUP", color: "bg-blue-600" };
    case "settling": return { text: "SETTLING", color: "bg-purple-600" };
    case "settled": return { text: "SETTLED", color: "bg-artemis-charcoal" };
    default: return { text: phase.toUpperCase(), color: "bg-artemis-charcoal" };
  }
}

export function ArenaPanel() {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [supabase] = useState(() => createClient());
  const feedRef = useRef<HTMLDivElement>(null);

  const [snapshot, setSnapshot] = useState<ArenaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [inviteScope, setInviteScope] = useState<"open" | "ens">("open");
  const [inviteEnsName, setInviteEnsName] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tape" | "portfolio" | "events">("tape");

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

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [snapshot?.live?.trades]);

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

  if (!ready || loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-6">
        <span className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">Syncing arena...</span>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-6 p-8">
        <p className="text-sm text-on-surface-variant text-center max-w-sm">
          Connect your Moonjoy account to enter the arena.
        </p>
        <button type="button" onClick={() => void login()} className="neo-btn px-6 py-3 text-xs">
          Connect to Enter
        </button>
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/10">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-black uppercase tracking-tight text-black">Arena</span>
          {snapshot && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
          )}
        </div>
        <div className="flex items-center gap-3">
          {viewer.userEnsName && (
            <span className="font-mono text-[9px] text-gray-500 uppercase tracking-wider">
              {viewer.userEnsName}
            </span>
          )}
          {viewer.agentEnsName && (
            <span className="text-[7px] font-mono px-1.5 py-0.5 bg-artemis-red/10 text-artemis-red rounded font-bold uppercase">
              {viewer.agentEnsName}
            </span>
          )}
        </div>
      </div>

      {/* Readiness blockers */}
      {!readiness.ready && readiness.blockers.length > 0 && (
        <div className="px-4 py-2 border-b border-black/10 bg-artemis-red/5">
          <span className="text-[8px] font-bold uppercase tracking-widest text-artemis-red block mb-1">Setup Required</span>
          <div className="flex flex-wrap gap-1">
            {readiness.blockers.map((b, i) => (
              <span key={i} className="text-[8px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="px-4 py-2 border-b border-black/10 bg-red-50">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-red-600">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-[8px] font-bold text-red-400 uppercase hover:text-red-500"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Match phase / clock */}
      <MatchPhaseBar match={activeMatch} live={live} />

      {/* Invite creation when no active match */}
      {!activeMatch && !openInvite && readiness.ready && (
        <div className="px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => void handleCreateInvite()}
              disabled={creating}
              className="neo-btn px-4 py-2 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {creating ? "Creating..." : "Create Invite Link"}
            </button>
            <span className="text-[8px] font-mono text-gray-400">$10 Wager</span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-500 flex items-center gap-1">
              <input
                type="radio"
                name="inviteScope"
                value="open"
                checked={inviteScope === "open"}
                onChange={() => setInviteScope("open")}
                className="mr-0.5"
              />
              Open
            </label>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-500 flex items-center gap-1">
              <input
                type="radio"
                name="inviteScope"
                value="ens"
                checked={inviteScope === "ens"}
                onChange={() => setInviteScope("ens")}
                className="mr-0.5"
              />
              ENS-Scoped
            </label>
            {inviteScope === "ens" && (
              <input
                type="text"
                value={inviteEnsName}
                onChange={(e) => setInviteEnsName(e.target.value)}
                placeholder="e.g. vitally.moonjoy.eth"
                className="flex-1 bg-gray-100 text-black text-[9px] font-mono px-2 py-1 rounded border border-gray-200 focus:border-artemis-red focus:outline-none placeholder:text-gray-400"
              />
            )}
          </div>
          {inviteLink && (
            <div className="flex items-center gap-2 bg-gray-100 rounded px-2 py-1.5">
              <span className="text-[8px] font-mono text-gray-600 truncate flex-1">{inviteLink}</span>
              <button
                type="button"
                onClick={() => { void navigator.clipboard.writeText(inviteLink); }}
                className="text-[8px] font-bold text-artemis-red uppercase tracking-wider hover:text-artemis-red/80"
              >
                Copy
              </button>
            </div>
          )}
        </div>
      )}

      {/* Open invite display */}
      {!activeMatch && openInvite && (
        <div className="px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500">Open Invite</span>
            <span className={`text-[7px] font-mono px-1 py-0.5 rounded ${
              openInvite.status === "open"
                ? "bg-green-100 text-green-700"
                : openInvite.status === "joined"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-red-100 text-red-700"
            }`}>
              {openInvite.status.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-2 bg-gray-100 rounded px-2 py-1.5 mb-1">
            <span className="text-[8px] font-mono text-gray-600 truncate flex-1">
              {`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`}
            </span>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${openInvite.inviteToken}`); }}
              className="text-[8px] font-bold text-artemis-red uppercase tracking-wider hover:text-artemis-red/80"
            >
              Copy
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[8px] font-mono text-gray-400">
              {openInvite.scopeType === "ens" ? `ENS: ${openInvite.scopedEnsName}` : "Open invite"}
            </span>
            <span className="text-[8px] font-mono text-gray-400">${openInvite.wagerUsd} wager</span>
            {openInvite.status === "open" && (
              <button
                type="button"
                onClick={() => void handleRevokeInvite(openInvite.id)}
                className="text-[8px] font-bold text-red-500 uppercase tracking-wider hover:text-red-400"
              >
                Revoke
              </button>
            )}
          </div>
        </div>
      )}

      {/* Waiting state */}
      {!activeMatch && !inviteLink && !openInvite && readiness.ready && (
        <div className="px-4 py-3 border-b border-black/10">
          <p className="text-[9px] font-mono text-gray-400 text-center">
            Create an invite link above or open an invite link from another player to start a match.
          </p>
        </div>
      )}

      {/* Live data tabs */}
      {live && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex border-b border-black/10">
            {(["tape", "portfolio", "events"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-[8px] font-bold uppercase tracking-widest transition-colors ${
                  activeTab === tab
                    ? "text-artemis-red border-b-2 border-artemis-red bg-artemis-red/5"
                    : "text-gray-500 hover:text-black"
                }`}
              >
                {tab === "tape" ? `Trades (${live.trades.length})` : tab === "portfolio" ? "Portfolio" : `Events (${live.eventLog.length})`}
              </button>
            ))}
          </div>
          <div ref={feedRef} className="flex-1 overflow-y-auto">
            {activeTab === "tape" && <TradeTape trades={live.trades} viewerAgentId={viewer.agentId} />}
            {activeTab === "portfolio" && (
              <PortfolioPanel
                viewerPortfolio={live.viewerPortfolio}
                opponentPortfolio={live.opponentPortfolio}
                allowedTokens={live.allowedTokens}
                mandatoryWindowResults={live.mandatoryWindowResults}
              />
            )}
            {activeTab === "events" && <EventLog entries={live.eventLog} />}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {live && live.leaderboard.length > 0 && (
        <div className="border-t border-black/10 px-4 py-2">
          <LeaderboardBar entries={live.leaderboard} viewerAgentId={viewer.agentId} />
        </div>
      )}
    </div>
  );
}

function MatchPhaseBar({ match, live }: { match: MatchView | null; live: ArenaSnapshot["live"] }) {
  if (!match) {
    return (
      <div className="px-4 py-2 border-b border-black/10 flex items-center justify-between">
        <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">No Active Match</span>
      </div>
    );
  }

  const status = live?.phase ?? match.status;
  const { text, color } = phaseLabel(status);
  const remaining = live?.remainingSeconds ?? 0;
  const elapsed = live?.elapsedSeconds ?? 0;

  return (
    <div className="px-4 py-2 border-b border-black/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`${color} text-[7px] font-bold text-white uppercase tracking-widest px-1.5 py-0.5 rounded`}>
            {text}
          </span>
          <span className="font-mono text-[9px] text-gray-400">
            {match.id.slice(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {live && (status === "warmup" || status.startsWith("opening") || status === "midgame" || status.startsWith("closing")) && (
            <span className={`font-display text-lg font-black tabular-nums ${remaining <= 30 ? "text-red-500" : "text-black"}`}>
              {fmtMmSs(remaining)}
            </span>
          )}
          <span className="text-[8px] font-mono text-gray-400">
            {elapsed > 0 ? `${fmtMmSs(elapsed)} elapsed` : ""}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1">
        <span className="text-[8px] font-mono text-gray-400">
          Wager: ${match.wagerUsd.toFixed(0)} · Capital: ${match.startingCapitalUsd.toFixed(0)}
        </span>
        {match.creator && (
          <span className="text-[8px] font-mono text-gray-400">
            {match.creator.userEnsName || shortAddr(match.creator.smartAccountAddress)}
            {match.opponent ? ` vs ${match.opponent.userEnsName || shortAddr(match.opponent.smartAccountAddress)}` : " vs ---"}
          </span>
        )}
      </div>
    </div>
  );
}

function TradeTape({ trades, viewerAgentId }: { trades: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["trades"]; viewerAgentId: string }) {
  if (trades.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-[9px] font-mono text-gray-400">No trades yet</span>
      </div>
    );
  }

  return (
    <div className="divide-y divide-black/5">
      {trades.map((trade) => {
        const isOwn = trade.agentId === viewerAgentId;
        return (
          <div
            key={trade.id}
            className={`px-3 py-1.5 ${isOwn ? "bg-gray-50" : "bg-transparent"}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`text-[6px] font-mono px-1 py-0.5 rounded font-bold uppercase ${isOwn ? "bg-artemis-red/10 text-artemis-red" : "bg-blue-100 text-blue-700"}`}>
                  {trade.seat}
                </span>
                <span className="text-[9px] font-mono text-black">
                  {shortAddr(trade.tokenIn)} → {shortAddr(trade.tokenOut)}
                </span>
                <span className={`text-[8px] font-bold ${trade.status === "accepted" ? "text-green-600" : "text-red-500"}`}>
                  {trade.status === "accepted" ? "FILLED" : "REJECTED"}
                </span>
              </div>
              <span className="text-[7px] font-mono text-gray-400">{fmtClock(trade.acceptedAt)}</span>
            </div>
            {trade.status === "accepted" && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[8px] font-mono text-gray-400">
                  {trade.quote?.routing ?? "---"}
                </span>
                {trade.quote?.gasFeeUsd != null && (
                  <span className="text-[8px] font-mono text-gray-400">
                    Gas: ${trade.quote.gasFeeUsd.toFixed(2)}
                  </span>
                )}
                {trade.quote?.priceImpactBps != null && (
                  <span className="text-[8px] font-mono text-gray-400">
                    Impact: {(trade.quote.priceImpactBps / 100).toFixed(2)}%
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PortfolioPanel({
  viewerPortfolio,
  opponentPortfolio,
  allowedTokens,
  mandatoryWindowResults,
}: {
  viewerPortfolio: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["viewerPortfolio"];
  opponentPortfolio: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["opponentPortfolio"];
  allowedTokens: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["allowedTokens"];
  mandatoryWindowResults: ArenaSnapshot["live"] extends null ? never : NonNullable<ArenaSnapshot["live"]>["mandatoryWindowResults"];
}) {
  return (
    <div className="p-3 space-y-3">
      <PortfolioCard label="Your Portfolio" portfolio={viewerPortfolio} />
      <PortfolioCard label="Opponent" portfolio={opponentPortfolio} />
      {mandatoryWindowResults.length > 0 && (
        <div>
          <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Mandatory Windows</span>
          {mandatoryWindowResults.map((w, i) => (
            <div key={i} className="flex items-center justify-between px-2 py-1 bg-gray-100 rounded text-[9px] font-mono">
              <span className="text-gray-500">{w.windowName === "opening_window" ? "Opening" : "Closing"}</span>
              <span className={w.completed ? "text-green-600" : "text-red-500"}>
                {w.completed ? "Completed" : `Penalty: $${w.penaltyUsd.toFixed(2)}`}
              </span>
            </div>
          ))}
        </div>
      )}
      {allowedTokens.length > 0 && (
        <div>
          <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
            Allowed Tokens ({allowedTokens.length})
          </span>
          <div className="flex flex-wrap gap-1">
            {allowedTokens.map((t) => (
              <span key={t.address} className="text-[7px] font-mono px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">
                {t.symbol} ({t.riskTier})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PortfolioCard({ label, portfolio }: { label: string; portfolio: { startingValueUsd: number; currentValueUsd: number; usdcBalanceUsd: number; totalPnlUsd: number; pnlPercent: number; penaltiesUsd: number; penaltyImpactUsd: number; netScoreUsd: number; netScorePercent: number; stale: boolean; balances: Array<{ tokenAddress: string; amountBaseUnits: string; symbol: string; valueUsd: number }> } | null }) {
  if (!portfolio) {
    return (
      <div className="bg-gray-100 rounded p-2">
        <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500">{label}</span>
        <p className="text-[9px] text-gray-400 mt-1">No valuation yet</p>
      </div>
    );
  }

  const pnlSign = (val: number) => val >= 0 ? "+" : "";
  const usdcFromBalances = portfolio.balances.find(
    (b) => b.symbol === "USDC",
  )?.valueUsd ?? 0;
  const usdc = portfolio.usdcBalanceUsd || usdcFromBalances;

  return (
    <div className={`bg-gray-100 rounded p-2 ${portfolio.stale ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500">{label}</span>
        {portfolio.stale && <span className="text-[7px] text-yellow-600 font-mono">STALE</span>}
      </div>
      {/* USDC CASH — the score */}
      <div className="mb-1.5 p-1.5 rounded bg-white ring-1 ring-artemis-red/20">
        <div className="flex items-center justify-between">
          <span className="text-[7px] font-bold uppercase tracking-widest text-artemis-red">USDC Cash</span>
          <span className="text-[7px] text-gray-400">= Score</span>
        </div>
        <span className="text-sm font-black font-mono text-black tabular-nums">${usdc.toFixed(2)}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <MetricRow label="Portfolio" value={`$${portfolio.currentValueUsd.toFixed(2)}`} />
        <MetricRow label="PnL" value={`${pnlSign(portfolio.totalPnlUsd)}$${portfolio.totalPnlUsd.toFixed(2)}`} color={pnlColor(portfolio.totalPnlUsd)} />
        <MetricRow label="Penalties" value={`-$${portfolio.penaltiesUsd.toFixed(2)}`} color={portfolio.penaltiesUsd > 0 ? "text-red-500" : undefined} />
      </div>
      {portfolio.balances.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {portfolio.balances.map((b) => (
            <div key={b.tokenAddress} className="flex items-center justify-between text-[8px] font-mono">
              <span className={`font-bold ${b.symbol === "USDC" ? "text-artemis-red" : "text-gray-500"}`}>{b.symbol || shortAddr(b.tokenAddress)}</span>
              <span className={b.symbol === "USDC" ? "text-artemis-red font-bold" : "text-black"}>{b.valueUsd > 0 ? `$${b.valueUsd.toFixed(2)}` : "---"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[8px] text-gray-400 font-mono">{label}</span>
      <span className={`text-[9px] font-bold font-mono ${color ?? "text-black"}`}>{value}</span>
    </div>
  );
}

function EventLog({ entries }: { entries: Array<{ id: string; eventType: string; payload: Record<string, unknown>; createdAt: string }> }) {
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-[9px] font-mono text-gray-400">No events yet</span>
      </div>
    );
  }
  return (
    <div className="divide-y divide-black/5">
      {entries.map((e) => (
        <div key={e.id} className="px-3 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-bold uppercase tracking-wider text-black">{e.eventType}</span>
            <span className="text-[7px] font-mono text-gray-400">{fmtClock(e.createdAt)}</span>
          </div>
          {Object.keys(e.payload).length > 0 && (
            <pre className="text-[7px] font-mono text-gray-400 mt-0.5 overflow-x-auto">
              {JSON.stringify(e.payload, null, 1)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function LeaderboardBar({ entries, viewerAgentId }: { entries: Array<{ rank: number; agentId: string; seat: string; usdcBalanceUsd: number; netScorePercent: number; netScoreUsd: number; totalPnlUsd: number; penaltiesUsd: number }>; viewerAgentId: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500">Rank</span>
      {entries.map((e) => {
        const netUsdc = e.usdcBalanceUsd - e.penaltiesUsd;
        return (
          <div
            key={e.agentId}
            className={`flex items-center gap-2 px-2 py-1 rounded ${
              e.agentId === viewerAgentId ? "bg-artemis-red/10" : "bg-gray-100"
            }`}
          >
            <span className="text-[9px] font-black text-black">#{e.rank}</span>
            <span className="text-[9px] font-black font-mono text-artemis-red tabular-nums">
              ${netUsdc.toFixed(2)} USDC
            </span>
            {e.penaltiesUsd > 0 && (
              <span className="text-[7px] font-mono text-red-500">-${e.penaltiesUsd.toFixed(2)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
