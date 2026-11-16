// Transport abstraction (docs/plan/01-architecture.md §2): the whiteboard only
// calls send(op) and onOp(cb). The variants differ only in their DataChannel
// options; V3 (reliable.ts) will wrap the channel later.

import { now, type Metrics } from './metrics'

/** One line segment. `seq` (per drawing peer) is the op id. */
export interface Op {
  seq: number
  strokeId: number
  x0: number
  y0: number
  x1: number
  y1: number
  color: string
  width: number
  /** performance.timeOrigin + performance.now() when sent. */
  tSend: number
}

export type Variant = 'v1' | 'v2'

/**
 * DataChannel options per variant. Only the offerer's options take effect;
 * it also names the channel after its variant, so the answerer can read
 * the variant actually in use from `dc.label`.
 */
export const CHANNEL_OPTIONS: Record<Variant, RTCDataChannelInit> = {
  v1: { ordered: false, maxRetransmits: 0 },
  v2: { ordered: true },
}

export interface Transport {
  send(op: Op): void
  /** `tRecv`: arrival time, taken first thing in onmessage (same as the metrics). */
  onOp(cb: (op: Op, tRecv: number) => void): void
}

/**
 * Variant from the `?variant=` URL parameter. Missing means v1; an unknown
 * value throws, so a typo can't silently run the wrong variant.
 */
export function parseVariant(param: string | null): Variant {
  if (param === null) return 'v1'
  // hasOwn, not `in`: `in` also accepts inherited keys like "toString".
  if (Object.hasOwn(CHANNEL_OPTIONS, param)) return param as Variant
  throw new Error(`unknown variant ${JSON.stringify(param)} (expected v1 or v2)`)
}

/**
 * Transport over an open DataChannel. JSON encoding for every variant.
 * Records every message in `metrics`. An op sent while the channel is not
 * open is recorded but dropped, so it counts as lost, which is what it is.
 * Message sizes are string lengths: the JSON is pure ASCII, so they equal
 * the UTF-8 byte counts.
 */
export function createTransport(dc: RTCDataChannel, metrics: Metrics): Transport {
  let handler: ((op: Op, tRecv: number) => void) | null = null
  dc.onmessage = (event) => {
    const t = now() // first, before parsing
    const op = JSON.parse(event.data) as Op
    metrics.recordRecv(op.seq, op.tSend, t, event.data.length)
    handler?.(op, t)
  }
  return {
    send(op) {
      const message = JSON.stringify(op)
      metrics.recordSend(op.seq, op.tSend, message.length)
      if (dc.readyState === 'open') dc.send(message)
    },
    onOp(cb) {
      handler = cb
    },
  }
}
