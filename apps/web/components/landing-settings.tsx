"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useAuthState } from "@/lib/hooks/use-auth-state";

export function LandingSettings() {
	const { logout } = usePrivy();
	const { setupStatus, onboardResult, error, embeddedAddress, smartAccountAddress } = useAuthState();

	const agent = onboardResult?.agent;

	return (
		<div className="flex flex-1 flex-col p-8 sm:p-10">
			<h2 className="font-display text-xl font-black uppercase tracking-tight text-black">
				Settings
			</h2>

			<div className="mt-4 space-y-3">
				{error && (
					<div className="rounded border-2 border-red-300 bg-red-50 px-3 py-2">
						<p className="font-body text-xs text-red-600">{error}</p>
					</div>
				)}

				{setupStatus === "loading" && (
					<p className="font-body text-sm text-gray-500">Initializing...</p>
				)}
				{setupStatus === "onboarding" && (
					<p className="font-body text-sm text-gray-500">Setting up agent...</p>
				)}

				{embeddedAddress && (
					<div>
						<span className="font-label text-[10px] uppercase tracking-wider text-gray-500">Embedded Signer</span>
						<p className="truncate font-mono text-xs text-black">{embeddedAddress}</p>
					</div>
				)}

				{smartAccountAddress && (
					<div>
						<span className="font-label text-[10px] uppercase tracking-wider text-gray-500">Smart Account</span>
						<p className="truncate font-mono text-xs text-black">{smartAccountAddress}</p>
					</div>
				)}

				{agent && (
					<div>
						<span className="font-label text-[10px] uppercase tracking-wider text-gray-500">Agent Status</span>
						<span className={`ml-2 font-display text-xs font-bold ${agent.setup_status === "wallet_created" ? "text-green-600" : "text-yellow-600"}`}>
							{agent.setup_status}
						</span>
					</div>
				)}

				{!embeddedAddress && !smartAccountAddress && !error && setupStatus === "complete" && (
					<p className="font-body text-sm text-gray-500">No wallet info available.</p>
				)}
			</div>

			<div className="mt-6 border-t border-black/10 pt-4">
				<button
					type="button"
					onClick={() => logout()}
					className="neo-btn-secondary px-6 py-2 font-display text-xs font-bold uppercase tracking-wider"
				>
					Logout
				</button>
			</div>
		</div>
	);
}
