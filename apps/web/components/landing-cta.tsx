"use client";

import { usePrivy } from "@privy-io/react-auth";

export function LandingCta() {
	const { ready, authenticated, login } = usePrivy();

	if (authenticated) return null;

	return (
		<button
			type="button"
			onClick={login}
			disabled={!ready}
			className="neo-btn px-8 py-4 font-display text-base font-extrabold uppercase tracking-[0.15em] disabled:cursor-not-allowed disabled:opacity-60"
		>
			{ready ? "Launch" : "Loading..."}
		</button>
	);
}
