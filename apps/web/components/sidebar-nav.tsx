"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
		label: "Arena",
		href: "/match",
		matchPaths: ["/match", "/match/"],
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

function isActive(pathname: string, item: (typeof navItems)[number]) {
	if (item.matchPaths) {
		return item.matchPaths.some((p) => pathname.startsWith(p));
	}
	return pathname === item.href;
}

const hiddenPaths = ["/game"];

export function SidebarNav() {
	const pathname = usePathname();

	if (hiddenPaths.includes(pathname) || pathname.startsWith("/oauth")) {
		return null;
	}

	return (
		<nav className="flex h-full w-[72px] flex-col items-center gap-1 border-r border-black/10 bg-surface px-2 py-4 lg:w-[200px]">
			<div className="mb-6 font-display text-lg font-black uppercase tracking-tighter text-on-surface lg:text-xl">
				<span className="lg:inline hidden">Moon Joy</span>
				<span className="lg:hidden">MJ</span>
			</div>

			<div className="flex w-full flex-1 flex-col gap-1">
				{navItems.map((item) => {
					const active = isActive(pathname, item);
					return (
						<Link
							key={item.label}
							href={item.href}
							className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
								active
									? "bg-artemis-red text-white shadow-[3px_3px_0_0_#1565C0] border-2 border-black"
									: "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
							}`}
						>
							<span className="shrink-0">{item.icon}</span>
							<span className="hidden text-sm font-label font-semibold uppercase tracking-wider lg:block">
								{item.label}
							</span>
						</Link>
					);
				})}
			</div>
		</nav>
	);
}
