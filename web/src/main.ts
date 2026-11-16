// Wiring: signaling -> peer connection -> transport -> whiteboard + HUD.

import './style.css'
import { Hud } from './hud'
import { Metrics, now, type MetricsDump } from './metrics'
import { Peer } from './peer'
import { Signaling, signalingUrl } from './signaling'
import { createTransport, parseVariant, type Transport } from './transport'
import { Whiteboard } from './whiteboard'
import { generateScript, runWorkload, type WorkloadTiming } from './workload'

const params = new URLSearchParams(location.search)
const variant = parseVariant(params.get('variant'))
const auto = params.get('auto') === '1'

const metrics = new Metrics(variant)

// Automation API (extended in step 2.5); also handy from the DevTools console.
declare global {
  interface Window {
    app: {
      dumpMetrics(): MetricsDump
      startWorkload(seed: number, durationS: number): Promise<WorkloadTiming>
      snapshotStats(label: string): Promise<void>
    }
  }
}
window.app = {
  dumpMetrics: () => metrics.dump(),
  /** Draws the seeded script through the normal local path; resolves when done. */
  async startWorkload(seed, durationS) {
    if (!transport) throw new Error('startWorkload: DataChannel not open')
    const timing = await runWorkload(generateScript(seed, durationS), (s) => board.draw(s))
    metrics.setWorkload({ seed, durationS, ...timing })
    return timing
  },
  /** Store a filtered getStats() report under `label` (e.g. 'start', 'end'). */
  async snapshotStats(label) {
    const t = now()
    const report = await peer.getStats()
    if (!report) throw new Error('snapshotStats: no connection')
    metrics.addSnapshot(label, t, await report)
  },
}

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

const updateCounts = () => hud.setCounts(metrics.sentCount, metrics.receivedCount)

function clearBoard(): void {
  board.clear()
  metrics.reset()
  updateCounts()
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
    updateCounts()
  },
})

const peer = new Peer(variant, (data) => signaling.sendSignal(data), {
  onOpen(dc) {
    // The offerer named the channel after its variant; that one is running.
    hud.setVariant(dc.label)
    metrics.setVariant(dc.label)
    metrics.startSampling(dc)
    transport = createTransport(dc, metrics)
    transport.onOp((op) => {
      board.addRemote(op)
      updateCounts()
    })
    setStatus('channel open')
  },
  onClose() {
    transport = null
    metrics.stopSampling()
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
  onFull: () => setStatus('server full (2 peers already connected), retrying'),
  onDisconnected: () => setStatus('signaling server unreachable, retrying'),
  onClear: clearBoard,
})
