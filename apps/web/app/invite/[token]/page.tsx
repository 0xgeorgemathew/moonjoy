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
  creatorEnsName: string | null;
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
    queueMicrotask(() => {
      void fetchInvite();
    });
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
      const body = (await res.json()) as { matchId?: string; status?: string; redirectPath?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? "Failed to join invite.");
        return;
      }
      if (body.matchId) {
        router.push(body.redirectPath ?? "/match");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join invite.");
    } finally {
      setJoining(false);
    }
  };

  if (!ready || loading) {
    return (
      <main className="flex-1 flex items-center justify-center px-4">
        <div
          className="p-8 text-center"
          style={{
            background: "#fff",
            border: "5px solid #000",
            borderRadius: "20px",
            boxShadow: "12px 12px 0 0 #1565C0",
          }}
        >
          <div className="flex items-center gap-3 justify-center">
            <span className="font-display text-lg font-black uppercase tracking-tight text-black">
              Syncing
            </span>
            <span className="inline-block w-2 h-2 rounded-full bg-artemis-red animate-pulse-dot" />
          </div>
        </div>
      </main>
    );
  }

  if (error && !invite) {
    return (
      <main className="flex-1 flex items-center justify-center px-4">
        <div
          className="p-8 text-center max-w-md w-full"
          style={{
            background: "#fff",
            border: "5px solid #000",
            borderRadius: "20px",
            boxShadow: "12px 12px 0 0 #1565C0",
          }}
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: "10px",
                background: "#E53935",
                border: "3px solid #000",
                boxShadow: "3px 3px 0 0 #1565C0",
                color: "#fff",
                fontFamily: "var(--font-display)",
                fontSize: "16px",
                fontWeight: 900,
              }}
            >
              !
            </span>
            <span className="font-display text-xl font-black uppercase tracking-tight text-black">
              Error
            </span>
          </div>
          <p className="font-body text-sm text-[var(--artemis-charcoal)]">{error}</p>
        </div>
      </main>
    );
  }

  if (!invite) return null;

  const fmtDuration = (s: number): string => {
    const m = Math.floor(s / 60);
    return m < 2 ? `${s}s` : `${m}m`;
  };

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-8">
      <div
        className="w-full max-w-md animate-challenge-modal-enter"
        style={{
          background: "#fff",
          border: "5px solid #000",
          borderRadius: "20px",
          boxShadow: "12px 12px 0 0 #1565C0",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "3px solid #000" }}
        >
          <div className="flex items-center gap-3">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: "10px",
                background: "#E53935",
                border: "3px solid #000",
                boxShadow: "3px 3px 0 0 #1565C0",
                color: "#fff",
                fontFamily: "var(--font-display)",
                fontSize: "16px",
                fontWeight: 900,
              }}
            >
              VS
            </span>
            <div>
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "20px",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "-0.02em",
                  color: "#000",
                  lineHeight: 1,
                }}
              >
                Match Invite
              </h1>
              <span
                style={{
                  fontFamily: "var(--font-label)",
                  fontSize: "10px",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                  color: "#455A64",
                }}
              >
                {invite.scopeType === "ens" ? "ENS-Scoped" : "Open Challenge"}
              </span>
            </div>
          </div>
          <span
            style={{
              fontFamily: "var(--font-label)",
              fontSize: "9px",
              fontWeight: 900,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "4px 12px",
              border: "2px solid #000",
              borderRadius: "99px",
              boxShadow: "2px 2px 0 0 #1565C0",
              ...(invite.status === "open"
                ? { background: "#fff", color: "#000" }
                : invite.status === "joined"
                  ? { background: "#1565C0", color: "#fff" }
                  : { background: "#E53935", color: "#fff" }),
            }}
          >
            {invite.status}
          </span>
        </div>

        {/* Challenger */}
        {invite.creatorEnsName && (
          <div
            className="flex items-center gap-3 px-6 py-4"
            style={{ borderBottom: "3px solid #000", background: "#fafaf8" }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: "8px",
                background: "#000",
                border: "2px solid #000",
                color: "#fff",
                fontFamily: "var(--font-label)",
                fontSize: "12px",
                fontWeight: 900,
                letterSpacing: "0.05em",
              }}
            >
              {(invite.creatorEnsName.split(".")[0] ?? "?").slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <span
                style={{
                  fontFamily: "var(--font-label)",
                  fontSize: "9px",
                  fontWeight: 900,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "#455A64",
                  display: "block",
                }}
              >
                Challenger
              </span>
              <span
                className="block truncate"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "15px",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "-0.01em",
                  color: "#000",
                  lineHeight: 1.3,
                }}
              >
                {invite.creatorEnsName}
              </span>
            </div>
          </div>
        )}

        {/* Match Terms */}
        <div
          className="px-6 py-5"
          style={{ borderBottom: "3px dashed #455A64", opacity: 0.8 }}
        >
          <span
            style={{
              fontFamily: "var(--font-label)",
              fontSize: "9px",
              fontWeight: 900,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#455A64",
              display: "block",
              marginBottom: "10px",
            }}
          >
            Match Terms
          </span>
          <div className="flex items-center gap-3 flex-wrap">
            <TermChip label="Wager" value={`$${invite.wagerUsd}`} accent />
            <TermChip label="Duration" value={fmtDuration(invite.durationSeconds)} />
            <TermChip label="Warmup" value={`${invite.warmupSeconds}s`} />
          </div>
          {invite.scopeType === "ens" && invite.scopedEnsName && (
            <div className="mt-3">
              <TermChip label="ENS" value={invite.scopedEnsName} accent />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            className="px-6 py-3"
            style={{ background: "#FFF0F0", borderBottom: "3px solid #000" }}
          >
            <span style={{ fontFamily: "var(--font-label)", fontSize: "12px", fontWeight: 800, color: "#E53935" }}>
              {error}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="px-6 py-5">
          {invite.status === "open" && (
            <>
              {!authenticated ? (
                <button
                  type="button"
                  onClick={() => void login()}
                  className="neo-btn w-full py-4"
                  style={{
                    fontSize: "16px",
                    letterSpacing: "0.12em",
                  }}
                >
                  Connect to Join
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleJoin()}
                  disabled={joining}
                  className="neo-btn w-full py-4"
                  style={{
                    fontSize: "16px",
                    letterSpacing: "0.12em",
                    opacity: joining ? 0.4 : 1,
                    cursor: joining ? "not-allowed" : "pointer",
                  }}
                >
                  {joining ? "Joining..." : "Accept Challenge"}
                </button>
              )}
            </>
          )}

          {invite.status === "joined" && (
            <div className="text-center py-2">
              <span
                className="font-display text-base font-black uppercase tracking-tight"
                style={{ color: "#1565C0" }}
              >
                Accepted
              </span>
              <p className="font-body text-sm text-[var(--artemis-charcoal)] mt-1">
                Redirecting to match...
              </p>
            </div>
          )}

          {(invite.status === "expired" || invite.status === "revoked") && (
            <div className="text-center py-2">
              <span
                className="font-display text-base font-black uppercase tracking-tight"
                style={{ color: "#E53935" }}
              >
                {invite.status === "expired" ? "Expired" : "Revoked"}
              </span>
              <p className="font-body text-sm text-[var(--artemis-charcoal)] mt-1">
                This invite is no longer available.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function TermChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 16px",
        border: "2px solid #000",
        borderRadius: "10px",
        background: accent ? "#E53935" : "#fff",
        color: accent ? "#fff" : "#000",
        boxShadow: "3px 3px 0 0 #1565C0",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "20px",
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: "var(--font-label)",
          fontSize: "8px",
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          marginTop: "4px",
          opacity: 0.7,
        }}
      >
        {label}
      </span>
    </div>
  );
}
