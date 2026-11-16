// Canvas whiteboard (docs/plan/01-architecture.md §2, 02-measurement.md §7).
// Draws in fixed logical coordinates (WIDTH x HEIGHT) and scales the canvas
// to fit its container, so both peers see the same picture at any window
// size. It knows nothing about the network: local strokes go out through
// the onDraw callback, received ops come in through addRemote().
// Two views: true color, or a latency heatmap of the received segments.

import type { Op } from './transport'

export const WIDTH = 1000
export const HEIGHT = 700

/** A segment as drawn locally; the sender adds `seq` and `tSend`. */
export type Segment = Omit<Op, 'seq' | 'tSend'>

export interface WhiteboardOptions {
  /** Stroke color of this peer. */
  color: string
  /** Stroke width in logical pixels. */
  width: number
  /** Called for every segment the user draws (already drawn locally). */
  onDraw(segment: Segment): void
}

/** Logical coordinates are rounded to 0.1 px: plenty for drawing, smaller JSON. */
export const roundCoord = (v: number) => Math.round(v * 10) / 10

export type View = 'color' | 'heatmap'

/** Heatmap scale (docs/plan/02-measurement.md §7): green at or below MIN, red at or above MAX. */
export const HEAT_MIN_MS = 50
export const HEAT_MAX_MS = 500
/** Own strokes have no latency; in the heatmap they are drawn in this grey. */
const LOCAL_IN_HEATMAP = '#c8c8c8'

/**
 * Latency -> color, green (120°) over yellow to red (0°). Logarithmic between
 * HEAT_MIN_MS and HEAT_MAX_MS, so base delay (~30 ms), one retransmission
 * (~100-200 ms) and head-of-line stalls (500+ ms) are clearly apart;
 * yellow sits at about 160 ms.
 */
export function latencyColor(ms: number): string {
  const f = (Math.log(ms) - Math.log(HEAT_MIN_MS)) / (Math.log(HEAT_MAX_MS) - Math.log(HEAT_MIN_MS))
  const clamped = Math.min(1, Math.max(0, f)) // also catches ms <= 0 (log = -Infinity)
  return `hsl(${Math.round(120 * (1 - clamped))}, 85%, 42%)`
}

/** A stored segment; latency is null for segments drawn on this peer. */
interface Entry {
  segment: Segment
  latency: number | null
}

export class Whiteboard {
  private readonly container: HTMLElement
  private readonly options: WhiteboardOptions
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly legend: HTMLElement
  /** Everything on the board (local and received), for repainting. */
  private readonly entries: Entry[] = []
  private currentView: View = 'color'
  private strokeId = 0
  /** Last point of the stroke being drawn; null while the button is up. */
  private last: { x: number; y: number } | null = null

  constructor(container: HTMLElement, options: WhiteboardOptions) {
    this.container = container
    this.options = options
    this.canvas = document.createElement('canvas')
    this.canvas.style.touchAction = 'none' // no scrolling/zooming while drawing
    container.append(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.legend = createLegend()
    container.append(this.legend)

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e))
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e))
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e))
    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()
  }

  /** Render an op received from the other peer, with its latency in ms. */
  addRemote(op: Op, latency: number): void {
    // Segments are idempotent and order-independent, so ops can be drawn
    // in whatever order (and however late) they arrive.
    const entry = { segment: op, latency }
    this.entries.push(entry)
    this.drawEntry(entry)
  }

  /** Remove all segments (local and received). */
  clear(): void {
    this.entries.length = 0
    this.redraw()
  }

  get view(): View {
    return this.currentView
  }

  /** Switch between true color and heatmap; repaints everything. */
  setView(view: View): void {
    this.currentView = view
    this.legend.hidden = view !== 'heatmap'
    this.redraw()
  }

  /**
   * Fit the canvas into the container: keep the WIDTH:HEIGHT aspect ratio,
   * size the backing store by devicePixelRatio for sharp lines, then redraw
   * (resizing a canvas erases it).
   */
  private resize(): void {
    const scale = Math.min(
      this.container.clientWidth / WIDTH,
      this.container.clientHeight / HEIGHT,
    )
    const cssWidth = WIDTH * scale
    const cssHeight = HEIGHT * scale
    this.canvas.style.width = `${cssWidth}px`
    this.canvas.style.height = `${cssHeight}px`

    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(cssWidth * dpr)
    this.canvas.height = Math.round(cssHeight * dpr)
    // From here on, all drawing uses logical coordinates.
    this.ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0)
    this.redraw()
  }

  /** Repaint every stored segment (after resize or clear). */
  private redraw(): void {
    this.ctx.clearRect(0, 0, WIDTH, HEIGHT)
    for (const entry of this.entries) this.drawEntry(entry)
  }

  private drawEntry({ segment, latency }: Entry): void {
    const ctx = this.ctx
    ctx.strokeStyle =
      this.currentView === 'color' ? segment.color
      : latency === null ? LOCAL_IN_HEATMAP
      : latencyColor(latency)
    ctx.lineWidth = segment.width
    ctx.lineCap = 'round' // consecutive segments join without gaps
    ctx.beginPath()
    ctx.moveTo(segment.x0, segment.y0)
    ctx.lineTo(segment.x1, segment.y1)
    ctx.stroke()
  }

  /**
   * Store, draw and announce a segment drawn on this peer. The single path
   * for local segments: the mouse and the automated workload both use it.
   */
  draw(segment: Segment): void {
    const entry = { segment, latency: null }
    this.entries.push(entry)
    this.drawEntry(entry)
    this.options.onDraw(segment)
  }

  /** Pointer position in logical coordinates (0..WIDTH, 0..HEIGHT). */
  private toLogical(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: roundCoord(((event.clientX - rect.left) * WIDTH) / rect.width),
      y: roundCoord(((event.clientY - rect.top) * HEIGHT) / rect.height),
    }
  }

  /**
   * pointerdown starts a stroke (new strokeId), each pointermove while the
   * button is down adds a segment from the last point, pointerup/cancel
   * ends the stroke.
   */
  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return // left button / pen / touch only
    // Keep receiving moves even if the pointer leaves the canvas.
    this.canvas.setPointerCapture(event.pointerId)
    this.strokeId++
    this.last = this.toLogical(event)
  }

  private onPointerMove(event: PointerEvent): void {
    const last = this.last
    if (!last) return
    const point = this.toLogical(event)
    if (point.x === last.x && point.y === last.y) return
    this.last = point
    this.draw({
      strokeId: this.strokeId,
      x0: last.x, y0: last.y, x1: point.x, y1: point.y,
      color: this.options.color,
      width: this.options.width,
    })
  }

  private onPointerUp(_event: PointerEvent): void {
    this.last = null
  }
}

/** Small color bar for the heatmap, shown in the board's corner. */
function createLegend(): HTMLElement {
  const legend = document.createElement('div')
  legend.className = 'legend'
  legend.hidden = true
  const mid = Math.round(Math.sqrt(HEAT_MIN_MS * HEAT_MAX_MS)) // geometric middle = yellow
  legend.innerHTML = `
    <div class="legend-title">latency (received)</div>
    <div class="legend-bar"></div>
    <div class="legend-labels"><span>≤${HEAT_MIN_MS}</span><span>${mid}</span><span>≥${HEAT_MAX_MS} ms</span></div>`
  legend.querySelector<HTMLElement>('.legend-bar')!.style.background = `linear-gradient(to right, ${[
    latencyColor(HEAT_MIN_MS), latencyColor(mid), latencyColor(HEAT_MAX_MS),
  ].join(', ')})`
  return legend
}
