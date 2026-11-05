# 04 – Milestones (step by step)

Each step is small, has a concrete "done when", and builds on the previous ones. Week numbers are relative to the project start. 

Rule of thumb: **commit after every step**, and add a line to `docs/llm-usage.md` whenever AI helped with that step.

---

## Phase 0: Environment (weeks 1–2)

| Step | Task | Done when |
|---|---|---|
| 0.1 | Create a Debian 13 arm64 VM in UTM (≥ 4 vCPUs) with XFCE (or KDE) and a sudo user. Take a VM snapshot "clean". | VM boots; snapshot exists |
| 0.2 | Install Google Chrome arm64, Node LTS, `uv`, Python 3, `iproute2`. Pin Chrome with `apt-mark hold google-chrome-stable`. Document every command in `docs/vm-setup.md` while doing it. | Following `docs/vm-setup.md` on a fresh install reproduces the setup |
| 0.3 | Repo skeleton: `web/` (Vite vanilla-ts template), `server/`, `harness/`, `analysis/`, `configs/`, `pyproject.toml`. `.gitignore`: `runs/`, `node_modules/`, `dist/`. | `npm run dev` and `uv run python -c "import playwright"` both work |
| 0.4 | `harness/netns.py up / down / status`: creates `br0`, `ns_a`, `ns_b` and the veth pairs; idempotent. | `sudo ip netns exec ns_a ping 10.10.0.3` works; running `up` twice causes no error |
| 0.5 | `harness/netem.py apply <ns> "<args>" / clear / stats` | `ping` shows +delay; `ping -c 500` with 10% loss shows about 10% loss; `stats` shows drops |
| 0.6 | `harness/chrome-ns.sh` (`exec ip netns exec "$NETNS" google-chrome --no-sandbox "$@"`) + a 20-line Playwright test script run as root: launch Chrome in `ns_a` via `executable_path` and load a page from `http://10.10.0.1:8000` (`python -m http.server`). | The page loads inside the namespace and Playwright prints its title; a headed launch works after `xhost +SI:localuser:root` |

## Phase 1: Whiteboard and WebRTC (weeks 2–4)

| Step | Task | Done when |
|---|---|---|
| 1.1 | `server/signaling.py`: aiohttp, `/ws?room=x`; on join, sends the peer list and notifies the others; forwards messages addressed `{from, to}`; serves `web/dist` statically. | Three browser tabs in one room see the join events and addressed messages (log) |
| 1.2 | `web/src/signaling.ts` + `web/src/mesh.ts`: a joining peer offers to every existing peer (and creates the DataChannel); existing peers answer. One `RTCPeerConnection` per remote. | Two tabs on the Mac show "channel open"; a third tab joining opens channels to both |
| 1.3 | `web/src/transport.ts`: `Transport` interface (`send(op)`, `onOp(cb)`), factory for V1 and V2 from the `?variant=` URL param. | A test message goes A→B in each variant |
| 1.4 | Op model (`peerId`, per-peer `seq`) + `web/src/whiteboard.ts`: draw locally with the mouse, turn moves into segments, send them to all peers, render remote segments. | Manual drawing works between 3 tabs, everyone drawing, for all variants |
| 1.5 | Minimal HUD: variant, connected peers, ops sent/received. | Visible in all tabs |
| 1.6 | Control bar, part 1: clear local, and clear all (`{type:'clear'}` via the signaling WebSocket); view-mode toggle placeholder. | "Clear all" in one tab clears all 3 tabs, also with V1 |
| 1.7 | First real test: two headed Chromes in `ns_a`/`ns_b` via `chrome-ns.sh`, draw by hand, apply `loss10` with `netem.py`. | Visibly: V1 has gaps, V2 has stalls and catch-up bursts |


## Phase 2: Measurement in the page (weeks 4–5)

| Step | Task | Done when |
|---|---|---|
| 2.1 | `web/src/metrics.ts`: `now()` = `performance.timeOrigin + performance.now()`; in-memory send/recv event arrays; `dumpMetrics()` returns JSON. | After drawing, `dumpMetrics()` in DevTools shows events with plausible latencies |
| 2.2 | `web/src/workload.ts`: seeded PRNG (e.g. mulberry32), Bézier strokes, 60 Hz point timer, `startWorkload(seed, durationS)`. | The same seed twice gives the same op list (compare hashes) |
| 2.3 | getStats snapshots (start/end) + `bufferedAmount` sampler every 50 ms, included in `dumpMetrics()`. | Values present in the dump |
| 2.4 | Heatmap mode on the receiver (color by `now() − op.tSend`), legend, toggle key. | Under netem, delayed parts appear red in V2 |
| 2.5 | Automation API: `window.app = { waitOpen(), startWorkload(), isDone(), dumpMetrics() }`; `?auto=1` disables mouse input. | Every function works from the DevTools console |

## Phase 3: Orchestrator (weeks 5–7)

| Step | Task | Done when |
|---|---|---|
| 3.1 | `configs/experiment.yaml` + loader: expands variants × profiles × repetitions into a list of runs. | `--dry-run` prints the list of runs |
| 3.2 | Start the signaling server once per session. `run_once()`: launch both browsers in their namespaces, open the page, wait for the channel to open, apply netem, warm up 3 s, run the workload, drain, `dumpMetrics()`, clear netem, close the browsers. | A single `v1/ideal` run writes `events_a.json` + `events_b.json` |
| 3.3 | Add `meta.json` (variant, profile, netem args, workload and netem seed, Chrome/kernel/iproute2 versions, git commit, timestamps), `tc.txt` and screenshots. | Run folder complete |
| 3.4 | Matrix loop with `try/finally` cleanup (netem always cleared, browsers closed); skip already finished runs (resume). | Killing it halfway and restarting continues the campaign |
| 3.5 | `--manual [--peers N] [--profile P] [--variant V]`: set up the environment and open N headed browsers (peer 1 in `ns_a`, the others in `ns_b`), no workload; clear netem on Ctrl+C. | You can draw by hand in all windows with the chosen profile active |
| 3.6 | Control bar, part 2: live profile switching. The dropdown sends `set_profile` over the signaling WebSocket; the server (manual mode) runs `tc qdisc replace` in both namespaces and broadcasts `profile_changed`; the HUD shows the current profile. | Switching `ideal` → `loss10` → `ideal` while drawing changes the behavior visibly, with no reconnect |

**Optional, any time after Phase 3:** the nice-to-have live visualizations N1–N10 from `02-measurement.md` §8. Pick them individually; none of them blocks anything else.


## Phase 4: Analysis + stage-1 results (weeks 7–8)

| Step | Task | Done when |
|---|---|---|
| 4.1 | `analysis/analyze.py`: load a run folder and join sends and receives by `seq` into a per-op DataFrame (`t_send`, `t_recv_first`, `L`, `kind`). | Prints the per-op table for one run |
| 4.2 | Per-run metrics: p50/p95/p99, `R_50/150/500` (on excess latency), `C_final`, `C(t)`, wire overhead ratio (from `tc -s`), mean effective latency (censored). Writes `metrics.csv`. | Values match a hand check of one run |
| 4.3 | Aggregation across repetitions: mean ± 95% CI per (variant, profile). | `summary.csv` |
| 4.4 | `analysis/plots.py`: latency CDF, latency over send time, `R_150`/`C_final` against loss rate, overhead bars, ground-truth overlay. | PNG/PDF figures in `runs/<ts>/figures/` |
| 4.5 | Sanity checks from the checklist below (ideal profile, netem drops). | All checks pass |
| 4.6 | **Stage-1 campaign: V1 and V2 across all profiles.** | First results figures |


## Phase 5: V3 reliability layer (weeks 8–12)

Options as described in `03-v3-reliability-options.md`. The order below reuses code at every step, and you can stop after any step.

| Step | Task | Done when |
|---|---|---|
| 5.1 | `reliable.ts` framework (one instance per link): packet encode/decode, receiver dedup + received-set, sender history buffer with per-remote acks, tick timer, config flags. | With all mechanisms off it produces the same results as V1 |
| 5.2 | **Unit-test harness:** an in-memory fake channel with seeded loss, delay and reordering (vitest). All V3 logic gets tested here without browsers. | Tests run in < 1 s with `npm test` |
| 5.3 | Feedback message + RTT estimator (echoed timestamps, srtt/rttvar). | Unit test: estimated RTT ≈ fake channel delay × 2 |
| 5.4 | **Option A:** SACK feedback, fast retransmit, RTO with backoff. | Unit test: 20% loss leads to 100% delivery. Browser run: `C_final` = 1 under `loss10`. |
| 5.5 | End-of-run: sender logs "all acked" time; retransmits are logged with `kind`. | Time-to-complete visible in metrics |
| 5.6 | **Option C:** redundancy K (piggyback last K ops). | `R_150` improves under `loss2`/`loss10`; limits are visible under `burst` |
| 5.7 | **Option E:** live-first (token bucket + `bufferedAmount` gate for retransmits; `adaptiveK` only if time). | `R_150` ≥ the A+C result without hurting `C_final` |
| 5.8 | **Option B:** NACK feedback + heartbeat (swaps the feedback module of A). | Unit + browser tests: `C_final` = 1, lower overhead than A at `loss2` |
| 5.9 | **Option D:** `STROKE_END` / `STROKE_STATUS` / `REPAIR` (D1; D2 with RDP only if time). | `C_final` = 1, lowest overhead of all V3 variants |
| 5.10 | Tuning: small sweeps over feedback interval, K and RTO floor; document the chosen values and why. | Parameter table for the report |


## Phase 6: Campaign, report, talk (weeks 12–16)

| Step | Task | Done when |
|---|---|---|
| 6.1 | Freeze the code and tag the commit (`v1.0-measurement`). | Tag exists |
| 6.2 | Full campaign overnight (see runtime estimate below): all variants × profiles × 5 repetitions + loss sweep for selected variants. | Complete `runs/<ts>/` + `summary.csv` |
| 6.3 | Final figures, plus a ground-truth overlay figure (missing segments in gray). | Figure set for the report |
| 6.4 | Report (10–15 pages): introduction, WebRTC/SCTP background, environment, method/metrics, V1 vs V2 results, V3 design, V3 results/ablation, discussion, AI usage. | Draft → final |
| 6.5 | Slides + live demo (`--manual` with a netem profile, heatmap on). | Demo rehearsed |
| 6.6 | `README.md`: VM setup, how to run a campaign, the analysis and the manual demo. | Someone else can reproduce a run from the README alone |
| 6.7 | Finalize `docs/llm-usage.md`. | Complete |

---

## Campaign runtime estimate

- One run takes about 50 s: ~5 s browser start + signaling, 3 s warm-up, 30 s drawing, 10 s drain, ~2 s collection.
- Example matrix: 7 variants × 7 profiles × 5 repetitions = 245 runs ≈ **3.4 h**.
- Plus the sweep: 3 variants × 7 loss values × 5 repetitions = 105 runs ≈ **1.5 h**.
- The full campaign of about 5 h runs overnight. Going to 10 repetitions doubles it, so use 10 only for the key comparisons.
- During development, use 1–2 repetitions and 2–3 profiles (a few minutes).

## Verification checklist (used in 4.5 and after every V3 step)

**Sanity on the `ideal` profile:**

- All variants reach `C_final = 1.0`.
- p50 latency ≈ 0.1–1 ms, and **no negative latencies** (clock check).
- V3 overhead matches the expected header and feedback cost.

**Netem check:** `tc -s` dropped ≈ (sent + dropped) × the configured loss %.

**Plausibility under `loss10`:**

| Variant | Expected |
|---|---|
| V1 | `C_final` ≈ 0.9, low p50 |
| V2 | `C_final` = 1.0, heavy p99 spikes in the latency-over-time plot (head-of-line blocking) |
| V3 (A/E) | `C_final` = 1.0, p50 close to V1 |

**Determinism:** the same seed gives an identical sender op log across variants.

**End to end:**

```
sudo uv run harness/orchestrator.py configs/experiment.yaml
uv run analysis/plots.py runs/<ts>
```

This produces the complete figure set.
