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
		label: "Deploy",
		href: "/match/create",
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
		matchPaths: ["/match/"],
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

	return (
		<nav className="fixed bottom-0 left-0 right-0 z-50 bg-neo-card border-t-[4px] border-black shadow-[0_-6px_0_0_#000]">
			<div className="mx-auto flex h-16 max-w-md items-center justify-around px-2 pb-[env(safe-area-inset-bottom)]">
				{tabs.map((tab) => {
					const active = isActive(pathname, tab);
					return (
						<Link
							key={tab.label}
							href={tab.href}
							className={`relative flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-xl px-3 transition-all ${
								active
									? "bg-neo-yellow text-black font-extrabold shadow-[3px_3px_0_0_#000] border-2 border-black -translate-y-0.5"
									: "text-gray-500 hover:text-black hover:bg-gray-100"
							}`}
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
