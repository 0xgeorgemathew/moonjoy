"use client"

import dynamic from "next/dynamic"
import { Suspense } from "react"

const SpaceshipTrajectory = dynamic(
  () => import("@/components/spaceship-trajectory"),
  { ssr: false },
)

export default function Home() {
  return (
    <Suspense
      fallback={<main className="relative min-h-[100dvh] flex-1 bg-surface" />}
    >
      <main className="relative min-h-[100dvh] flex-1 overflow-hidden bg-surface">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 70% 55% at 50% 50%, rgba(12 10 28 / 0.5) 0%, transparent 70%), radial-gradient(ellipse 45% 40% at 78vw 20vh, rgba(232 166 35 / 0.05) 0%, transparent 55%), radial-gradient(ellipse 35% 30% at 15vw 55vh, rgba(80 130 200 / 0.08) 0%, transparent 55%)",
          }}
        />
        {/* Star layers */}
        <div
          className="stars-1 animate-twinkle-1 pointer-events-none absolute inset-0"
          aria-hidden="true"
        />
        <div
          className="stars-2 animate-twinkle-2 pointer-events-none absolute inset-0"
          aria-hidden="true"
        />
        <div
          className="stars-3 animate-twinkle-3 pointer-events-none absolute inset-0"
          aria-hidden="true"
        />
        <div
          className="stars-4 animate-twinkle-4 pointer-events-none absolute inset-0"
          aria-hidden="true"
        />
        <div
          className="stars-5 animate-twinkle-5 pointer-events-none absolute inset-0"
          aria-hidden="true"
        />
        <div
          className="stars-6 animate-twinkle-6 pointer-events-none absolute inset-0"
          aria-hidden="true"
        />

        {/* Artemis II trajectory — free-return lunar flyby */}
        <SpaceshipTrajectory />

        {/* Earth */}
        <div
          className="earth pointer-events-none absolute left-[8vw] top-1/2 z-[3] -translate-y-1/2"
          aria-hidden="true"
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

        {/* Moon */}
        <div
          className="moon-hero animate-float pointer-events-none absolute right-[8vw] top-[15vh] z-[3]"
          aria-label="Moon"
        >
          <div className="moon-glow">
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 220 220"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="Stylized realistic moon"
            >
              <defs>
                <clipPath id="moonClip">
                  <circle cx="110" cy="110" r="108" />
                </clipPath>
                <radialGradient id="moonBase" cx="38%" cy="32%" r="62%">
                  <stop offset="0%" stopColor="#F5F6FA" />
                  <stop offset="15%" stopColor="#EAEAEF" />
                  <stop offset="35%" stopColor="#D6D7DF" />
                  <stop offset="55%" stopColor="#BDBEC8" />
                  <stop offset="75%" stopColor="#969AAA" />
                  <stop offset="90%" stopColor="#6B7080" />
                  <stop offset="100%" stopColor="#404650" />
                </radialGradient>
                <linearGradient id="terminator" x1="0" y1="0" x2="1" y2="0.3">
                  <stop offset="0%" stopColor="transparent" />
                  <stop offset="60%" stopColor="transparent" />
                  <stop offset="82%" stopColor="rgba(8,14,24,0.12)" />
                  <stop offset="100%" stopColor="rgba(8,14,24,0.38)" />
                </linearGradient>
                <radialGradient id="limbDark" cx="46%" cy="44%" r="52%">
                  <stop offset="0%" stopColor="transparent" />
                  <stop offset="75%" stopColor="transparent" />
                  <stop offset="94%" stopColor="rgba(8,15,24,0.08)" />
                  <stop offset="100%" stopColor="rgba(8,15,24,0.25)" />
                </radialGradient>
                <radialGradient id="mare1" cx="45%" cy="45%" r="50%">
                  <stop offset="0%" stopColor="#8A8F9E" stopOpacity="0.35" />
                  <stop offset="65%" stopColor="#969AAA" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#A5A9B6" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="mare2" cx="48%" cy="46%" r="50%">
                  <stop offset="0%" stopColor="#888D9C" stopOpacity="0.3" />
                  <stop offset="60%" stopColor="#9498A6" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#A0A4B0" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="craterA" cx="35%" cy="30%" r="60%">
                  <stop offset="0%" stopColor="#C5C8D0" />
                  <stop offset="50%" stopColor="#9A9EAC" />
                  <stop offset="100%" stopColor="#6E7380" />
                </radialGradient>
                <radialGradient id="craterB" cx="38%" cy="35%" r="55%">
                  <stop offset="0%" stopColor="#BCC0CA" />
                  <stop offset="55%" stopColor="#8E929F" />
                  <stop offset="100%" stopColor="#636878" />
                </radialGradient>
                <radialGradient id="craterFloor" cx="48%" cy="45%" r="40%">
                  <stop offset="0%" stopColor="#4A4F5C" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#6E7380" stopOpacity="0" />
                </radialGradient>
              </defs>
              <g clipPath="url(#moonClip)">
                <circle cx="110" cy="110" r="108" fill="url(#moonBase)" />
                <ellipse cx="50" cy="100" rx="28" ry="48" fill="url(#mare2)" opacity="0.4" />
                <circle cx="70" cy="55" r="28" fill="url(#mare1)" opacity="0.6" />
                <circle cx="125" cy="60" r="20" fill="url(#mare1)" opacity="0.5" />
                <ellipse cx="145" cy="90" rx="22" ry="18" fill="url(#mare2)" opacity="0.55" />
                <ellipse cx="155" cy="80" rx="14" ry="16" fill="url(#mare1)" opacity="0.4" />
                <ellipse cx="160" cy="120" rx="16" ry="22" fill="url(#mare2)" opacity="0.4" />
                <ellipse cx="185" cy="75" rx="12" ry="16" fill="url(#mare1)" opacity="0.5" />
                <circle cx="75" cy="140" r="22" fill="url(#mare2)" opacity="0.35" />
                <g opacity="0.12" stroke="white" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="90" y1="165" x2="40" y2="120" />
                  <line x1="95" y1="160" x2="60" y2="90" />
                  <line x1="105" y1="155" x2="110" y2="70" />
                  <line x1="110" y1="160" x2="160" y2="100" />
                  <line x1="115" y1="165" x2="180" y2="150" />
                  <line x1="105" y1="175" x2="110" y2="210" />
                </g>
                <g opacity="0.08" stroke="white" strokeWidth="1" strokeLinecap="round">
                  <line x1="60" y1="95" x2="30" y2="80" />
                  <line x1="65" y1="90" x2="55" y2="50" />
                  <line x1="70" y1="95" x2="100" y2="75" />
                  <line x1="65" y1="100" x2="80" y2="130" />
                </g>
                <circle cx="102" cy="168" r="10" fill="url(#craterA)" opacity="0.6" />
                <circle cx="103" cy="169" r="6" fill="url(#craterFloor)" />
                <circle cx="102" cy="168" r="2" fill="white" opacity="0.3" />
                <circle cx="65" cy="95" r="8" fill="url(#craterA)" opacity="0.5" />
                <circle cx="66" cy="96" r="4.5" fill="url(#craterFloor)" />
                <circle cx="65" cy="95" r="1.5" fill="white" opacity="0.2" />
                <circle cx="42" cy="102" r="4" fill="url(#craterA)" opacity="0.5" />
                <circle cx="42.5" cy="102.5" r="2" fill="url(#craterFloor)" />
                <circle cx="45" cy="70" r="4.5" fill="white" opacity="0.25" />
                <circle cx="45" cy="70" r="3" fill="url(#craterA)" />
                <ellipse cx="85" cy="35" rx="9" ry="6" fill="rgba(60,65,75,0.4)" />
                <ellipse cx="85" cy="35" rx="5" ry="3" fill="rgba(45,50,60,0.3)" />
                <circle cx="95" cy="60" r="6" fill="url(#craterB)" opacity="0.3" />
                <circle cx="96" cy="61" r="4" fill="rgba(70,75,85,0.25)" />
                <circle cx="105" cy="195" r="14" fill="url(#craterB)" opacity="0.25" />
                <circle cx="106" cy="196" r="9" fill="url(#craterFloor)" opacity="0.5" />
                <circle cx="100" cy="190" r="3" fill="url(#craterA)" opacity="0.2" />
                <circle cx="112" cy="198" r="2.5" fill="url(#craterA)" opacity="0.15" />
                <ellipse cx="20" cy="115" rx="6" ry="10" fill="rgba(60,65,75,0.35)" />
                <circle cx="135" cy="130" r="5" fill="url(#craterB)" opacity="0.3" />
                <circle cx="136" cy="131" r="3" fill="url(#craterFloor)" />
                <circle cx="150" cy="155" r="6" fill="url(#craterB)" opacity="0.25" />
                <circle cx="151" cy="156" r="3.5" fill="url(#craterFloor)" />
                <circle cx="80" cy="175" r="4" fill="url(#craterA)" opacity="0.35" />
                <circle cx="120" cy="40" r="4" fill="url(#craterB)" opacity="0.2" />
                <circle cx="155" cy="55" r="3" fill="url(#craterA)" opacity="0.2" />
                <circle cx="175" cy="100" r="3.5" fill="url(#craterB)" opacity="0.15" />
                <circle cx="86" cy="114" r="5.5" fill="url(#craterA)" opacity="0.28" />
                <circle cx="58" cy="58" r="5.5" fill="url(#craterA)" opacity="0.3" />
                <circle cx="122" cy="52" r="4.5" fill="url(#craterA)" opacity="0.25" />
                <circle cx="178" cy="86" r="3.5" fill="url(#craterB)" opacity="0.2" />
                <circle cx="148" cy="42" r="3" fill="url(#craterA)" opacity="0.22" />
                <circle cx="52" cy="88" r="2.5" fill="url(#craterB)" opacity="0.2" />
                <circle cx="168" cy="136" r="3" fill="url(#craterB)" opacity="0.2" />
                <circle cx="88" cy="48" r="2.5" fill="url(#craterA)" opacity="0.2" />
                <circle cx="42" cy="148" r="3" fill="url(#craterB)" opacity="0.2" />
                <circle cx="188" cy="76" r="2" fill="url(#craterB)" opacity="0.15" />
                <circle cx="162" cy="48" r="2" fill="url(#craterA)" opacity="0.18" />
                <circle cx="116" cy="100" r="2.5" fill="url(#craterA)" opacity="0.2" />
                <circle cx="94" cy="178" r="2.5" fill="url(#craterB)" opacity="0.15" />
                <circle cx="106" cy="136" r="3" fill="url(#craterB)" opacity="0.2" />
                <circle cx="64" cy="40" r="2" fill="url(#craterA)" opacity="0.18" />
                <circle cx="154" cy="160" r="2.5" fill="url(#craterB)" opacity="0.16" />
                <circle cx="40" cy="54" r="1.5" fill="#7A7F8E" opacity="0.15" />
                <circle cx="164" cy="58" r="1.2" fill="#7A7F8E" opacity="0.12" />
                <circle cx="96" cy="166" r="1.5" fill="#7A7F8E" opacity="0.13" />
                <circle cx="150" cy="172" r="1.5" fill="#7A7F8E" opacity="0.1" />
                <circle cx="186" cy="98" r="1.2" fill="#7A7F8E" opacity="0.1" />
                <circle cx="30" cy="120" r="1.5" fill="#7A7F8E" opacity="0.12" />
                <circle cx="82" cy="28" r="1.5" fill="#7A7F8E" opacity="0.1" />
                <circle cx="172" cy="150" r="1.2" fill="#7A7F8E" opacity="0.1" />
                <circle cx="48" cy="168" r="1.5" fill="#7A7F8E" opacity="0.1" />
                <circle cx="104" cy="40" r="1.5" fill="#7A7F8E" opacity="0.12" />
                <circle cx="70" cy="100" r="1.2" fill="#7A7F8E" opacity="0.1" />
                <circle cx="136" cy="82" r="1.2" fill="#7A7F8E" opacity="0.1" />
                <circle cx="20" cy="92" r="1.2" fill="#7A7F8E" opacity="0.1" />
                <circle cx="140" cy="38" r="1" fill="#7A7F8E" opacity="0.08" />
              </g>
              <circle cx="110" cy="110" r="108" fill="url(#terminator)" />
              <circle cx="110" cy="110" r="108" fill="url(#limbDark)" />
              <circle cx="80" cy="74" r="40" fill="rgba(248,249,255,0.05)" />
              <circle cx="74" cy="66" r="22" fill="rgba(248,249,255,0.04)" />
              <circle cx="68" cy="60" r="10" fill="rgba(248,249,255,0.03)" />
              <circle cx="110" cy="110" r="108" stroke="rgba(8,15,24,0.82)" strokeWidth="4" />
            </svg>
          </div>
        </div>

        {/* Hero — neo-brutalist panel */}
        <div className="relative z-20 flex min-h-[100dvh] flex-col items-center justify-center px-6">
          <div className="neo-panel relative -rotate-[0.7deg] w-full max-w-sm p-8 sm:max-w-md sm:p-10">
            {/* Title — stacked, black, massive */}
            <h1 className="font-display text-7xl font-black uppercase leading-[0.85] tracking-tighter text-black sm:text-8xl">
              MOON
              <br />
              <span className="relative inline-block -rotate-[2deg] bg-neo-yellow/55 px-4 py-1 -mx-3">
                JOY
              </span>
            </h1>

            {/* Tagline */}
            <p className="mt-5 font-label text-sm uppercase tracking-[0.18em] leading-relaxed text-gray-700 sm:text-[15px]">
              Trade tokens. Crush rivals.
              <br />
              <span className="mt-2 inline-block bg-black px-2.5 py-1 font-display text-[11px] font-extrabold uppercase tracking-widest text-white">
                TAKE THE POOL.
              </span>
            </p>

            {/* Divider */}
            <hr className="neo-divider my-6" />

            {/* CTA buttons */}
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
              <button
                className="neo-btn flex flex-1 cursor-pointer items-center justify-center px-6 py-4 font-display text-base font-extrabold uppercase tracking-[0.15em] sm:text-lg"
              >
                Coming Soon
              </button>
            </div>
          </div>
        </div>
      </main>
    </Suspense>
  )
}
