"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { UserIdentityBlock } from "@/components/user-identity-block";

const opsIcon = (
	<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
	</svg>
);

const profileIcon = (
	<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
		<circle cx="12" cy="7" r="4" />
	</svg>
);

const hqIcon = (
	<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
	</svg>
);

const arenaIcon = (
	<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="10" />
		<circle cx="12" cy="12" r="6" />
		<circle cx="12" cy="12" r="2" />
	</svg>
);

type ViewType = "hero" | "arena" | "profile" | "settings";

export function LandingNav({ activeView, ensLoading, ensName, onSettingsClick, onHomeClick, onProfileClick, onArenaClick }: { activeView: ViewType; ensLoading: boolean; ensName: string | null; onSettingsClick: () => void; onHomeClick: () => void; onProfileClick: () => void; onArenaClick: () => void }) {
	const { authenticated } = usePrivy();

	const buttonClass = (isActive: boolean) =>
		`flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 transition-all ${
			isActive
				? "bg-artemis-red text-white shadow-[3px_3px_0_0_#1565C0] border-2 border-black font-bold"
				: "text-gray-500 hover:bg-gray-100 hover:text-black"
		}`;

			return (
				<aside className="flex min-w-0 shrink-0 flex-col items-center gap-0.5 overflow-x-auto border-b border-black/10 px-2 py-3 sm:gap-1 sm:px-3 sm:py-4 lg:w-[88px] lg:overflow-x-visible lg:self-stretch lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
				<UserIdentityBlock authenticated={authenticated} ensLoading={ensLoading} ensName={ensName} />

				<nav className="flex flex-col gap-0.5 sm:gap-1">
				{authenticated && (
					<button
						type="button"
						onClick={onProfileClick}
						className={buttonClass(activeView === "profile")}
					>
						{profileIcon}
						<span className="text-[9px] font-label font-semibold uppercase tracking-wider">
							Profile
						</span>
					</button>
				)}

				<button
					type="button"
					onClick={onHomeClick}
					className={buttonClass(activeView === "hero")}
				>
					{hqIcon}
					<span className="text-[9px] font-label font-semibold uppercase tracking-wider">
						HQ
					</span>
				</button>

				{authenticated && (
					<button
						type="button"
						onClick={onArenaClick}
						className={buttonClass(activeView === "arena")}
					>
						{arenaIcon}
						<span className="text-[9px] font-label font-semibold uppercase tracking-wider">
							Arena
						</span>
					</button>
				)}

				<Link
					href="/agents"
					className="flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-gray-500 transition-all hover:bg-gray-100 hover:text-black"
				>
					{opsIcon}
					<span className="text-[9px] font-label font-semibold uppercase tracking-wider">
						Ops
					</span>
				</Link>
			</nav>

			{authenticated && (
				<button
					type="button"
					onClick={onSettingsClick}
					className={buttonClass(activeView === "settings")}
				>
					<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
						<circle cx="12" cy="12" r="3" />
					</svg>
					<span className="text-[9px] font-label font-semibold uppercase tracking-wider">
						Settings
					</span>
				</button>
			)}
		</aside>
	);
}
