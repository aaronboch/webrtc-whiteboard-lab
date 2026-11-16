// Transport abstraction (docs/plan/01-architecture.md §2): the whiteboard only
// calls send(op) and onOp(cb). The variants differ only in their DataChannel
// options; V3 (reliable.ts) will wrap the channel later.

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
  onOp(cb: (op: Op) => void): void
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
 * Ops sent while the channel is not open are dropped (they then count as
 * lost, which is what they are).
 */
export function createTransport(dc: RTCDataChannel): Transport {
  let handler: ((op: Op) => void) | null = null
  dc.onmessage = (event) => handler?.(JSON.parse(event.data) as Op)
  return {
    send(op) {
      if (dc.readyState === 'open') dc.send(JSON.stringify(op))
    },
    onOp(cb) {
      handler = cb
    },
  }
}
