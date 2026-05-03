"use client";

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSearchParams } from "next/navigation";
import { LandingNav } from "@/components/landing-nav";
import { LandingCta } from "@/components/landing-cta";
import { LandingProfile } from "@/components/landing-profile";
import { LandingSettings } from "@/components/landing-settings";
import { ArenaPanel } from "@/components/arena-panel";
import { NetworkToggle } from "@/components/network-toggle";
import { ChallengeModal } from "@/components/challenge-modal";
import { useAuthState } from "@/lib/hooks/use-auth-state";
import { useUserEnsStatus } from "@/lib/hooks/use-user-ens-status";

type ViewType = "hero" | "match" | "profile" | "settings";

export function LandingHeroPanel() {
  const { authenticated, getAccessToken } = usePrivy();
  const { embeddedAddress, smartAccountAddress } = useAuthState();
  const searchParams = useSearchParams();
  const [activeView, setActiveView] = useState<ViewType>("hero");
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const { accessToken, ensStatus, loading: ensLoading } =
    useUserEnsStatus(authenticated);

  useEffect(() => {
    if (searchParams.get("arena") === "1" || searchParams.get("match") === "1") {
      queueMicrotask(() => setActiveView("match"));
    }
  }, [searchParams]);
  const shellViewClass =
    "animate-fade-in-up relative flex min-h-[28rem] min-w-0 flex-1 flex-col overflow-hidden sm:min-h-[32rem] lg:h-full lg:min-h-0";

  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const handleChallenge = async (opts: {
    scopeType: "open" | "ens";
    scopedEnsName?: string;
    startingCapitalUsd: number;
  }) => {
    setChallengeLoading(true);
    setChallengeError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Missing access token.");
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType: opts.scopeType,
          scopedEnsName: opts.scopedEnsName,
          startingCapitalUsd: opts.startingCapitalUsd,
        }),
      });
      const body = await res.json() as { error?: string; inviteLink?: string };
      if (!res.ok) throw new Error(body && typeof body === "object" && "error" in body ? body.error : "Create failed.");
      if (body.inviteLink) {
        setInviteLink(body.inviteLink);
      }
      setChallengeOpen(false);
      setActiveView("match");
    } catch (err) {
      setChallengeError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setChallengeLoading(false);
    }
  };

  return (
    <div className="relative z-20 flex min-h-full items-start justify-center pt-[14vh] px-2 sm:px-4 lg:pt-[10vh] lg:px-8">
      <div className="neo-panel flex w-full max-w-[90rem] flex-col overflow-hidden lg:h-[57rem] lg:flex-row">
        <LandingNav
          activeView={activeView}
          ensName={ensStatus?.userEnsName ?? null}
          ensLoading={ensLoading}
          onSettingsClick={() => setActiveView("settings")}
          onHomeClick={() => setActiveView("hero")}
          onProfileClick={() => setActiveView("profile")}
          onMatchClick={() => setActiveView("match")}
        />

        {activeView === "match" && authenticated ? (
          <div key="match" className={shellViewClass}>
            <ArenaPanel />
          </div>
        ) : activeView === "profile" && authenticated ? (
          <div key="profile" className={shellViewClass}>
            <LandingProfile
              accessToken={accessToken}
              ensLoading={ensLoading}
              ensStatus={ensStatus}
              embeddedAddress={embeddedAddress}
              smartAccountAddress={smartAccountAddress}
            />
          </div>
        ) : activeView === "settings" && authenticated ? (
          <div key="settings" className={shellViewClass}>
            <LandingSettings />
          </div>
        ) : (
          <div
            key="hero"
            className={`${shellViewClass} items-center justify-center p-5 sm:p-10 lg:px-14 lg:py-12`}
          >
            <NetworkToggle />

            <h1 className="overflow-hidden text-wrap-balance font-display text-[clamp(3.25rem,13vw,4.9rem)] font-black uppercase leading-none tracking-tighter text-black sm:text-[5.6rem] lg:text-[10.4rem]">
              MOON
              <div className="h-2 sm:h-3" />
              <span className="relative -mx-1 inline-block -rotate-[2deg] bg-artemis-red/90 px-4 py-1 text-white sm:-mx-3">
                JOY
              </span>
            </h1>

            <p className="mt-5 font-label text-lg uppercase leading-relaxed tracking-[0.18em] text-gray-700 sm:mt-8 sm:text-xl lg:text-2xl">
              Trade with agents. Crush rivals.
            </p>

            <div className="mt-6">
              <LandingCta />
            </div>

            {/* Quick Challenge — always visible on hero */}
            {authenticated && (
              <div className="mt-8 flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => setChallengeOpen(true)}
                  className="neo-btn px-8 py-3 text-base"
                  style={{ letterSpacing: "0.1em" }}
                >
                  Challenge
                </button>
                <span className="text-[10px] font-label font-bold uppercase tracking-widest text-artemis-charcoal/40">
                  $10 &middot; 5m &middot; choose capital
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <ChallengeModal
        open={challengeOpen}
        onClose={() => setChallengeOpen(false)}
        onSubmit={handleChallenge}
        loading={challengeLoading}
        error={challengeError}
      />
    </div>
  );
}
