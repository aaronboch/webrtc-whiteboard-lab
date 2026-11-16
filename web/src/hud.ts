// Top bar: HUD on the left (variant, connection state, op counters) and the
// control bar on the right (docs/plan/01-architecture.md §2 "Live controls").
// Later steps add the network profile (3.6), the live p95 (2.x) and the
// heatmap toggle (2.4) here.

export interface HudOptions {
  variant: string
  /** False in automated runs (?auto=1): no buttons, HUD only. */
  showControls: boolean
  /** Clear only this peer's canvas and counters. */
  onClearLocal(): void
  /** Clear both peers (sent via the signaling server, not the DataChannel). */
  onClearAll(): void
}

export class Hud {
  private readonly requested: string
  private readonly variantEl: HTMLElement
  private readonly mismatchEl: HTMLElement
  private readonly stateEl: HTMLElement
  private readonly countsEl: HTMLElement
  private sent = 0
  private received = 0

  constructor(container: HTMLElement, options: HudOptions) {
    container.innerHTML = `
      <div class="hud">
        <span class="variant"></span>
        <span class="mismatch"></span>
        <span class="state"></span>
        <span class="counts"></span>
      </div>
      <div class="controls">
        <button data-action="clear-local">Clear local</button>
        <button data-action="clear-all">Clear all</button>
        <button disabled title="Latency heatmap: step 2.4">Heatmap (H)</button>
      </div>`
    this.requested = options.variant
    this.variantEl = container.querySelector('.variant')!
    this.mismatchEl = container.querySelector('.mismatch')!
    this.stateEl = container.querySelector('.state')!
    this.countsEl = container.querySelector('.counts')!

    const controls = container.querySelector<HTMLElement>('.controls')!
    controls.hidden = !options.showControls
    controls.querySelector('[data-action="clear-local"]')!
      .addEventListener('click', () => options.onClearLocal())
    controls.querySelector('[data-action="clear-all"]')!
      .addEventListener('click', () => options.onClearAll())

    this.setVariant(null)
    this.renderCounts()
  }

  /**
   * The variant the open channel actually runs (from `dc.label`), or null
   * while not connected. Not connected: the requested variant, greyed out.
   * Connected: the active variant in its color, plus a warning if it
   * differs from what this page asked for (the offerer's variant wins).
   */
  setVariant(active: string | null): void {
    const shown = active ?? this.requested
    this.variantEl.textContent = shown
    this.variantEl.dataset.variant = shown
    this.variantEl.classList.toggle('pending', active === null)
    this.variantEl.title = active === null
      ? 'requested variant; not connected yet'
      : 'variant of the open DataChannel'
    const mismatch = active !== null && active !== this.requested
    this.mismatchEl.textContent = mismatch ? `page asked for ${this.requested}` : ''
    this.mismatchEl.hidden = !mismatch
  }

  /** Connection state, e.g. "waiting for partner" or "channel open". */
  setState(text: string): void {
    this.stateEl.textContent = text
  }

  countSent(): void {
    this.sent++
    this.renderCounts()
  }

  countReceived(): void {
    this.received++
    this.renderCounts()
  }

  resetCounts(): void {
    this.sent = 0
    this.received = 0
    this.renderCounts()
  }

  private renderCounts(): void {
    this.countsEl.textContent = `sent ${this.sent} · received ${this.received}`
  }
}
