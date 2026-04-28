"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { LandingNav } from "@/components/landing-nav";
import { LandingCta } from "@/components/landing-cta";
import { LandingSettings } from "@/components/landing-settings";
import { NetworkToggle } from "@/components/network-toggle";

export function LandingHeroPanel() {
	const { authenticated } = usePrivy();
	const [activeView, setActiveView] = useState<"hero" | "settings">("hero");

	return (
		<div className="relative z-20 flex min-h-full items-start justify-center pt-[18vh] px-4 lg:pt-[14vh] lg:px-8">
			<div className="neo-panel flex w-full max-w-4xl flex-col overflow-hidden lg:flex-row">
				<LandingNav
					activeView={activeView}
					onSettingsClick={() => setActiveView("settings")}
					onHomeClick={() => setActiveView("hero")}
				/>

				{activeView === "settings" && authenticated ? (
					<div className="relative flex flex-1 flex-col">
						<div className="absolute right-4 top-4 z-10">
							<NetworkToggle />
						</div>
						<LandingSettings />
					</div>
				) : (
					<div className="relative flex flex-1 flex-col items-center justify-center p-8 sm:p-10">
						<div className="absolute right-4 top-4">
							<NetworkToggle />
						</div>

						<h1 className="font-display text-6xl font-black uppercase leading-none tracking-tighter text-black sm:text-7xl lg:text-8xl">
							MOON
							<div className="h-3" />
							<span className="relative -mx-3 inline-block -rotate-[2deg] bg-artemis-red/90 px-4 py-1 text-white">
								JOY
							</span>
						</h1>

						<p className="mt-8 font-label text-sm uppercase leading-relaxed tracking-[0.18em] text-gray-700 sm:text-[15px]">
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
