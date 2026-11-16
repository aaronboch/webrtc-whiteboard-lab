// Wiring: signaling -> peer connection -> transport -> whiteboard.

import './style.css'
import { Peer } from './peer'
import { Signaling, signalingUrl } from './signaling'
import { checkChannel, createTransport, parseVariant, type Transport } from './transport'
import { Whiteboard } from './whiteboard'

const now = () => performance.timeOrigin + performance.now()

const variant = parseVariant(new URLSearchParams(location.search).get('variant'))

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = '<p id="status"></p><div id="board"></div>'
const statusEl = app.querySelector<HTMLParagraphElement>('#status')!
const setStatus = (text: string) => (statusEl.textContent = `${variant}: ${text}`)

let transport: Transport | null = null
let seq = 0

// Each peer draws in its own color, so the demo shows who drew what.
const PALETTE = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e']
const board = new Whiteboard(app.querySelector<HTMLDivElement>('#board')!, {
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  width: 3,
  onDraw: (segment) => transport?.send({ ...segment, seq: seq++, tSend: now() }),
})

const peer = new Peer(variant, (data) => signaling.sendSignal(data), {
  onOpen(dc) {
    const warning = checkChannel(dc, variant)
    if (warning) console.warn(warning)
    transport = createTransport(dc)
    transport.onOp((op) => board.addRemote(op))
    setStatus(warning ? 'channel open (variant mismatch, see console)' : 'channel open')
  },
  onClose() {
    transport = null
    setStatus('connection closed')
  },
})

const signaling = new Signaling(signalingUrl(), {
  onWait: () => setStatus('waiting for partner'),
  onPaired(offer) {
    setStatus(offer ? 'connecting (offering)' : 'connecting (answering)')
    peer.start(offer)
  },
  onSignal: (data) => peer.handleSignal(data),
  onPeerLeft() {
    peer.close()
    setStatus('partner left, waiting')
  },
  onFull: () => setStatus('server full (2 peers already connected)'),
  onClear: () => board.clear(),
})
