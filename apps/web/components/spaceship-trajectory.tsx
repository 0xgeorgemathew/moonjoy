"use client"

import { useEffect, useRef, useState } from "react"
import {
  EARTH_BOTTOM_RATIO,
  EARTH_LEFT_RATIO,
  MOON_RIGHT_RATIO,
  MOON_TOP_RATIO,
} from "@/lib/space-scene"
import SpaceshipSvg from "./spaceship-svg"

type Point = {
  x: number
  y: number
}

type BodyAnchor = Point & {
  size: number
}

type CubicSegment = {
  controlOne: Point
  controlTwo: Point
  end: Point
}

type MissionSegment = {
  burnActive: boolean
}

type MissionTrajectory = {
  path: string
  timeline: MissionTimelineStop[]
}

type MissionTimelineStop = {
  burnActive: boolean
  pathEnd: number
}

const FLIGHT_DURATION_MS = 42_000
const REDUCED_MOTION_PROGRESS = 0.42
const TANGENT_EPSILON = 2
const ROTATION_SMOOTHING = 0.35
const SHIP_SIZE = 75
const SHIP_HALF_SIZE = SHIP_SIZE / 2
const VIEWPORT_MARGIN = -200

/**
 * Renders a smooth free-return style figure-eight. The path is built from
 * explicit cubic segments so the crossover stays clean and both lobes read as
 * intentional orbital loops instead of two circles joined by kinks.
 */
export default function SpaceshipTrajectory() {
  const [dimensions, setDimensions] = useState({ w: 390, h: 844 })
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const flameRef = useRef<SVGGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const shipRef = useRef<HTMLDivElement>(null)
  const previousAngleRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    function updateDimensions(width: number, height: number) {
      setDimensions({
        w: Math.max(1, Math.round(width)),
        h: Math.max(1, Math.round(height)),
      })
    }

    updateDimensions(container.clientWidth, container.clientHeight)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]

      if (!entry) {
        return
      }

      updateDimensions(entry.contentRect.width, entry.contentRect.height)
    })

    observer.observe(container)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")

    const updatePreference = (event: MediaQueryListEvent | MediaQueryList) => {
      setPrefersReducedMotion(event.matches)
    }

    updatePreference(mediaQuery)

    mediaQuery.addEventListener("change", updatePreference)
    return () => mediaQuery.removeEventListener("change", updatePreference)
  }, [])

  const { w, h } = dimensions
  const earthSize = clampNumber(w * 0.14, 92, 160)
  const moonSize = clampNumber(w * 0.18, 120, 220)

  const earth = {
    x: w * EARTH_LEFT_RATIO + earthSize / 2,
    y: h * (1 - EARTH_BOTTOM_RATIO) - earthSize / 2,
    size: earthSize,
  }
  const moon = {
    x: w * (1 - MOON_RIGHT_RATIO) - moonSize / 2,
    y: h * MOON_TOP_RATIO + moonSize / 2,
    size: moonSize,
  }

  const trajectory = buildMissionTrajectory(earth, moon, w, h)

  useEffect(() => {
    const pathElement = pathRef.current
    const shipElement = shipRef.current
    const flameElement = flameRef.current

    previousAngleRef.current = null

    if (!pathElement || !shipElement || !flameElement) {
      return
    }

    let totalLength = 0

    try {
      totalLength = pathElement.getTotalLength()
    } catch {
      shipElement.style.opacity = "0"
      flameElement.style.opacity = "0"
      return
    }

    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      shipElement.style.opacity = "0"
      flameElement.style.opacity = "0"
      return
    }

    const placeShip = (timeProgress: number, dt: number = 16.67) => {
      const missionState = getMissionState(trajectory.timeline, timeProgress)
      const currentLength = totalLength * missionState.pathProgress
      const epsilon = Math.min(TANGENT_EPSILON, totalLength * 0.001)
      const point = pathElement.getPointAtLength(currentLength)
      const tangentPrev = pathElement.getPointAtLength((currentLength - epsilon + totalLength) % totalLength)
      const tangentNext = pathElement.getPointAtLength((currentLength + epsilon) % totalLength)
      const targetAngle =
        (Math.atan2(
          tangentNext.y - tangentPrev.y,
          tangentNext.x - tangentPrev.x,
        ) * 180) /
          Math.PI +
        90
      const previousAngle = previousAngleRef.current
      const factor = 1 - Math.pow(1 - ROTATION_SMOOTHING, dt / 16.67)
      const smoothedAngle =
        previousAngle === null
          ? targetAngle
          : previousAngle +
            shortestAngleDelta(previousAngle, targetAngle) *
              factor

      previousAngleRef.current = smoothedAngle
      shipElement.style.opacity = "1"
      shipElement.style.transform = `translate3d(${point.x - SHIP_HALF_SIZE}px, ${point.y - SHIP_HALF_SIZE}px, 0) rotate(${smoothedAngle}deg)`
      flameElement.style.opacity = missionState.burnActive ? "0.96" : "0"
    }

    if (prefersReducedMotion) {
      placeShip(REDUCED_MOTION_PROGRESS)
      return
    }

    let animationFrame = 0
    if (startTimeRef.current === null) {
      startTimeRef.current = performance.now()
    }
    const startTime = startTimeRef.current
    let lastFrameTime = startTime

    const animate = (now: number) => {
      const dt = Math.min(now - lastFrameTime, 50)
      lastFrameTime = now
      const elapsed = (now - startTime) % FLIGHT_DURATION_MS
      placeShip(elapsed / FLIGHT_DURATION_MS, dt)
      animationFrame = window.requestAnimationFrame(animate)
    }

    placeShip(0)
    animationFrame = window.requestAnimationFrame(animate)

    return () => window.cancelAnimationFrame(animationFrame)
  }, [prefersReducedMotion, trajectory.path, trajectory.timeline])

  return (
    <div
      ref={containerRef}
      className="spaceship-trajectory pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
      >
        <path ref={pathRef} d={trajectory.path} fill="none" stroke="none" />
      </svg>

      <div
        ref={shipRef}
        className="pointer-events-none spaceship-on-path"
        style={{ opacity: 0 }}
      >
        <SpaceshipSvg
          flameRef={flameRef}
          prefersReducedMotion={prefersReducedMotion}
          size={SHIP_SIZE}
        />
      </div>
    </div>
  )
}

function buildMissionTrajectory(
  earth: BodyAnchor,
  moon: BodyAnchor,
  viewportWidth: number,
  viewportHeight: number,
): MissionTrajectory {
  const safePoint = (x: number, y: number) => clampPoint(x, y, viewportWidth, viewportHeight)

  const spanX = moon.x - earth.x
  const spanY = moon.y - earth.y
  const distance = Math.sqrt(spanX * spanX + spanY * spanY)

  // Determine global rotation axis geometrically
  const A = Math.atan2(spanY, spanX) * (180 / Math.PI)
  
  // Earth orbit sequence (spans Far Side, decreasing angles to launch and increasing to land)
  const e5 = A + 240
  const e4 = A + 220
  const e3 = A + 200  // Array start
  const e2 = A + 180
  const e1 = A + 160
  const e0 = A + 140
  const eDep = A + 120 // Array departure

  // Moon orbit sequence (spans Far Side, increasing angles)
  const mArr = A - 60
  const mMid = A
  const mDep = A + 60

  const earthOrbitRadius = earth.size * 0.61
  const moonOrbitRadius = moon.size * 0.57

  // Calculate planetary trajectory intersections
  const pEarthUpper = pointOnOrbit(earth, earthOrbitRadius, e3, viewportWidth, viewportHeight)
  const pEarthLower = pointOnOrbit(earth, earthOrbitRadius, eDep, viewportWidth, viewportHeight)
  const pMoonUpper = pointOnOrbit(moon, moonOrbitRadius, mArr, viewportWidth, viewportHeight)
  const pMoonLower = pointOnOrbit(moon, moonOrbitRadius, mDep, viewportWidth, viewportHeight)
  const pEarthEntry = pointOnOrbit(earth, earthOrbitRadius, e5, viewportWidth, viewportHeight)

  // Tangent helper ensures flawless C1 continuity for Bezier handles
  function getVelocity(angleDeg: number, decreasing: boolean) {
    const rad = angleDeg * Math.PI / 180
    const dir = decreasing ? -1 : 1
    return {
      x: -Math.sin(rad) * dir,
      y: Math.cos(rad) * dir
    }
  }

  const vEarthDep = getVelocity(eDep, true)
  const vMoonArr = getVelocity(mArr, false)
  const vMoonDep = getVelocity(mDep, false)
  const vEarthArr = getVelocity(e5, true)

  const K_out = distance * 0.4
  const K_in = distance * 0.4

  const outboundCubic: CubicSegment = {
    controlOne: safePoint(pEarthLower.x + vEarthDep.x * K_out, pEarthLower.y + vEarthDep.y * K_out),
    controlTwo: safePoint(pMoonUpper.x - vMoonArr.x * K_out, pMoonUpper.y - vMoonArr.y * K_out),
    end: pMoonUpper
  }

  const returnCubic: CubicSegment = {
    controlOne: safePoint(pMoonLower.x + vMoonDep.x * K_in, pMoonLower.y + vMoonDep.y * K_in),
    controlTwo: safePoint(pEarthEntry.x - vEarthArr.x * K_in, pEarthEntry.y - vEarthArr.y * K_in),
    end: pEarthEntry
  }

  // Split transit lines gracefully to align with the chronological step array timeline
  const [segOut12, segOut34] = subdivideCubic(pEarthLower, outboundCubic)
  const [seg4, seg5] = subdivideCubic(pEarthLower, segOut12)
  const [seg6, seg7] = subdivideCubic(segOut12.end, segOut34)

  const [segRet12, segRet34] = subdivideCubic(pMoonLower, returnCubic)
  const [seg10, seg11] = subdivideCubic(pMoonLower, segRet12)
  const [seg12, seg13] = subdivideCubic(segRet12.end, segRet34)
  
  // Note: createArcSegment assumes an arc sequence. Order defines the svg command's endpoints.
  const segments: CubicSegment[] = [
    createArcSegment(earth, earthOrbitRadius, e3, e2, viewportWidth, viewportHeight),
    createArcSegment(earth, earthOrbitRadius, e2, e1, viewportWidth, viewportHeight),
    createArcSegment(earth, earthOrbitRadius, e1, e0, viewportWidth, viewportHeight),
    createArcSegment(earth, earthOrbitRadius, e0, eDep, viewportWidth, viewportHeight),
    seg4,
    seg5,
    seg6,
    seg7,
    createArcSegment(moon, moonOrbitRadius, mArr, mMid, viewportWidth, viewportHeight),
    createArcSegment(moon, moonOrbitRadius, mMid, mDep, viewportWidth, viewportHeight),
    seg10,
    seg11,
    seg12,
    seg13,
    createArcSegment(earth, earthOrbitRadius, e5, e4, viewportWidth, viewportHeight),
    createArcSegment(earth, earthOrbitRadius, e4, e3, viewportWidth, viewportHeight),
  ]

  const segmentStates: MissionSegment[] = [
    { burnActive: true },  // 0  Launch
    { burnActive: false }, // 1  Coast 1
    { burnActive: true },  // 2  Coast 2
    { burnActive: true },  // 3  TLI Burn
    { burnActive: false }, // 4  Transit 1
    { burnActive: true },  // 5  Mid-course 1
    { burnActive: true },  // 6  Mid-course 2
    { burnActive: false }, // 7  Transit 4
    { burnActive: false }, // 8  Lunar Far Orbit 1
    { burnActive: false }, // 9  Lunar Far Orbit 2
    { burnActive: true },  // 10 Transit Return 1
    { burnActive: false }, // 11 Transit Return 2
    { burnActive: true },  // 12 Return Approach 3
    { burnActive: false }, // 13 Return Approach 4
    { burnActive: true },  // 14 Re-entry Burn
    { burnActive: true },  // 15 Splashdown
  ]

  const routePoints = [pEarthUpper, ...segments.map((segment) => segment.end)]
  const path = buildCubicPath(pEarthUpper, segments)
  const timeline = buildMissionTimeline(routePoints, segmentStates)

  return { path, timeline }
}

function pointOnOrbit(
  center: Point,
  radius: number,
  angleInDegrees: number,
  viewportWidth: number,
  viewportHeight: number,
): Point {
  const angle = (angleInDegrees * Math.PI) / 180

  return clampPoint(
    center.x + Math.cos(angle) * radius,
    center.y + Math.sin(angle) * radius,
    viewportWidth,
    viewportHeight,
  )
}

function createArcSegment(
  center: Point,
  radius: number,
  startAngleInDegrees: number,
  endAngleInDegrees: number,
  viewportWidth: number,
  viewportHeight: number,
): CubicSegment {
  const startAngle = (startAngleInDegrees * Math.PI) / 180
  const endAngle = (endAngleInDegrees * Math.PI) / 180
  const delta = endAngle - startAngle
  const handleScale = (4 / 3) * Math.tan(delta / 4) * radius
  const start = {
    x: center.x + Math.cos(startAngle) * radius,
    y: center.y + Math.sin(startAngle) * radius,
  }
  const end = {
    x: center.x + Math.cos(endAngle) * radius,
    y: center.y + Math.sin(endAngle) * radius,
  }

  return {
    controlOne: clampPoint(
      start.x - Math.sin(startAngle) * handleScale,
      start.y + Math.cos(startAngle) * handleScale,
      viewportWidth,
      viewportHeight,
    ),
    controlTwo: clampPoint(
      end.x + Math.sin(endAngle) * handleScale,
      end.y - Math.cos(endAngle) * handleScale,
      viewportWidth,
      viewportHeight,
    ),
    end: clampPoint(end.x, end.y, viewportWidth, viewportHeight),
  }
}

function buildMissionTimeline(points: Point[], segments: MissionSegment[]) {
  const distances: number[] = []
  let totalDistance = 0

  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentDistance = distanceBetweenPoints(
      points[index],
      points[index + 1],
    )
    distances.push(segmentDistance)
    totalDistance += segmentDistance
  }

  let accumulatedDistance = 0

  return points.slice(0, -1).map((_, index) => {
    const segmentDistance = distances[index] ?? 0
    const segment = segments[index] ?? { burnActive: false }
    const pathEnd =
      totalDistance === 0
        ? 0
        : (accumulatedDistance + segmentDistance) / totalDistance

    accumulatedDistance += segmentDistance

    return {
      burnActive: segment.burnActive,
      pathEnd,
    }
  })
}

function getMissionState(timeline: MissionTimelineStop[], timeProgress: number) {
  const progress = clampNumber(timeProgress, 0, 1)
  const activeStop =
    timeline.find(
      (stop, index) =>
        progress < stop.pathEnd || index === timeline.length - 1,
    ) ?? timeline[0]

  return {
    burnActive: activeStop.burnActive,
    pathProgress: progress,
  }
}

function distanceBetweenPoints(start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return Math.sqrt(dx * dx + dy * dy)
}

function shortestAngleDelta(from: number, to: number) {
  let delta = (to - from) % 360

  if (delta > 180) {
    delta -= 360
  }

  if (delta < -180) {
    delta += 360
  }

  return delta
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function clampPoint(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): Point {
  return {
    x: clampNumber(x, VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN),
    y: clampNumber(y, VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN),
  }
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }
}

function subdivideCubic(
  start: Point,
  segment: CubicSegment,
): [CubicSegment, CubicSegment] {
  const p0 = start
  const p1 = segment.controlOne
  const p2 = segment.controlTwo
  const p3 = segment.end
  const t = 0.5

  const m01 = lerpPoint(p0, p1, t)
  const m12 = lerpPoint(p1, p2, t)
  const m23 = lerpPoint(p2, p3, t)
  const m012 = lerpPoint(m01, m12, t)
  const m123 = lerpPoint(m12, m23, t)
  const midpoint = lerpPoint(m012, m123, t)

  return [
    {
      controlOne: m01,
      controlTwo: m012,
      end: midpoint,
    },
    {
      controlOne: m123,
      controlTwo: m23,
      end: p3,
    },
  ]
}

function buildCubicPath(start: Point, segments: CubicSegment[]) {
  if (segments.length === 0) {
    return ""
  }

  const pathSegments = [`M ${start.x} ${start.y}`]

  for (const segment of segments) {
    pathSegments.push(
      `C ${segment.controlOne.x} ${segment.controlOne.y}, ${segment.controlTwo.x} ${segment.controlTwo.y}, ${segment.end.x} ${segment.end.y}`,
    )
  }

  return pathSegments.join(" ")
}
