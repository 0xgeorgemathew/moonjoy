"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { createClient } from "@/lib/supabase/client";
import type {
  ActiveMatchSnapshot,
  MatchView,
  OpenChallengeSnapshot,
} from "@/lib/types/match";

type DialogueMessage =
  | { type: "system"; text: string; ts: string }
  | { type: "challenge"; match: MatchView; isOwn: boolean; ts: string }
  | { type: "status"; text: string; accent: string; ts: string };

function nowTs(): string {
  return new Date().toISOString();
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function MatchArena() {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [supabase] = useState(() => createClient());
  const feedRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [activeMatch, setActiveMatch] = useState<MatchView | null>(null);
  const [viewerEns, setViewerEns] = useState<string | null>(null);
  const [agentTopic, setAgentTopic] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<Set<string>>(new Set());

  const addMsg = useCallback(
    (msg: DialogueMessage) => setMessages((prev) => [...prev, msg]),
    [],
  );

  const fetchJson = useCallback(
    async <T,>(url: string): Promise<T> => {
      const token = await getAccessToken();
      if (!token) throw new Error("Missing access token.");
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as T | { error?: string };
      if (!res.ok) {
        const errMsg =
          body && typeof body === "object" && "error" in body && body.error
            ? body.error
            : "Request failed.";
        throw new Error(errMsg);
      }
      return body as T;
    },
    [getAccessToken],
  );

  const loadOpenChallenges = useCallback(async () => {
    try {
      const snap = await fetchJson<OpenChallengeSnapshot>("/api/matches/open");
      setMessages((prev) => {
        const nonChallenge = prev.filter((m) => m.type !== "challenge");
        const challengeMsgs: DialogueMessage[] = snap.challenges.map((c) => ({
          type: "challenge" as const,
          match: c,
          isOwn: c.viewerSeat === "creator",
          ts: c.createdAt,
        }));
        return [...nonChallenge, ...challengeMsgs];
      });
    } catch {
      addMsg({ type: "system", text: "Failed to load open challenges.", ts: nowTs() });
    }
  }, [fetchJson, addMsg]);

  const refreshAll = useCallback(async () => {
    try {
      const snap = await fetchJson<ActiveMatchSnapshot>("/api/matches/active");
      setViewerEns(snap.viewer.userEnsName);
      setAgentTopic(snap.viewer.agentTopic);
      setActiveMatch(snap.activeMatch);

      if (snap.activeMatch) {
        const match = snap.activeMatch;
        setMessages((prev) => {
          const filtered = prev.filter(
            (m) =>
              !(m.type === "status" && m.text.includes("Challenge created")),
          );
          return [
            ...filtered,
            {
              type: "status",
              text: `Match ${match.id.slice(0, 8)} — ${match.status.toUpperCase()}`,
              accent: statusAccent(match.status),
              ts: nowTs(),
            },
          ];
        });
      } else {
        await loadOpenChallenges();
      }
    } catch {
      addMsg({ type: "system", text: "Failed to refresh state.", ts: nowTs() });
    } finally {
      setLoading(false);
    }
  }, [fetchJson, addMsg, loadOpenChallenges]);

  useEffect(() => {
    if (!ready || !authenticated) {
      queueMicrotask(() => setLoading(false));
      return;
    }

    setMessages([
      { type: "system", text: "Connecting to arena...", ts: nowTs() },
    ]);

    let cancelled = false;

    void (async () => {
      try {
        await refreshAll();
        if (!cancelled) {
          setConnected(true);
          setMessages((prev) => [
            ...prev,
            { type: "system", text: "Connected to arena feed.", ts: nowTs() },
          ]);
        }
      } catch {
        if (!cancelled) {
          addMsg({
            type: "system",
            text: "Connection error. Retrying...",
            ts: nowTs(),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addMsg, authenticated, ready, refreshAll]);

  useEffect(() => {
    if (!agentTopic) return;

    const channel = supabase
      .channel(agentTopic)
      .on("broadcast", { event: "match_state_changed" }, () => {
        void refreshAll();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [agentTopic, refreshAll, supabase]);

  useEffect(() => {
    if (!activeMatch?.id) return;

    const topic = `match:${activeMatch.id}`;
    const channel = supabase
      .channel(topic)
      .on("broadcast", { event: "match_state_changed" }, () => {
        void refreshAll();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeMatch?.id, refreshAll, supabase]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const match = await fetchJson<MatchView>("/api/matches");
      addMsg({
        type: "status",
        text: `Challenge created — $${match.wagerUsd.toFixed(2)} wager`,
        accent: "text-yellow-600",
        ts: nowTs(),
      });
      addMsg({
        type: "challenge",
        match,
        isOwn: true,
        ts: match.createdAt,
      });
    } catch (err) {
      addMsg({
        type: "system",
        text: `Challenge failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        ts: nowTs(),
      });
    } finally {
      setCreating(false);
    }
  };

  const handleAccept = async (matchId: string) => {
    setAccepting((prev) => new Set(prev).add(matchId));
    try {
      await fetchJson<MatchView>(`/api/matches/${matchId}/accept`);
      addMsg({
        type: "status",
        text: "Challenge accepted! Match starting...",
        accent: "text-green-600",
        ts: nowTs(),
      });
      await refreshAll();
    } catch (err) {
      addMsg({
        type: "system",
        text: `Accept failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        ts: nowTs(),
      });
      setAccepting((prev) => {
        const next = new Set(prev);
        next.delete(matchId);
        return next;
      });
    }
  };

  if (!ready || loading) {
    return (
      <DialogueShell>
        <div className="flex items-center gap-3 p-6 text-on-surface-variant">
          <span className="text-xs font-mono uppercase tracking-widest">
            Syncing arena...
          </span>
          <Dots />
        </div>
      </DialogueShell>
    );
  }

  if (!authenticated) {
    return (
      <DialogueShell>
        <div className="flex flex-col items-center gap-6 p-8">
          <p className="font-body text-sm text-on-surface-variant text-center max-w-sm">
            Connect your Moonjoy account to enter the arena.
          </p>
          <button
            type="button"
            onClick={() => void login()}
            className="neo-btn px-6 py-3 text-xs"
          >
            Connect to Watch
          </button>
        </div>
      </DialogueShell>
    );
  }

  const showCreate = !activeMatch;

  return (
    <DialogueShell
      header={
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-black">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-black uppercase tracking-tight text-black">
              Arena Feed
            </h2>
            <LiveIndicator connected={connected} />
          </div>
          {viewerEns && (
            <span className="font-mono text-[10px] text-gray-500 uppercase tracking-wider">
              {viewerEns}
            </span>
          )}
        </div>
      }
      footer={
        showCreate ? (
          <div className="border-t-2 border-black px-5 py-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="neo-btn px-5 py-2.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? "Broadcasting..." : "Issue Challenge"}
            </button>
            {creating && <Dots />}
          </div>
        ) : null
      }
    >
      <div ref={feedRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <EmptyState text="No arena activity yet. Issue a challenge to begin." />
        )}
        {messages.map((msg, i) => {
          const delay = `${i * 0.06}s`;
          if (msg.type === "system") {
            return (
              <SystemMessage key={`${msg.ts}-${i}`} text={msg.text} delay={delay} />
            );
          }
          if (msg.type === "status") {
            return (
              <StatusMessage
                key={`${msg.ts}-${i}`}
                text={msg.text}
                accent={msg.accent}
                delay={delay}
              />
            );
          }
          return (
            <ChallengeCard
              key={msg.match.id}
              match={msg.match}
              isOwn={msg.isOwn}
              delay={delay}
              accepting={accepting.has(msg.match.id)}
              onAccept={() => void handleAccept(msg.match.id)}
            />
          );
        })}
        {!activeMatch && messages.length > 0 && messages[messages.length - 1].type === "challenge" && (
          <div className="flex items-center gap-2 px-2 py-2 opacity-50">
            <Dots />
            <span className="font-mono text-[10px] text-gray-500 uppercase tracking-wider">
              Waiting for opponent
            </span>
          </div>
        )}
      </div>
    </DialogueShell>
  );
}

function statusAccent(status: string): string {
  switch (status) {
    case "created":
      return "text-yellow-600";
    case "warmup":
      return "text-blue-700";
    case "live":
      return "text-green-700";
    case "settling":
      return "text-orange-700";
    case "settled":
      return "text-black";
    default:
      return "text-gray-600";
  }
}

function DialogueShell({
  header,
  footer,
  children,
}: {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-[100dvh] flex-1 items-center justify-center bg-surface px-4 py-8">
      <section className="neo-panel flex w-full max-w-2xl flex-col overflow-hidden" style={{ minHeight: "75dvh" }}>
        {header}
        {children}
        {footer}
      </section>
    </main>
  );
}

function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`arena-status-dot ${
          connected ? "arena-status-dot-connected" : "arena-status-dot-disconnected"
        }`}
      />
      <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-gray-500">
        {connected ? "Live" : "Offline"}
      </span>
    </div>
  );
}

function SystemMessage({ text, delay }: { text: string; delay: string }) {
  return (
    <div
      className="animate-msg-enter opacity-0 px-2 py-1.5"
      style={{ animationDelay: delay }}
    >
      <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">
        {text}
      </span>
    </div>
  );
}

function StatusMessage({
  text,
  accent,
  delay,
}: {
  text: string;
  accent: string;
  delay: string;
}) {
  return (
    <div
      className="animate-msg-enter opacity-0 flex items-center gap-2 px-2 py-1.5"
      style={{ animationDelay: delay }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      <span className={`font-label text-xs font-bold uppercase tracking-wider ${accent}`}>
        {text}
      </span>
    </div>
  );
}

function ChallengeCard({
  match,
  isOwn,
  delay,
  accepting,
  onAccept,
}: {
  match: MatchView;
  isOwn: boolean;
  delay: string;
  accepting: boolean;
  onAccept: () => void;
}) {
  return (
    <div
      className={`animate-msg-enter animate-challenge-pulse neo-card opacity-0 p-4 ${
        accepting ? "animate-accept-flash" : ""
      }`}
      style={{ animationDelay: delay }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="neo-badge text-[8px] px-2 py-0.5">
              Challenge
            </span>
            <span className="font-mono text-[10px] text-gray-500">
              {fmtTime(match.createdAt)}
            </span>
          </div>
          <p className="mt-2 font-display text-base font-black uppercase text-black leading-tight truncate">
            {match.creator.userEnsName}
          </p>
          <p className="mt-1 font-body text-xs text-gray-600">
            Wager: ${match.wagerUsd.toFixed(2)} · Capital: ${match.startingCapitalUsd.toFixed(2)}
          </p>
        </div>

        {isOwn ? (
          <span className="flex-shrink-0 neo-badge text-[8px] px-2 py-0.5 whitespace-nowrap" style={{ background: "var(--artemis-blue-light)" }}>
            Yours
          </span>
        ) : accepting ? (
          <span className="flex-shrink-0 neo-badge text-[8px] px-2 py-0.5 whitespace-nowrap" style={{ background: "#43a047", color: "#fff" }}>
            Accepted
          </span>
        ) : (
          <button
            type="button"
            onClick={onAccept}
            className="flex-shrink-0 neo-btn px-4 py-2 text-[10px]"
          >
            Accept
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3 font-mono text-[9px] text-gray-400 uppercase tracking-wider">
        <span>Agent: {match.creator.agentEnsName}</span>
        <span>·</span>
        <span>{match.warmupDurationSeconds}s warmup</span>
        <span>·</span>
        <span>{match.liveDurationSeconds}s live</span>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-16 px-4">
      <p className="font-body text-sm text-gray-500 text-center max-w-xs">
        {text}
      </p>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1 w-1 rounded-full bg-current opacity-20"
          style={{
            animation: "typing-dots 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </span>
  );
}
