export function LandingHeroPanel() {
  return (
    <div className="relative z-20 flex min-h-[100dvh] flex-col items-center justify-center px-6">
      <div className="neo-panel relative w-full max-w-sm -rotate-[0.7deg] p-8 sm:max-w-md sm:p-10">
        <h1 className="font-display text-7xl font-black uppercase leading-[0.85] tracking-tighter text-black sm:text-8xl">
          MOON
          <br />
          <span className="relative -mx-3 inline-block -rotate-[2deg] bg-neo-yellow/55 px-4 py-1">
            JOY
          </span>
        </h1>

        <p className="mt-5 font-label text-sm uppercase leading-relaxed tracking-[0.18em] text-gray-700 sm:text-[15px]">
          Trade tokens. Crush rivals.
          <br />
          <span className="mt-2 inline-block bg-black px-2.5 py-1 font-display text-[11px] font-extrabold uppercase tracking-widest text-white">
            TAKE THE POOL.
          </span>
        </p>

        <hr className="neo-divider my-6" />

        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <button
            type="button"
            disabled
            className="neo-btn flex flex-1 cursor-not-allowed items-center justify-center px-6 py-4 font-display text-base font-extrabold uppercase tracking-[0.15em] opacity-80 sm:text-lg"
          >
            Coming Soon
          </button>
        </div>
      </div>
    </div>
  )
}
