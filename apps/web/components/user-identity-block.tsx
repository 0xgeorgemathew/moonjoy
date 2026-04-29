"use client";

import { extractEnsLabel } from "@/lib/types/ens";

export function UserIdentityBlock({ authenticated, ensLoading, ensName }: { authenticated: boolean; ensLoading: boolean; ensName: string | null }) {

	if (!authenticated) return null;

	if (ensLoading) {
		return (
			<div className="mb-2 flex shrink-0 items-center justify-center sm:mb-3">
				<div className="h-2 w-2 animate-pulse rounded-full bg-artemis-charcoal" />
			</div>
		);
	}

	if (ensName) {
		const label = extractEnsLabel(ensName);
		return (
			<div className="mb-2 flex shrink-0 flex-col items-center sm:mb-3">
				<p className="font-display text-sm font-black uppercase tracking-tighter text-black">
					{label}
				</p>
				<p className="font-mono text-[10px] text-gray-400">.moonjoy.eth</p>
			</div>
		);
	}

	return (
		<div className="mb-2 flex shrink-0 flex-col items-center gap-0.5 sm:mb-3">
			<svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
				<circle cx="12" cy="7" r="4" />
			</svg>
			<span className="font-label text-[9px] uppercase tracking-wider text-gray-400">
				no name yet
			</span>
		</div>
	);
}
