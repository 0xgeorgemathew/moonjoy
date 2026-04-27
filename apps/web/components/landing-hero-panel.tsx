import Link from "next/link";

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

export function LandingHeroPanel() {
	return (
		<div className="relative z-20 flex min-h-full items-start justify-center pt-[18vh] px-4 lg:pt-[14vh] lg:px-8">
			<div className="neo-panel flex w-full max-w-4xl flex-col overflow-hidden lg:flex-row">
				{/* Sidebar inside panel */}
				<aside className="flex shrink-0 flex-col items-center gap-1 border-b border-black/10 px-3 py-4 lg:w-[72px] lg:border-b-0 lg:border-r lg:px-2 lg:py-6">
					<div className="mb-3 font-display text-sm font-black uppercase tracking-tighter text-black">
						MJ
					</div>

					<nav className="flex flex-1 flex-col gap-1">
						{navItems.map((item) => (
							<Link
								key={item.label}
								href={item.href}
								className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 transition-all ${
									item.label === "HQ"
										? "bg-artemis-red text-white shadow-[3px_3px_0_0_#1565C0] border-2 border-black font-bold"
										: "text-gray-500 hover:bg-gray-100 hover:text-black"
								}`}
							>
								{item.icon}
								<span className="text-[9px] font-label font-semibold uppercase tracking-wider">
									{item.label}
								</span>
							</Link>
						))}
					</nav>
				</aside>

				{/* Main content */}
				<div className="flex flex-1 flex-col items-center justify-center p-8 sm:p-10">
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
						<button
							type="button"
							disabled
							className="neo-btn cursor-not-allowed px-8 py-4 font-display text-base font-extrabold uppercase tracking-[0.15em] opacity-80"
						>
							Coming Soon
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
