// Wiring: signaling -> peer connection -> transport.
// Temporary test UI for steps 1.2/1.3 (status line + "send test op");
// the whiteboard replaces it in step 1.4.

import './style.css'
import { Peer } from './peer'
import { Signaling, signalingUrl } from './signaling'
import { checkChannel, createTransport, parseVariant, type Transport } from './transport'

const now = () => performance.timeOrigin + performance.now()

const variant = parseVariant(new URLSearchParams(location.search).get('variant'))

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = '<p id="status"></p><button id="send">send test op</button>'
const statusEl = app.querySelector<HTMLParagraphElement>('#status')!
const setStatus = (text: string) => (statusEl.textContent = `${variant}: ${text}`)

let transport: Transport | null = null
let seq = 0

const peer = new Peer(variant, (data) => signaling.sendSignal(data), {
  onOpen(dc) {
    const warning = checkChannel(dc, variant)
    if (warning) console.warn(warning)
    transport = createTransport(dc)
    transport.onOp((op) =>
      console.log(`received op ${op.seq}, latency ${(now() - op.tSend).toFixed(2)} ms`),
    )
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
  onClear: () => console.log('clear'),
})

app.querySelector('#send')!.addEventListener('click', () => {
  transport?.send({
    seq: seq++, strokeId: 0, x0: 0, y0: 0, x1: 10, y1: 10,
    color: '#000', width: 2, tSend: now(),
  })
})
