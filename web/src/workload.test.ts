import { describe, expect, test } from 'vitest'
import { HEIGHT, WIDTH, type Segment } from './whiteboard'
import { TICK_HZ, WORKLOAD_COLOR, generateScript, mulberry32 } from './workload'

const segmentsOf = (seed: number, durationS = 30) =>
  generateScript(seed, durationS).filter((t): t is Segment => t !== null)

describe('mulberry32', () => {
  test('is deterministic and returns values in [0, 1)', () => {
    const a = mulberry32(42), b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('generateScript', () => {
  test('same seed gives the identical script, another seed a different one', () => {
    expect(generateScript(42, 30)).toEqual(generateScript(42, 30))
    expect(generateScript(42, 30)).not.toEqual(generateScript(43, 30))
  })

  test('fills exactly durationS at 60 Hz, about 1500 segments in 30 s', () => {
    expect(generateScript(42, 30)).toHaveLength(30 * TICK_HZ)
    const n = segmentsOf(42).length
    expect(n).toBeGreaterThan(1300)
    expect(n).toBeLessThan(1700)
  })

  test('segments stay on the canvas, use the workload color and connect within a stroke', () => {
    const segs = segmentsOf(42)
    for (const s of segs) {
      for (const x of [s.x0, s.x1]) expect(x >= 0 && x <= WIDTH).toBe(true)
      for (const y of [s.y0, s.y1]) expect(y >= 0 && y <= HEIGHT).toBe(true)
      expect(s.color).toBe(WORKLOAD_COLOR)
    }
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].strokeId !== segs[i - 1].strokeId) continue
      expect([segs[i].x0, segs[i].y0]).toEqual([segs[i - 1].x1, segs[i - 1].y1])
    }
  })

  test('stroke ids count up from 1 without gaps', () => {
    const ids = [...new Set(segmentsOf(42).map((s) => s.strokeId))]
    expect(ids).toEqual(ids.map((_, i) => i + 1))
  })
})
