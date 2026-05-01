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
import { useUserEnsStatus } from "@/lib/hooks/use-user-ens-status";

type ViewType = "hero" | "arena" | "profile" | "settings";

export function LandingHeroPanel() {
  const { authenticated } = usePrivy();
  const searchParams = useSearchParams();
  const [activeView, setActiveView] = useState<ViewType>("hero");
  const { accessToken, ensStatus, loading: ensLoading } =
    useUserEnsStatus(authenticated);

  useEffect(() => {
    if (searchParams.get("arena") === "1") {
      setActiveView("arena");
    }
  }, [searchParams]);
  const shellViewClass =
    "animate-fade-in-up relative flex min-h-[28rem] min-w-0 flex-1 flex-col overflow-hidden sm:min-h-[32rem] lg:h-full lg:min-h-0";

  const networkToggle = (
    <div className="absolute right-2 top-4 z-10 sm:right-4">
      <NetworkToggle />
    </div>
  );

  return (
    <div className="relative z-20 flex min-h-full items-start justify-center pt-[18vh] px-2 sm:px-4 lg:pt-[14vh] lg:px-8">
      <div className="neo-panel flex w-full max-w-[70rem] flex-col overflow-hidden lg:h-[44rem] lg:flex-row">
        <LandingNav
          activeView={activeView}
          ensName={ensStatus?.userEnsName ?? null}
          ensLoading={ensLoading}
          onSettingsClick={() => setActiveView("settings")}
          onHomeClick={() => setActiveView("hero")}
          onProfileClick={() => setActiveView("profile")}
          onArenaClick={() => setActiveView("arena")}
        />

        {activeView === "arena" && authenticated ? (
          <div key="arena" className={shellViewClass}>
            {networkToggle}
            <ArenaPanel />
          </div>
        ) : activeView === "profile" && authenticated ? (
          <div key="profile" className={shellViewClass}>
            {networkToggle}
            <LandingProfile
              accessToken={accessToken}
              ensLoading={ensLoading}
              ensStatus={ensStatus}
            />
          </div>
        ) : activeView === "settings" && authenticated ? (
          <div key="settings" className={shellViewClass}>
            {networkToggle}
            <LandingSettings />
          </div>
        ) : (
          <div
            key="hero"
            className={`${shellViewClass} items-center justify-center p-5 sm:p-10 lg:px-14 lg:py-12`}
          >
            {networkToggle}

            <h1 className="overflow-hidden text-wrap-balance font-display text-[clamp(2.5rem,10vw,3.75rem)] font-black uppercase leading-none tracking-tighter text-black sm:text-7xl lg:text-8xl">
              MOON
              <div className="h-2 sm:h-3" />
              <span className="relative -mx-1 inline-block -rotate-[2deg] bg-artemis-red/90 px-4 py-1 text-white sm:-mx-3">
                JOY
              </span>
            </h1>

            <p className="mt-5 font-label text-sm uppercase leading-relaxed tracking-[0.18em] text-gray-700 sm:mt-8 sm:text-[15px]">
              Trade tokens. Crush rivals.
            </p>

            <div className="mt-6">
              <LandingCta />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
