import { Suspense } from "react"
import { LandingHeroPanel } from "@/components/landing-hero-panel"
import { LandingSpaceScene } from "@/components/landing-space-scene"

export default function Home() {
  return (
    <main className="relative min-h-[100dvh] flex-1 overflow-hidden bg-surface">
      <LandingSpaceScene />
      <Suspense fallback={null}>
        <LandingHeroPanel />
      </Suspense>
    </main>
  )
}
