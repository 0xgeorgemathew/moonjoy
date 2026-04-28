"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";

const navItems = [
	{
		label: "HQ",
		href: "/",
		icon: (
			<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
			</svg>
		),
	},
	{
		label: "Deploy",
		href: "/match/create",
		icon: (
			<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
				<path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
				<path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
				<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
			</svg>
		),
	},
	{
		label: "Active",
		href: "/match",
		icon: (
			<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<circle cx="12" cy="12" r="10" />
				<circle cx="12" cy="12" r="6" />
				<circle cx="12" cy="12" r="2" />
			</svg>
		),
	},
	{
		label: "Ops",
		href: "/agents",
		icon: (
			<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
			</svg>
		),
	},
];

export function LandingNav({ activeView, onSettingsClick, onHomeClick }: { activeView: string; onSettingsClick: () => void; onHomeClick: () => void }) {
	const { authenticated } = usePrivy();

	return (
		<aside className="flex shrink-0 flex-col items-center gap-1 border-b border-black/10 px-3 py-4 lg:w-[72px] lg:border-b-0 lg:border-r lg:px-2 lg:py-6">
			<div className="mb-3 font-display text-sm font-black uppercase tracking-tighter text-black">
				MJ
			</div>

			<nav className="flex flex-1 flex-col gap-1">
				{navItems.map((item) => (
					item.label === "HQ" ? (
						<button
							key={item.label}
							type="button"
							onClick={onHomeClick}
							className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 transition-all ${
								activeView === "hero"
									? "bg-artemis-red text-white shadow-[3px_3px_0_0_#1565C0] border-2 border-black font-bold"
									: "text-gray-500 hover:bg-gray-100 hover:text-black"
							}`}
						>
							{item.icon}
							<span className="text-[9px] font-label font-semibold uppercase tracking-wider">
								{item.label}
							</span>
						</button>
					) : (
						<Link
							key={item.label}
							href={item.href}
							className="flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-gray-500 transition-all hover:bg-gray-100 hover:text-black"
						>
							{item.icon}
							<span className="text-[9px] font-label font-semibold uppercase tracking-wider">
								{item.label}
							</span>
						</Link>
					)
				))}
			</nav>

			{authenticated && (
				<button
					type="button"
					onClick={onSettingsClick}
					className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 transition-all ${
						activeView === "settings"
							? "bg-artemis-red text-white shadow-[3px_3px_0_0_#1565C0] border-2 border-black font-bold"
							: "text-gray-500 hover:bg-gray-100 hover:text-black"
					}`}
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
