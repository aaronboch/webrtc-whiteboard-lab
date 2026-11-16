// Wiring: signaling -> peer connection -> transport -> whiteboard + HUD.

import './style.css'
import { Hud } from './hud'
import { Peer } from './peer'
import { Signaling, signalingUrl } from './signaling'
import { createTransport, parseVariant, type Transport } from './transport'
import { Whiteboard } from './whiteboard'

const now = () => performance.timeOrigin + performance.now()

const params = new URLSearchParams(location.search)
const variant = parseVariant(params.get('variant'))
const auto = params.get('auto') === '1'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = '<header id="bar"></header><div id="board"></div>'

const hud = new Hud(app.querySelector<HTMLElement>('#bar')!, {
  variant,
  showControls: !auto,
  onClearLocal: clearBoard,
  // The server echoes `clear` to both peers, this one included.
  onClearAll: () => signaling.sendClear(),
})
const setStatus = (text: string) => hud.setState(text)

function clearBoard(): void {
  board.clear()
  hud.resetCounts()
}

let transport: Transport | null = null
let seq = 0

// Each peer draws in its own color, so the demo shows who drew what.
const PALETTE = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e']
const board = new Whiteboard(app.querySelector<HTMLDivElement>('#board')!, {
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  width: 3,
  onDraw(segment) {
    if (!transport) return // not connected: drawn locally only
    transport.send({ ...segment, seq: seq++, tSend: now() })
    hud.countSent()
  },
})

const peer = new Peer(variant, (data) => signaling.sendSignal(data), {
  onOpen(dc) {
    // The offerer named the channel after its variant; that one is running.
    hud.setVariant(dc.label)
    transport = createTransport(dc)
    transport.onOp((op) => {
      board.addRemote(op)
      hud.countReceived()
    })
    setStatus('channel open')
  },
  onClose() {
    transport = null
    hud.setVariant(null)
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
  onClear: clearBoard,
})
