"use client";

import { useEffect, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import type { InviteScopeType } from "@/lib/services/invite-service";

type InviteData = {
  id: string;
  inviteToken: string;
  scopeType: InviteScopeType;
  scopedEnsName: string | null;
  wagerUsd: number;
  durationSeconds: number;
  warmupSeconds: number;
  status: string;
  createdAt: string;
  expiresAt: string | null;
};

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then((p) => setToken(p.token));
  }, [params]);

  const fetchInvite = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/invites/${token}`);
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Invite not found.");
        return;
      }
      const data = (await res.json()) as InviteData;
      setInvite(data);
    } catch {
      setError("Failed to load invite.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchInvite();
  }, [fetchInvite]);

  const handleJoin = async () => {
    if (!token) return;
    setJoining(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Authentication required.");
        return;
      }
      const res = await fetch(`/api/invites/${token}/join`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      const body = (await res.json()) as { matchId?: string; status?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? "Failed to join invite.");
        return;
      }
      if (body.matchId) {
        router.push("/?arena=1");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join invite.");
    } finally {
      setJoining(false);
    }
  };

  if (!ready || loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-surface px-4">
        <div className="neu-convex p-8 text-center">
          <span className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">Loading invite...</span>
        </div>
      </main>
    );
  }

  if (error && !invite) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-surface px-4">
        <div className="neu-convex p-8 text-center max-w-md">
          <h2 className="font-display text-lg font-black uppercase tracking-tight text-red-400 mb-2">Invite Error</h2>
          <p className="text-sm text-on-surface-variant">{error}</p>
        </div>
      </main>
    );
  }

  if (!invite) return null;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-surface px-4">
      <div className="neu-convex p-8 max-w-md w-full">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-lg font-black uppercase tracking-tight text-on-surface">Match Invite</h1>
          <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded ${
            invite.status === "open"
              ? "bg-green-900/30 text-green-400"
              : invite.status === "joined"
                ? "bg-blue-900/30 text-blue-400"
                : "bg-red-900/30 text-red-400"
          }`}>
            {invite.status}
          </span>
        </div>

        <div className="space-y-2 mb-6">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-on-surface-variant uppercase">Wager</span>
            <span className="text-sm font-bold text-on-surface">${invite.wagerUsd}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-on-surface-variant uppercase">Duration</span>
            <span className="text-sm font-bold text-on-surface">{invite.durationSeconds / 60}m</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-on-surface-variant uppercase">Warmup</span>
            <span className="text-sm font-bold text-on-surface">{invite.warmupSeconds}s</span>
          </div>
          {invite.scopeType === "ens" && invite.scopedEnsName && (
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-on-surface-variant uppercase">ENS Scope</span>
              <span className="text-sm font-bold text-primary">{invite.scopedEnsName}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-on-surface-variant uppercase">Scope</span>
            <span className="text-sm font-bold text-on-surface">{invite.scopeType === "ens" ? "ENS-Scoped" : "Open"}</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 rounded px-3 py-2 mb-4">
            <p className="text-[10px] font-mono text-red-400">{error}</p>
          </div>
        )}

        {invite.status === "open" && (
          <>
            {!authenticated ? (
              <button
                type="button"
                onClick={() => void login()}
                className="neo-btn w-full py-3 text-xs"
              >
                Connect to Join
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleJoin()}
                disabled={joining}
                className="neo-btn w-full py-3 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {joining ? "Joining..." : "Accept Invite & Start Match"}
              </button>
            )}
          </>
        )}

        {invite.status === "joined" && (
          <p className="text-sm text-center text-on-surface-variant">
            This invite has been accepted. Redirecting...
          </p>
        )}

        {(invite.status === "expired" || invite.status === "revoked") && (
          <p className="text-sm text-center text-red-400">
            This invite is no longer available.
          </p>
        )}
      </div>
    </main>
  );
}
