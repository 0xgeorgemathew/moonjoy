"use client"

import dynamic from "next/dynamic"
import { Suspense } from "react"
import { LandingEarth } from "@/components/landing-earth"
import { LandingMoon } from "@/components/landing-moon"
import { LandingStarfield } from "@/components/landing-starfield"

const SpaceshipTrajectory = dynamic(
  () => import("@/components/spaceship-trajectory"),
  { ssr: false },
)

export function LandingSpaceScene() {
  return (
    <Suspense
      fallback={
        <div
          className="pointer-events-none absolute inset-0 bg-surface"
          aria-hidden="true"
        />
      }
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 50%, rgba(12 10 28 / 0.5) 0%, transparent 70%), radial-gradient(ellipse 45% 40% at 78vw 20vh, rgba(232 166 35 / 0.05) 0%, transparent 55%), radial-gradient(ellipse 35% 30% at 15vw 55vh, rgba(80 130 200 / 0.08) 0%, transparent 55%)",
        }}
      />
      <LandingStarfield />
      <SpaceshipTrajectory />
      <LandingEarth />
      <LandingMoon />
    </Suspense>
  )
}
