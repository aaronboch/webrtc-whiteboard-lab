// WebSocket client for server/signaling.py (see its docstring for the protocol).
// Only carries pairing, WebRTC signaling and control messages; whiteboard
// ops never go through here.

/** Payload of a `signal` message: an SDP offer/answer or an ICE candidate. */
export type SignalData =
  | { sdp: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit }

/** Messages the server sends to a client. */
export type ServerMessage =
  | { type: 'wait' }
  | { type: 'paired'; offer: boolean }
  | { type: 'peer_left' }
  | { type: 'full' }
  | { type: 'signal'; data: SignalData }
  | { type: 'clear' }

/** Messages a client sends to the server (`set_profile` follows in step 3.6). */
type ClientMessage =
  | { type: 'signal'; data: SignalData }
  | { type: 'clear' }

export interface SignalingHandlers {
  /** Waiting for a partner (first peer, or after `peer_left`). */
  onWait(): void
  /** Partner present; `offer` = this side creates the DataChannel and offers. */
  onPaired(offer: boolean): void
  onSignal(data: SignalData): void
  onPeerLeft(): void
  /** Server already has 2 peers; the connection is closed, a retry follows. */
  onFull(): void
  /** Connection to the server lost (not after `full`); a retry follows. */
  onDisconnected(): void
  onClear(): void
}

/** Delay before reconnecting after `full` or a lost connection. */
const RETRY_MS = 1000

/** ws://<host the page came from>/ws (Vite proxies it during development). */
export function signalingUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/ws`
}

export class Signaling {
  private readonly url: string
  private readonly handlers: SignalingHandlers
  private ws!: WebSocket

  constructor(url: string, handlers: SignalingHandlers) {
    this.url = url
    this.handlers = handlers
    this.connect()
  }

  /**
   * Open the WebSocket and reconnect whenever it closes. This covers the
   * reload race: the new page can connect before the server has seen the
   * old page's close (slow under netem loss) and gets `full`; the retry a
   * second later succeeds. It also survives a server restart.
   */
  private connect(): void {
    const ws = new WebSocket(this.url)
    this.ws = ws
    let full = false
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage
      if (msg.type === 'full') full = true
      this.dispatch(msg)
    }
    ws.onclose = () => {
      if (!full) this.handlers.onDisconnected()
      setTimeout(() => this.connect(), RETRY_MS)
    }
  }

  /** Send an offer/answer/ICE candidate to the partner. */
  sendSignal(data: SignalData): void {
    this.send({ type: 'signal', data })
  }

  /** Ask the server to clear both peers' canvases. */
  sendClear(): void {
    this.send({ type: 'clear' })
  }

  private dispatch(msg: ServerMessage): void {
    const h = this.handlers
    switch (msg.type) {
      case 'wait':
        return h.onWait()
      case 'paired':
        return h.onPaired(msg.offer)
      case 'signal':
        return h.onSignal(msg.data)
      case 'peer_left':
        return h.onPeerLeft()
      case 'full':
        return h.onFull()
      case 'clear':
        return h.onClear()
    }
  }

  /**
   * Messages sent while the socket is not open are dropped. That only
   * affects a "clear" clicked before connecting: signals are only sent
   * after `paired`, which itself arrives over the open socket.
   */
  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }
}
