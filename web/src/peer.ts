// The single RTCPeerConnection to the other peer (docs/plan/01-architecture.md §2).
// Driven by the signaling messages: start() on `paired`, handleSignal() on
// `signal`, close() on `peer_left`. Sends its own signals through a callback,
// so it does not depend on the Signaling class.

import type { SignalData } from './signaling'
import { CHANNEL_OPTIONS, type Variant } from './transport'

export interface PeerEvents {
  /** DataChannel open on both sides; ready for a Transport. */
  onOpen(dc: RTCDataChannel): void
  /** Connection or channel closed (partner left, page closed, ICE failed). */
  onClose(): void
}

export class Peer {
  private readonly variant: Variant
  private readonly sendSignal: (data: SignalData) => void
  private readonly events: PeerEvents

  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  /** Signaling steps run one after another, in arrival order. */
  private queue: Promise<void> = Promise.resolve()

  constructor(
    variant: Variant,
    sendSignal: (data: SignalData) => void,
    events: PeerEvents,
  ) {
    this.variant = variant
    this.sendSignal = sendSignal
    this.events = events
  }

  /**
   * Begin a connection after `paired`. The offerer creates the DataChannel
   * (with the variant's options) and the offer; the answerer waits for the
   * offer and receives the channel via `ondatachannel`.
   */
  start(offer: boolean): void {
    this.close()
    // No STUN/TURN: both peers sit on the same emulated network.
    const pc = new RTCPeerConnection()
    this.pc = pc

    pc.onicecandidate = (event) => {
      // A null candidate only marks the end of gathering.
      if (event.candidate) this.sendSignal({ candidate: event.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      // "disconnected" can recover on its own; "failed" cannot.
      if (pc.connectionState === 'failed' && this.pc === pc) this.close()
    }

    if (offer) {
      this.setupChannel(pc.createDataChannel(this.variant, CHANNEL_OPTIONS[this.variant]))
      this.enqueue(async () => {
        await pc.setLocalDescription() // creates the offer
        this.sendSignal({ sdp: pc.localDescription!.toJSON() })
      })
    } else {
      pc.ondatachannel = (event) => this.setupChannel(event.channel)
    }
  }

  /**
   * Apply a signal from the partner. Signals are processed strictly in
   * order (promise chain): an ICE candidate applied before the remote
   * description would fail.
   */
  handleSignal(data: SignalData): void {
    // Bind to the current connection now, so a step that is still queued
    // when the connection is replaced can't touch the new one.
    const pc = this.pc
    if (!pc) return
    this.enqueue(async () => {
      if ('sdp' in data) {
        await pc.setRemoteDescription(data.sdp)
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription() // creates the answer
          this.sendSignal({ sdp: pc.localDescription!.toJSON() })
        }
      } else {
        await pc.addIceCandidate(data.candidate)
      }
    })
  }

  /** getStats() of the current connection, or null if there is none. */
  getStats(): Promise<RTCStatsReport> | null {
    return this.pc ? this.pc.getStats() : null
  }

  /**
   * Tear down the connection (partner left, channel closed, ICE failed).
   * Safe to call repeatedly; onClose fires once per connection. A new
   * start() may follow.
   */
  close(): void {
    const { pc, dc } = this
    if (!pc) return
    this.pc = null
    this.dc = null
    this.queue = Promise.resolve() // leftover steps fail harmlessly on the old pc
    dc?.close()
    pc.close()
    this.events.onClose()
  }

  private setupChannel(dc: RTCDataChannel): void {
    this.dc = dc
    // Ignore events of a channel that has already been replaced.
    dc.onopen = () => {
      if (this.dc === dc) this.events.onOpen(dc)
    }
    dc.onclose = () => {
      if (this.dc === dc) this.close()
    }
  }

  private enqueue(step: () => Promise<void>): void {
    this.queue = this.queue
      .then(step)
      .catch((err) => console.error('signaling step failed:', err))
  }
}
