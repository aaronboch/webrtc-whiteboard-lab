// Seeded, deterministic workload for the measurements (docs/plan/02-measurement.md §2).
// Two parts: generateScript() computes the whole run up front as a list of
// 60 Hz ticks (pure: no timer, no DOM), and runWorkload() plays it back one
// tick per interval. Late ticks only delay a segment, never change it, so
// the same seed gives exactly the same op stream in every run and variant.

import { now } from './metrics'
import { HEIGHT, WIDTH, roundCoord, type Segment } from './whiteboard'

export const TICK_HZ = 60
/** Fixed, so every run's ops and screenshots are identical (not the tab color). */
export const WORKLOAD_COLOR = '#000000'
export const WORKLOAD_WIDTH = 3

const STROKE_MIN_S = 1
const STROKE_MAX_S = 2
const PAUSE_S = 0.3
/** Control points stay this far from the edges (logical px). */
const MARGIN = 50

/** One tick: a segment to draw, or null for a pause tick. */
export type Tick = Segment | null

/** Start and end of the playback (ms, same clock as the metrics). */
export interface WorkloadTiming {
  tStart: number
  tEnd: number
}

/**
 * mulberry32: tiny seeded PRNG, returns floats in [0, 1). Deterministic
 * across browsers and Node, so the script can be unit-tested.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Point {
  x: number
  y: number
}

/** Point on a cubic Bézier curve at parameter u in [0, 1], rounded like mouse input. */
function bezier(p0: Point, p1: Point, p2: Point, p3: Point, u: number): Point {
  const v = 1 - u
  const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u
  return {
    x: roundCoord(a * p0.x + b * p1.x + c * p2.x + d * p3.x),
    y: roundCoord(a * p0.y + b * p1.y + c * p2.y + d * p3.y),
  }
}

/**
 * The full run as ticks: strokes of 1–2 s (cubic Bézier curves with random
 * control points inside the canvas, sampled once per tick), each followed by
 * a 0.3 s pause, until durationS is filled. Stroke ids count from 1.
 */
export function generateScript(seed: number, durationS: number): Tick[] {
  const rand = mulberry32(seed)
  const totalTicks = Math.round(durationS * TICK_HZ)
  const pauseTicks = Math.round(PAUSE_S * TICK_HZ)
  // Control points inside the margins keep the whole curve on the canvas
  // (a Bézier curve stays inside the hull of its control points).
  const randomPoint = (): Point => ({
    x: MARGIN + rand() * (WIDTH - 2 * MARGIN),
    y: MARGIN + rand() * (HEIGHT - 2 * MARGIN),
  })

  const ticks: Tick[] = []
  let strokeId = 0
  while (ticks.length < totalTicks) {
    strokeId++
    const segments = Math.round(
      (STROKE_MIN_S + rand() * (STROKE_MAX_S - STROKE_MIN_S)) * TICK_HZ,
    )
    const [p0, p1, p2, p3] = [randomPoint(), randomPoint(), randomPoint(), randomPoint()]
    let prev = bezier(p0, p1, p2, p3, 0)
    for (let i = 1; i <= segments && ticks.length < totalTicks; i++) {
      const next = bezier(p0, p1, p2, p3, i / segments)
      ticks.push({
        strokeId,
        x0: prev.x, y0: prev.y, x1: next.x, y1: next.y,
        color: WORKLOAD_COLOR,
        width: WORKLOAD_WIDTH,
      })
      prev = next
    }
    for (let i = 0; i < pauseTicks && ticks.length < totalTicks; i++) ticks.push(null)
  }
  return ticks
}

/**
 * Play the script back at TICK_HZ: each tick draws its segment (if any)
 * through `draw`, i.e. the same path as the mouse. Resolves after the last
 * tick with the start and end times.
 */
export function runWorkload(
  script: Tick[],
  draw: (segment: Segment) => void,
): Promise<WorkloadTiming> {
  // Not setInterval(…, 16.67): Chrome truncates the delay to whole ms, which
  // runs at 62.5 Hz. Each tick is scheduled for its own target time instead,
  // so small delays even out and the average rate is exactly TICK_HZ.
  const period = 1000 / TICK_HZ
  return new Promise((resolve) => {
    const tStart = now()
    let i = 0
    const tick = () => {
      const segment = script[i++]
      if (segment) draw(segment)
      if (i >= script.length) {
        resolve({ tStart, tEnd: now() })
        return
      }
      setTimeout(tick, Math.max(0, tStart + (i + 1) * period - now()))
    }
    if (script.length === 0) resolve({ tStart, tEnd: tStart })
    else setTimeout(tick, period)
  })
}
