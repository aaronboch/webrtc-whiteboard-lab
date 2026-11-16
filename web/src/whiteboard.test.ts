import { expect, test } from 'vitest'
import { HEAT_MAX_MS, HEAT_MIN_MS, latencyColor } from './whiteboard'

const hue = (color: string) => Number(/hsl\((\d+)/.exec(color)![1])

test('latencyColor: green up to 50 ms, yellow at the log middle, red from 500 ms', () => {
  expect(hue(latencyColor(0))).toBe(120)
  expect(hue(latencyColor(30))).toBe(120)
  expect(hue(latencyColor(HEAT_MIN_MS))).toBe(120)
  expect(hue(latencyColor(Math.sqrt(HEAT_MIN_MS * HEAT_MAX_MS)))).toBe(60)
  expect(hue(latencyColor(HEAT_MAX_MS))).toBe(0)
  expect(hue(latencyColor(5000))).toBe(0)
})

test('latencyColor gets monotonically redder with latency', () => {
  const hues = [50, 80, 120, 200, 300, 500].map((ms) => hue(latencyColor(ms)))
  for (let i = 1; i < hues.length; i++) expect(hues[i]).toBeLessThan(hues[i - 1])
})
