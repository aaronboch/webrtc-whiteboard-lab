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

/** dc.bufferedAmount over time: bytes queued in SCTP, not yet sent. */
export interface BufferedSample {
  t: number
  bufferedAmount: number
}

/** A filtered pc.getStats() report, taken at a named point of the run. */
export interface StatsSnapshot {
  label: string
  t: number
  stats: Record<string, unknown>[]
}

/** bufferedAmount sampling interval (docs/plan/02-measurement.md §3). */
const SAMPLE_MS = 50

/**
 * getStats entries worth keeping: message/byte counters of the channel, the
 * transport and the peer connection, plus the candidate pair in use (RTT).
 * Certificates, codecs, candidates etc. would only bloat the dump.
 */
const KEPT_STATS = new Set(['peer-connection', 'data-channel', 'transport', 'candidate-pair'])

/** The automated workload of this run, if one ran on this peer. */
export interface WorkloadInfo {
  seed: number
  durationS: number
  tStart: number
  tEnd: number
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
    workload: WorkloadInfo | null
  }
  sends: SendEvent[]
  recvs: RecvEvent[]
  samples: BufferedSample[]
  stats: StatsSnapshot[]
}

export class Metrics {
  private readonly requestedVariant: string
  private variant: string
  private sends: SendEvent[] = []
  private recvs: RecvEvent[] = []
  /** Distinct seqs received, for duplicate detection and the HUD count. */
  private readonly seen = new Set<number>()
  private sent = 0
  private workload: WorkloadInfo | null = null
  private samples: BufferedSample[] = []
  private snapshots: StatsSnapshot[] = []
  private sampler: ReturnType<typeof setInterval> | null = null

  constructor(requestedVariant: string) {
    this.requestedVariant = requestedVariant
    this.variant = requestedVariant
  }

  /** The variant actually running (from the DataChannel label). */
  setVariant(variant: string): void {
    this.variant = variant
  }

  /** Sample dc.bufferedAmount every SAMPLE_MS while the channel is open. */
  startSampling(dc: RTCDataChannel): void {
    this.stopSampling()
    this.sampler = setInterval(
      () => this.samples.push({ t: now(), bufferedAmount: dc.bufferedAmount }),
      SAMPLE_MS,
    )
  }

  stopSampling(): void {
    if (this.sampler !== null) clearInterval(this.sampler)
    this.sampler = null
  }

  addSnapshot(label: string, t: number, report: RTCStatsReport): void {
    const stats: Record<string, unknown>[] = []
    report.forEach((entry) => {
      if (!KEPT_STATS.has(entry.type)) return
      if (entry.type === 'candidate-pair' && !entry.nominated) return
      stats.push({ ...entry })
    })
    this.snapshots.push({ label, t, stats })
  }

  setWorkload(info: WorkloadInfo): void {
    this.workload = info
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
    this.workload = null
    this.samples = []
    this.snapshots = []
  }

  dump(): MetricsDump {
    return {
      meta: {
        variant: this.variant,
        requestedVariant: this.requestedVariant,
        timeOrigin: performance.timeOrigin,
        userAgent: navigator.userAgent,
        crossOriginIsolated: window.crossOriginIsolated,
        workload: this.workload,
      },
      sends: this.sends,
      recvs: this.recvs,
      samples: this.samples,
      stats: this.snapshots,
    }
  }
}
