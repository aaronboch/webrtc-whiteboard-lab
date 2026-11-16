// Canvas whiteboard (docs/plan/01-architecture.md §2, 02-measurement.md §7).
// Draws in fixed logical coordinates (WIDTH x HEIGHT) and scales the canvas
// to fit its container, so both peers see the same picture at any window
// size. It knows nothing about the network: local strokes go out through
// the onDraw callback, received ops come in through addRemote().

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

export class Whiteboard {
  private readonly container: HTMLElement
  private readonly options: WhiteboardOptions
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  /** Everything on the board (local and received), for repainting. */
  private readonly segments: Segment[] = []
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

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e))
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e))
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e))
    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()
  }

  /** Render an op received from the other peer. */
  addRemote(op: Op): void {
    // Segments are idempotent and order-independent, so ops can be drawn
    // in whatever order (and however late) they arrive.
    this.segments.push(op)
    this.drawSegment(op)
  }

  /** Remove all segments (local and received). */
  clear(): void {
    this.segments.length = 0
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
    for (const segment of this.segments) this.drawSegment(segment)
  }

  private drawSegment(segment: Segment): void {
    const ctx = this.ctx
    ctx.strokeStyle = segment.color
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
    this.segments.push(segment)
    this.drawSegment(segment)
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
