import type { RefObject } from "react"

type SpaceshipSvgProps = {
  flameRef: RefObject<SVGGElement | null>
  prefersReducedMotion: boolean
  size: number
}

/**
 * Detailed inline SVG of an Artemis II / Orion-style crew capsule with four
 * solar panel arrays (3 segments each) swept toward the burn direction, one
 * service module cylinder, a compact AJ10-style engine nozzle, and an animated
 * engine flame.
 *
 * Geometry corrected to match real Artemis II Orion proportions:
 *   ‣ Crew Module: 57.5° frustum, apex ~16 % of base width
 *   ‣ CM height : CM base = 0.66
 *   ‣ CM : SM height = 0.82
 *   ‣ SM body ≈ 93 % of CM base width
 *   ‣ Solar wings: 3-panel, ~1.4× SM width per wing
 *   ‣ AJ10-190 nozzle: compact — ~25 % of SM height
 *   ‣ Adapter ring: slim transition, ~6 % of body height
 *
 * During coast phases the craft performs a slow Passive Thermal Control (PTC)
 * "barbecue roll" — simulated via the `.ptc-roll` CSS animation.
 * Flame visibility is driven by the parent animation loop.
 */
export default function SpaceshipSvg({
  flameRef,
  prefersReducedMotion,
  size,
}: SpaceshipSvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-2 -1 26 25"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="spaceship-svg"
    >
      <defs>
        <radialGradient id="engineGlowShip" cx="50%" cy="10%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="20%" stopColor="#fffae0" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#ffcc44" stopOpacity="0.45" />
          <stop offset="80%" stopColor="#ff8800" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#ff4400" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="crewShellGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#7a8290" />
          <stop offset="18%" stopColor="#b8bfc9" />
          <stop offset="35%" stopColor="#e8ecf0" />
          <stop offset="45%" stopColor="#f8f9fb" />
          <stop offset="50%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#f0f2f5" />
          <stop offset="68%" stopColor="#c8cdd4" />
          <stop offset="85%" stopColor="#9ea5af" />
          <stop offset="100%" stopColor="#6e757f" />
        </linearGradient>
        <linearGradient id="foilHighlight" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="38%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="52%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="58%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="foilEdge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="15%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="85%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#eef1f5" />
          <stop offset="55%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d8dde4" />
        </linearGradient>
        <linearGradient id="svcGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ebedf1" />
          <stop offset="50%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#c7cdd6" />
        </linearGradient>
        <linearGradient id="arrayPanelGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#12151c" />
          <stop offset="55%" stopColor="#232936" />
          <stop offset="100%" stopColor="#080b10" />
        </linearGradient>
        <linearGradient id="arrayFrameGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8e97a4" />
          <stop offset="100%" stopColor="#5d6774" />
        </linearGradient>
        <radialGradient id="windowGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff4d6" stopOpacity="1" />
          <stop offset="40%" stopColor="#ffcc66" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ff9933" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="engineBellGrad" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#a8b0ba" />
          <stop offset="35%" stopColor="#7a838f" />
          <stop offset="70%" stopColor="#5c6570" />
          <stop offset="100%" stopColor="#3d444d" />
        </linearGradient>
        {/* Inner wall gradient for nozzle depth */}
        <linearGradient id="nozzleInnerGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4a5260" />
          <stop offset="50%" stopColor="#6b7480" />
          <stop offset="100%" stopColor="#3a4048" />
        </linearGradient>
        <linearGradient id="metalGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e2e6eb" />
          <stop offset="40%" stopColor="#9ea6b1" />
          <stop offset="100%" stopColor="#f3f5f8" />
        </linearGradient>

        {/*
          Solar wing — strut + 3 panel segments, defined pointing right.
          Three segments per wing matches the real ESM X-wing arrays.
          Rotation center = SM center at (11, 10.1).
        */}
        <g id="solarWing">
          {/* Strut arm */}
          <path d="M14.25 10.1 H15.45" stroke="#79828e" strokeWidth="0.26" strokeLinecap="round" />
          {/* Panel segment 1 */}
          <rect x="15.45" y="9.1" width="2.6" height="2.0" rx="0.04" fill="url(#arrayPanelGrad)" stroke="url(#arrayFrameGrad)" strokeWidth="0.12" />
          {/* Panel segment 2 */}
          <rect x="18.05" y="9.1" width="2.6" height="2.0" rx="0.04" fill="url(#arrayPanelGrad)" stroke="url(#arrayFrameGrad)" strokeWidth="0.12" />
          {/* Panel segment 3 */}
          <rect x="20.65" y="9.1" width="2.6" height="2.0" rx="0.04" fill="url(#arrayPanelGrad)" stroke="url(#arrayFrameGrad)" strokeWidth="0.12" />
          {/* Horizontal cell wires */}
          <path d="M15.7 9.6 H23.05 M15.7 10.1 H23.05 M15.7 10.6 H23.05" stroke="#55606e" strokeWidth="0.06" opacity="0.5" />
          {/* Vertical cell dividers — between panel segments */}
          <path d="M18.05 9.22 V10.98 M20.65 9.22 V10.98" stroke="#8f2a2a" strokeWidth="0.05" opacity="0.6" />
        </g>
      </defs>

      {/* Back pair — rendered behind the spacecraft body for depth */}
      <g opacity="0.98">
        <use href="#solarWing" transform="rotate(60 11 10.1)" />
        <use href="#solarWing" transform="rotate(120 11 10.1)" />
      </g>

      {/* ── Crew capsule (57.5° frustum cone) ──
           Apex width ~16 % of base width (real Orion docking adapter).
           Top: 10.42 → 11.58 (1.16 wide)
           Base: 7.5 → 14.5 (7.0 wide)
           Height: 4.6 units
      */}
      <path
        d="M10.42 1.0 Q8.8 3.3 7.5 5.6 H14.5 Q13.2 3.3 11.58 1.0 Z"
        fill="url(#crewShellGrad)"
      />
      <path
        d="M10.42 1.0 Q8.8 3.3 7.5 5.6 H14.5 Q13.2 3.3 11.58 1.0 Z"
        fill="url(#foilHighlight)"
      />
      <path
        d="M10.42 1.0 Q8.8 3.3 7.5 5.6 H14.5 Q13.2 3.3 11.58 1.0 Z"
        fill="url(#foilEdge)"
      />

      {/* Top docking ring — NDS port, ~16 % of CM base */}
      <ellipse cx="11" cy="1.04" rx="0.58" ry="0.22" fill="#d0d5dc" stroke="#a0a7b1" strokeWidth="0.08" />
      <ellipse cx="11" cy="1.04" rx="0.32" ry="0.1" fill="#b8bfc8" />

      {/* Surface detail lines — horizontal seams */}
      <path d="M9.9 1.8 L12.1 1.8" stroke="#9ea6b0" strokeWidth="0.05" opacity="0.4" />
      <path d="M9.2 2.8 L12.8 2.8" stroke="#9ea6b0" strokeWidth="0.05" opacity="0.35" />
      <path d="M8.5 3.8 L13.5 3.8" stroke="#9ea6b0" strokeWidth="0.05" opacity="0.3" />
      <path d="M7.9 4.8 L14.1 4.8" stroke="#9ea6b0" strokeWidth="0.05" opacity="0.25" />
      {/* Diagonal panel rib lines */}
      <path d="M10.3 1.5 L8.9 3.8" stroke="#c8cdd4" strokeWidth="0.06" opacity="0.3" />
      <path d="M10.5 1.3 L9.0 4.5" stroke="#d8dce2" strokeWidth="0.08" opacity="0.25" />
      <path d="M10.8 1.1 L9.3 4.2" stroke="#e0e4e8" strokeWidth="0.04" opacity="0.2" />
      <path d="M11.7 1.3 L13.0 4.5" stroke="#8a929c" strokeWidth="0.06" opacity="0.2" />
      <path d="M11.4 1.15 L12.8 4.2" stroke="#929aa4" strokeWidth="0.04" opacity="0.15" />
      {/* Surface equipment marks */}
      <rect x="10.1" y="2.0" width="0.8" height="0.4" rx="0.06" fill="#cdd2d9" opacity="0.15" />
      <rect x="11.5" y="3.4" width="1.0" height="0.35" rx="0.06" fill="#b5bcc5" opacity="0.12" />
      <rect x="8.6" y="4.6" width="1.2" height="0.3" rx="0.05" fill="#d2d7dd" opacity="0.1" />
      {/* Meridian seam lines */}
      <path d="M10.7 1.0 L9.2 3.5 L7.9 5.5" stroke="#b0b7c0" strokeWidth="0.03" opacity="0.35" fill="none" />
      <path d="M11.3 1.0 L12.8 3.5 L14.1 5.5" stroke="#b0b7c0" strokeWidth="0.03" opacity="0.35" fill="none" />
      {/* Specular highlight */}
      <ellipse cx="10.9" cy="2.6" rx="0.3" ry="0.2" fill="#ffffff" opacity="0.08" />

      {/* Crew windows — incandescent glow */}
      <g className="ship-windows">
        <circle cx="9.6" cy="3.6" r="0.5" fill="url(#windowGlow)" />
        <circle cx="9.6" cy="3.6" r="0.22" fill="#fff8e8" opacity="0.95" />
        <circle cx="9.6" cy="3.6" r="0.15" fill="#ffffff" opacity="0.7" />
        <circle cx="10.5" cy="3.6" r="0.5" fill="url(#windowGlow)" />
        <circle cx="10.5" cy="3.6" r="0.22" fill="#fff8e8" opacity="0.95" />
        <circle cx="10.5" cy="3.6" r="0.15" fill="#ffffff" opacity="0.7" />
        <circle cx="11.5" cy="3.6" r="0.5" fill="url(#windowGlow)" />
        <circle cx="11.5" cy="3.6" r="0.22" fill="#fff8e8" opacity="0.95" />
        <circle cx="11.5" cy="3.6" r="0.15" fill="#ffffff" opacity="0.7" />
        <circle cx="12.4" cy="3.6" r="0.5" fill="url(#windowGlow)" />
        <circle cx="12.4" cy="3.6" r="0.22" fill="#fff8e8" opacity="0.95" />
        <circle cx="12.4" cy="3.6" r="0.15" fill="#ffffff" opacity="0.7" />
      </g>

      {/* ── Adapter ring — slim CM-to-SM transition ── */}
      <rect
        x="7.3"
        y="5.6"
        width="7.4"
        height="1.6"
        rx="0.2"
        fill="url(#ringGrad)"
        stroke="#c8ced6"
        strokeWidth="0.1"
      />
      {/* Gold accent stripes */}
      <path d="M7.35 5.72 H14.65" stroke="#efe4bf" strokeWidth="0.06" opacity="0.75" />
      <path d="M7.35 6.88 H14.65" stroke="#c9ad64" strokeWidth="0.08" opacity="0.72" />
      <text
        x="11"
        y="6.62"
        fill="#f25f51"
        fontSize="1.0"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
        textAnchor="middle"
        letterSpacing="0.1"
      >
        NASA
      </text>

      {/* ── Adapter → SM taper transition ── */}
      <path d="M7.3 7.2 L7.75 7.3 H14.25 L14.7 7.2 Z" fill="#d8dde4" stroke="#b4bac3" strokeWidth="0.06" />

      {/* ── Service module cylinder ──
           Width: 6.5 (93 % of CM base) — matches external ESM diameter.
           Height: 5.6 — gives CM:SM ratio of 0.82.
      */}
      <rect
        x="7.75" y="7.3" width="6.5" height="5.6" rx="0.32"
        fill="url(#svcGrad)"
        stroke="#b4bac3"
        strokeWidth="0.14"
      />
      {/* Panel lines on service module */}
      <path d="M8.05 7.7 H13.95 M8.05 8.3 H13.95 M8.05 8.9 H13.95 M8.05 9.5 H13.95 M8.05 10.1 H13.95 M8.05 10.7 H13.95 M8.05 11.3 H13.95 M8.05 11.9 H13.95 M8.05 12.5 H13.95" stroke="#c0c7cf" strokeWidth="0.08" opacity="0.6" />
      {/* Highlight / shadow strips */}
      <rect x="7.88" y="7.5" width="0.3" height="5.2" fill="#ffffff" opacity="0.18" />
      <rect x="13.82" y="7.5" width="0.3" height="5.2" fill="#ccd2da" opacity="0.25" />

      {/* Front pair — rendered on top of the cylinder for depth */}
      <g opacity="0.98">
        <use href="#solarWing" transform="rotate(40 11 10.1)" />
        <use href="#solarWing" transform="rotate(140 11 10.1)" />
      </g>

      {/* Bottom plate of service module */}
      <ellipse cx="11" cy="12.9" rx="3.25" ry="0.38" fill="#767d89" opacity="0.6" />
      {/* Flat bottom cap */}
      <ellipse cx="11" cy="12.9" rx="3.05" ry="0.32" fill="#9ea5af" opacity="0.4" />

      {/* ── Compact engine nozzle (Orion AJ10-190 style) ──
           Height: ~1.4 — only 25 % of SM height (real ratio).
           Exit width: 2.4 — compact OMS-E bell.
      */}
      {/* Outer cone body */}
      <path
        d="M10.1 12.9 L9.8 14.3 H12.2 L11.9 12.9 Z"
        fill="url(#engineBellGrad)"
        stroke="#6b7480"
        strokeWidth="0.1"
      />
      {/* Inner wall shadow for depth */}
      <path
        d="M10.3 13.05 L10.05 14.1 H11.95 L11.7 13.05 Z"
        fill="url(#nozzleInnerGrad)"
        opacity="0.5"
      />
      {/* Left/right metallic edge highlights */}
      <path d="M10.1 12.9 L9.8 14.3" stroke="#9ea6b1" strokeWidth="0.08" opacity="0.7" />
      <path d="M11.9 12.9 L12.2 14.3" stroke="#555d68" strokeWidth="0.08" opacity="0.6" />
      {/* Nozzle attachment ring — metallic grey */}
      <ellipse cx="11" cy="12.94" rx="0.95" ry="0.22" fill="#8a929e" opacity="0.9" />
      <ellipse cx="11" cy="12.94" rx="0.7" ry="0.14" fill="#a8b0ba" opacity="0.7" />
      {/* Specular highlight on rim */}
      <ellipse cx="10.8" cy="12.9" rx="0.35" ry="0.08" fill="#d0d5dc" opacity="0.4" />
      {/* Nozzle exit rim — thick grey ring */}
      <ellipse cx="11" cy="14.25" rx="1.3" ry="0.22" fill="#6b7480" opacity="0.85" />
      <ellipse cx="11" cy="14.25" rx="1.15" ry="0.18" fill="#7a838f" opacity="0.7" />
      {/* Rim specular */}
      <ellipse cx="10.7" cy="14.22" rx="0.45" ry="0.08" fill="#a8b0ba" opacity="0.35" />
      {/* Dark throat — concentric rings for depth */}
      <ellipse cx="11" cy="14.1" rx="1.0" ry="0.25" fill="#2a2f38" opacity="0.95" />
      <ellipse cx="11" cy="14.02" rx="0.7" ry="0.18" fill="#1a1e26" opacity="0.92" />
      <ellipse cx="11" cy="13.95" rx="0.4" ry="0.12" fill="#0a0d12" opacity="0.9" />

      {/* Engine flame — ellipses anchored at nozzle exit */}
      <g
        ref={flameRef}
        className="engine-flame"
        style={
          prefersReducedMotion
            ? { animation: "none", opacity: 0 }
            : undefined
        }
      >
        {/* Outer glow — faint wide halo */}
        <ellipse cx="11" cy="16.6" rx="1.8" ry="2.4" fill="url(#engineGlowShip)" />
        {/* Hot amber body */}
        <ellipse cx="11" cy="15.8" rx="1.0" ry="1.6" fill="#fffae0" opacity="0.75" />
        {/* Bright white core */}
        <ellipse cx="11" cy="15.2" rx="0.5" ry="0.9" fill="#ffffff" opacity="0.92" />
      </g>
    </svg>
  )
}
