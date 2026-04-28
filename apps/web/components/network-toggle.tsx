"use client";

import { useNetwork } from "@/lib/hooks/use-network";

export function NetworkToggle() {
	const { isTestnet, toggle } = useNetwork();

	return (
		<button
			type="button"
			onClick={toggle}
			className={`inline-flex items-center gap-1.5 rounded-full border-2 border-black px-3 py-1 font-label text-[10px] font-bold uppercase tracking-wider transition-all ${
				isTestnet
					? "bg-amber-400 text-black shadow-[2px_2px_0_0_#1565C0]"
					: "bg-artemis-red text-white shadow-[2px_2px_0_0_#1565C0]"
			}`}
		>
			<span className={`inline-block h-1.5 w-1.5 rounded-full ${isTestnet ? "bg-black" : "bg-white"}`} />
			{isTestnet ? "Testnet" : "Mainnet"}
		</button>
	);
}
