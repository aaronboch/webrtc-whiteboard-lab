// In-page measurement log (docs/plan/02-measurement.md §3). Events are kept
// in memory and handed out once via dump(); nothing is logged per event.
// Both peers run the same code: each records its own sends and receives.
// The transport does the recording, since only it knows the exact message
// size and (later, V3) the kind of every message on the wire.

/** The one clock: both browsers share the host's kernel clock. */
export const now = (): number => performance.timeOrigin + performance.now()

/** data = original op; the others follow with V3. */
export type SendKind = 'data' | 'retransmit' | 'redundant' | 'control'

export interface SendEvent {
  seq: number
  /** For data: the op's tSend. */
  t: number
  /** Size of the message as sent (JSON). */
  bytes: number
  kind: SendKind
}

export interface RecvEvent {
  seq: number
  /** From the op, so the receiver can compute latency (t - tSend) alone. */
  tSend: number
  t: number
  bytes: number
  /** seq already seen; must never happen with V1/V2. */
  duplicate: boolean
}

export interface MetricsDump {
  meta: {
    /** Variant of the open DataChannel (the offerer's), else the requested one. */
    variant: string
    requestedVariant: string
    timeOrigin: number
    userAgent: string
    /** True when the page is cross-origin isolated: timer resolution 5 µs, else 100 µs. */
    crossOriginIsolated: boolean
  }
  sends: SendEvent[]
  recvs: RecvEvent[]
  // Step 2.3 adds: bufferedAmount samples, getStats snapshots.
}

export class Metrics {
  private readonly requestedVariant: string
  private variant: string
  private sends: SendEvent[] = []
  private recvs: RecvEvent[] = []
  /** Distinct seqs received, for duplicate detection and the HUD count. */
  private readonly seen = new Set<number>()
  private sent = 0

  constructor(requestedVariant: string) {
    this.requestedVariant = requestedVariant
    this.variant = requestedVariant
  }

  /** The variant actually running (from the DataChannel label). */
  setVariant(variant: string): void {
    this.variant = variant
  }

  recordSend(seq: number, t: number, bytes: number, kind: SendKind = 'data'): void {
    this.sends.push({ seq, t, bytes, kind })
    if (kind === 'data') this.sent++
  }

  /**
   * `t` is the arrival time, taken by the caller as the very first thing in
   * onmessage (before parsing), so latency is measured at the app's door.
   */
  recordRecv(seq: number, tSend: number, t: number, bytes: number): void {
    const duplicate = this.seen.has(seq)
    this.seen.add(seq)
    this.recvs.push({ seq, tSend, t, bytes, duplicate })
  }

  /** Original ops sent (kind 'data'); feeds the HUD. */
  get sentCount(): number {
    return this.sent
  }

  /** Distinct ops received (duplicates not counted); feeds the HUD. */
  get receivedCount(): number {
    return this.seen.size
  }

  /** Forget all events (Clear local / Clear all in the live demo). */
  reset(): void {
    this.sends = []
    this.recvs = []
    this.seen.clear()
    this.sent = 0
  }

  dump(): MetricsDump {
    return {
      meta: {
        variant: this.variant,
        requestedVariant: this.requestedVariant,
        timeOrigin: performance.timeOrigin,
        userAgent: navigator.userAgent,
        crossOriginIsolated: window.crossOriginIsolated,
      },
      sends: this.sends,
      recvs: this.recvs,
    }
  }
}
