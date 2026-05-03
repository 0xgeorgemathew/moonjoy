import { EARTH_BOTTOM_RATIO, EARTH_LEFT_RATIO } from "@/lib/space-scene"

export function LandingEarth() {
  return (
    <div
      className="earth pointer-events-none absolute z-[3]"
      aria-hidden="true"
      style={{
        left: `${EARTH_LEFT_RATIO * 100}vw`,
        bottom: `${EARTH_BOTTOM_RATIO * 100}vh`,
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="earthOcean" cx="40%" cy="38%" r="55%">
            <stop offset="0%" stopColor="#7ec8e3" />
            <stop offset="40%" stopColor="#4a9bc7" />
            <stop offset="75%" stopColor="#2d6e97" />
            <stop offset="100%" stopColor="#1b4d72" />
          </radialGradient>
          <radialGradient id="earthAtmo" cx="50%" cy="50%" r="50%">
            <stop offset="70%" stopColor="transparent" />
            <stop offset="88%" stopColor="rgba(100,180,255,0.12)" />
            <stop offset="100%" stopColor="rgba(100,180,255,0.03)" />
          </radialGradient>
          <clipPath id="earthClip">
            <circle cx="20" cy="20" r="18" />
          </clipPath>
        </defs>
        <circle cx="20" cy="20" r="18" fill="url(#earthOcean)" />
        <g clipPath="url(#earthClip)">
          <ellipse cx="13" cy="13" rx="6" ry="7" fill="#5a9e4b" opacity="0.75" />
          <ellipse cx="10" cy="16" rx="3" ry="4" fill="#4d8a3f" opacity="0.6" />
          <ellipse cx="16" cy="26" rx="3" ry="5" fill="#5a9e4b" opacity="0.65" />
          <ellipse cx="23" cy="14" rx="3" ry="4" fill="#6aad58" opacity="0.55" />
          <ellipse cx="23" cy="24" rx="4" ry="5" fill="#5a9e4b" opacity="0.6" />
          <ellipse cx="31" cy="13" rx="5" ry="6" fill="#4d8a3f" opacity="0.5" />
          <ellipse cx="28" cy="18" rx="3" ry="3" fill="#6aad58" opacity="0.45" />
          <ellipse cx="20" cy="3" rx="10" ry="3" fill="#e8f0f8" opacity="0.35" />
          <ellipse cx="20" cy="37" rx="8" ry="2.5" fill="#e8f0f8" opacity="0.3" />
        </g>
        <circle cx="14" cy="14" r="10" fill="rgba(255,255,255,0.08)" />
        <circle cx="20" cy="20" r="18.5" fill="url(#earthAtmo)" />
      </svg>
    </div>
  )
}
