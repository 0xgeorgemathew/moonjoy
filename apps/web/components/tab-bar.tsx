"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
	{
		label: "HQ",
		href: "/",
		icon: (
			<svg
				viewBox="0 0 24 24"
				className="h-5 w-5"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
			</svg>
		),
	},
	{
		label: "Arena",
		href: "/match",
		matchPaths: ["/match", "/match/"],
		icon: (
			<svg
				viewBox="0 0 24 24"
				className="h-5 w-5"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
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
			<svg
				viewBox="0 0 24 24"
				className="h-5 w-5"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
			</svg>
		),
	},
];

function isActive(pathname: string, tab: (typeof tabs)[number]) {
	if (tab.matchPaths) {
		return tab.matchPaths.some((p) => pathname.startsWith(p));
	}
	return pathname === tab.href;
}

const hiddenPaths = ["/game"];

export function TabBar() {
	const pathname = usePathname();

	if (hiddenPaths.includes(pathname) || pathname.startsWith("/oauth")) {
		return null;
	}

	const activeStyle = "bg-artemis-red text-white font-extrabold shadow-[3px_3px_0_0_#1565C0] border-2 border-black -translate-y-0.5";
	const inactiveStyle = "text-gray-500 hover:text-black hover:bg-gray-100";

	return (
		<nav className="fixed bottom-0 left-0 right-0 z-50 bg-neo-card border-t-[4px] border-black shadow-[0_-6px_0_0_#1565C0]">
			<div className="mx-auto flex h-16 max-w-md items-center justify-around px-2 pb-[env(safe-area-inset-bottom)]">
				{tabs.map((tab) => {
					const active = isActive(pathname, tab);
					return (
						<Link
							key={tab.label}
							href={tab.href}
							className={`relative flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-xl px-3 transition-all ${active ? activeStyle : inactiveStyle}`}
						>
							{tab.icon}
							<span className={`font-label text-[9px] uppercase tracking-[0.18em] ${active ? "font-bold" : ""}`}>
								{tab.label}
							</span>
						</Link>
					);
				})}
			</div>
		</nav>
	);
}
