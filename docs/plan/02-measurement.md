# 02 – Measurement & Visualization

## 1. Clock

Both browsers run on the same kernel, so they share one clock. Timestamps use `performance.timeOrigin + performance.now()`, which gives sub-millisecond, directly comparable times on both peers. One-way latency therefore needs **no clock synchronization**. State this explicitly in the report.

- Latency is measured when the message arrives at the app (`onmessage`), not when the canvas is painted.
- **Sanity check:** under the `ideal` profile, latencies must never be negative, and p50 should be about 0.1–1 ms.

## 2. Workload

An in-page, seeded, deterministic stroke generator lives in `workload.ts`:

- Strokes are random Bézier curves.
- Points are sampled at 60 Hz with `setInterval`, which gives about 60 ops/s while drawing. `requestAnimationFrame` is not used, because it pauses in headless and background pages.
- Each stroke lasts 1–2 s, followed by a 0.3 s pause.
- One run draws for 30 s, which is about 1,800 ops.

Playwright only calls `page.evaluate("app.startWorkload(seed, durationS)")`.

**Repetitions** use the **same workload seed**, so every variant and every repetition sends an identical op stream. The only thing that varies between repetitions is netem's randomness, which is fixed per repetition by a netem seed (`01` §4), so every run can be reproduced.

**Peers and direction:** the app supports N peers (`01` §2), but measurements use 2 peers and one direction (A draws, B receives), which keeps the metrics clean. Multi-peer and bidirectional drawing are for the demo only.

## 3. Logging

Logs are kept in memory in the page, per link (remote `peerId`), and dumped once at the end through `page.evaluate("app.dumpMetrics()")`. Avoid per-event `console.log`, because it disturbs the timing.

| Where | What |
|---|---|
| Sender | `send {seq, t, bytes, kind: data \| retransmit \| redundant \| control}` |
| Sender | `dc.bufferedAmount` sampled every 50 ms. SCTP congestion control throttles even V1 under loss, and this makes it visible. |
| Receiver | `recv {seq, t, duplicate, viaRepair}` |
| Receiver (V3) | feedback messages sent (ACK / NACK / stroke status) |
| Both | `pc.getStats()` snapshot at start and end: data-channel `messagesSent`/`messagesReceived` and `bytesSent`/`bytesReceived`, transport bytes, candidate-pair RTT |
| Orchestrator | `tc -s qdisc show` per namespace, final screenshots of both canvases, `meta.json` |

**Wire bytes come from `tc -s`; no tcpdump needed.** For each namespace's `eth0`, `tc -s` reports `Sent <bytes> <packets>` and `dropped`. Each namespace only carries its own peer's traffic, and netem is freshly added per run, so these counters are the exact per-run wire volume, including IP/UDP/DTLS/SCTP headers. They also include V2's internal SCTP retransmissions and ACKs, which are invisible at app level.

`meta.json` contains:

- variant name and full option set
- profile and the exact netem command
- workload seed, netem seed, repetition index
- Chrome, kernel and iproute2 versions
- git commit
- timestamps (start, netem applied, workload start/end, drain end)

## 4. Run flow (per variant × profile × repetition)

Once per session: set up the namespaces (idempotent) and start the signaling server.

Per run:

1. Launch **two separate Chrome processes**, A in `ns_a` and B in `ns_b`, via `chrome-ns.sh`, each with a fresh profile.
2. Open the page, signal, and wait for `dc.onopen` on both sides.
3. Apply netem to both namespaces.
4. Warm up for 3 s.
5. Start the workload and draw for 30 s.
6. Drain for 10 s, which lets V2's backlog and V3's repair finish.
7. Collect the logs, getStats data, `tc -s` output and screenshots.
8. Clear netem and close both browsers.

Output goes to `runs/<timestamp>/<variant>/<profile>/rep<k>/`:

```
events_a.json  events_b.json  stats.json  tc.txt  meta.json  canvas_a.png  canvas_b.png
```

## 5. Metrics (`analysis/analyze.py`)

**Definitions:**

- For op *i*, identified by `(peerId, seq)`: `L_i = t_recv_first(i) − t_send(i)`.
- `d_base` = the profile's configured one-way base delay (e.g. 30 ms for `loss10`, 80 ms for `bad`, 0 for `ideal`).
- Excess latency: `E_i = L_i − d_base`. This is the delay caused by loss, jitter and retransmission, beyond the unavoidable network delay.

### Aktualität (timeliness)

- p50, p95, p99 and max of `L` over delivered ops.
- **Live ratio `R_D`:** the share of *all* sent ops delivered with excess latency `E_i ≤ D`, for D ∈ {50, 150, 500} ms. This is the headline metric, because it penalizes both loss and lateness.
  - Deadlines are relative to `d_base`, so profiles with a large base delay can still separate the variants. With absolute deadlines, `R_100` under `bad` would be about 0 for everyone.
- Latency over send time. This plot shows head-of-line blocking spikes in V2.

### Vollständigkeit (completeness)

- **`C_final`** = delivered / sent after the drain phase. This is computed exactly from the `seq` sets.
- The `C(t)` curve: completeness over time.
- Time-to-complete: the last op's arrival relative to the end of drawing.

### Kommunikationsaufwand (overhead)

- **Wire overhead ratio** = wire bytes in both directions (`tc -s` Sent, summed over both namespaces) / useful payload bytes. Useful payload bytes = the summed JSON size of all original ops.
- App-level message and byte counts, split into data, retransmit, redundant and control.
- Packets dropped by netem (from `tc -s`), for context.

### Mean behavior ("verbessertes mittleres Verhalten")

**Mean effective latency:** the mean of `L_i` over *all* sent ops.

- An op that is still missing at the end counts as `t_end_of_drain − t_send(i)`, which is how long it had actually been missing when measurement stopped. This is the standard right-censored definition.
- Always report it together with `C_final` and `R_150`, because it depends on the drain length.

## 6. Statistics & plots (`analysis/plots.py`)

Use 5 repetitions per cell (10 for the final key comparisons if time allows), and report mean ± 95% CI. Figures:

- A latency CDF per profile, with one line per variant.
- `R_150` and `C_final` against loss rate (sweep).
- Overhead ratio per variant (bar chart).
- Latency over send time for one representative run per variant (head-of-line blocking).
- The V3 comparison: all implemented options side by side on the same axes.
- The ground-truth overlay figure (see §7).

## 7. Visualization in the whiteboard: core (kept minimal)

- **Canvas** with two modes, toggled by the control bar or the `H` key:
  - **True color:** the segments as drawn.
  - **Latency heatmap:** each segment is colored by `L` on a continuous scale from green (≤ 50 ms) through yellow to red (≥ 500 ms, clamped). A small legend sits in the corner.
- Segments repaired by V3 get a thin outline, so repairs are visible.
- Missing segments are simply absent.
- **HUD:** variant, current network profile, connected peers, received / sent, and the live p95.
- **Control bar** (live testing only): profile dropdown, clear local / clear all, view mode (see `01` §2 "Live controls").
- **Ground-truth overlay (report figure):** `plots.py` renders it from the logs, with received segments colored by latency and missing ones in gray. It needs no browser work.
- *Only if time:* the pixel-diff percentage between the sender's and receiver's final canvas. Completeness is already exact via `seq`.

## 8. Nice-to-have live visualizations (decide later)

These are optional additions for live testing and the demo. None of them is needed for the measurements. Some show things the numbers already measure but that are much easier to understand visually; others add information the core view lacks. Each one is independent of the others.

Effort: **S** ≈ a few hours, **M** ≈ 1–2 days, **L** ≈ several days.

| # | Idea | What you see | Why it's worth it | Effort |
|---|---|---|---|---|
| N1 | **Packet strip** | A horizontal strip of the last ~200 ops from each remote, one cell per `seq`: green = on time, yellow = late, red = missing, blue = repaired (V3), and gray = not yet due. It scrolls with time. | Shows loss, lateness and repair at a glance. V1 shows red holes that stay red. V2 shows red that turns yellow in blocks (head-of-line blocking). V3 shows red that quickly turns blue. **Probably the best single visual for the talk.** | S–M |
| N2 | **Live latency graph** | A rolling line chart of per-op latency over the last 10 s, with a dashed line at the base delay. | Makes V2's latency spikes and catch-up bursts visible as they happen. It's the live version of the "latency over send time" report plot. | S |
| N3 | **Inferred missing segments** | Missing segments drawn as thin gray dashed lines while they're missing. They disappear once repaired. | Consecutive segments of a stroke share endpoints (`x1,y1` of op k = `x0,y0` of op k+1), so a single missing segment can be reconstructed exactly from its neighbors. This makes *missing* visible, not just absent, without any extra network traffic. | S |
| N4 | **Late-arrival flash** | Segments that arrive later than a threshold (e.g. base delay + 150 ms) briefly flash or fade in. | V2's catch-up bursts look like a wave of flashes, and V3's repairs look like individual flashes. Shows *when* things arrive, not just how late. | S |
| N5 | **Fading heatmap** | Heatmap colors fade back to the true color after ~5 s. | Combines both modes: the board stays readable, and only recent network behavior is highlighted. Good for long live sessions. | S |
| N6 | **Network panel** | Live numbers per link: RTT (getStats), send rate and receive rate (kbit/s), wire overhead ratio, `bufferedAmount` gauge, and V3 loss estimate / retransmit count. | The `bufferedAmount` gauge shows SCTP's congestion backlog growing under loss, an effect that is hard to explain otherwise. The overhead ratio shows the cost of V3's redundancy live. | M |
| N7 | **Side-by-side variant comparison** | One sender connected to 3 receivers in the same namespace (`ns_b`), one link each with V1, V2 and V3, all side by side. The same strokes go through the same network at the same time. | Directly compares all variants under identical conditions in one view. **The strongest demo**, and it builds on the per-link design (`01` §2). The receiver requests its variant via the signaling join message, and the offerer creates that link's DataChannel accordingly. | M |
| N8 | **Live variant switch** | A dropdown that changes the variant without reloading: the link's DataChannel is closed and recreated with the new options. | More convenient than reloading the page with a different `?variant=`. Mostly redundant if N7 exists. | M |
| N9 | **Replay mode** | Load a recorded run (`events_*.json`) into the page and replay it in real time, showing how the receiver experienced it. Includes the heatmap and the packet strip. | Presentations can show real measurement runs without the VM or live network risk. | M–L |
| N10 | **Freeze / scrub** | Pause the live view and inspect a segment: hover shows `seq`, latency and whether it was repaired. | Helpful for debugging V3, and for answering questions in the talk. | M |

**Suggested picks if time is limited:**

- N1 (packet strip) and N3 (inferred missing segments) are cheap and explain the core behavior best.
- N7 (side-by-side) is the most convincing demo.
- N2 (latency graph) is close to free once N1 exists, because it uses the same data.
