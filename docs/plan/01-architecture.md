# 01 – Architecture & Test Environment

## 1. Repo layout

```
hands/
  web/                   TS + Vite + Canvas2D (static build)
    src/main.ts            UI wiring, URL params (?variant=v1&role=sender&auto=1)
    src/signaling.ts       WebSocket client: join room, peer list, addressed offer/answer/ICE
    src/mesh.ts            one RTCPeerConnection + Transport per remote peer; broadcast ops
    src/transport.ts       Transport interface + V1/V2 (plain DataChannel)
    src/reliable.ts        V3 reliability layer (wraps an unreliable DataChannel)
    src/whiteboard.ts      canvas rendering: true color + latency heatmap
    src/workload.ts        seeded deterministic stroke generator
    src/metrics.ts         in-memory event log, getStats sampling, dump()
  server/signaling.py    aiohttp: WS signaling rooms + serves web/dist (~60 lines)
  harness/
    orchestrator.py        runs the experiment matrix (as root)
    netns.py               create/destroy namespaces, bridge, veth (idempotent)
    netem.py               apply/clear profiles, read `tc -s`
    chrome-ns.sh           2-line wrapper: start Chrome inside a namespace
  configs/experiment.yaml  variants, profiles, sweep, repetitions, durations, seed
  analysis/analyze.py      logs → metric tables (pandas)
  analysis/plots.py        matplotlib figures for the report
  runs/                    results (gitignored)
  README.md                setup + run instructions
```

**Stack:**

- Web: TypeScript, Vite, Canvas2D.
- Python 3, managed with `uv`: `playwright`, `aiohttp`, `pyyaml`, `pandas`, `matplotlib`.

## 2. Application components

### Peers: N-peer mesh in the app, 2 peers in measurements

**The app supports any number of peers** in a room, connected as a **full mesh**:

- Every pair of peers has its own `RTCPeerConnection` with one DataChannel.
- Every peer can draw. Each op is sent to all connected peers.
- Each peer gets a random `peerId` when it joins.
- **Who offers:** a peer that joins sends offers to all peers already in the room, and the existing peers answer. Only one side of each pair ever offers, so the two sides never send offers to each other at the same time (glare).
- A full mesh is fine for a whiteboard with a handful of peers. No media server (SFU) is needed.

**Measurements use exactly 2 peers.** Peer A draws (`?role=sender`, the automated workload runs here), and peer B only receives and measures (`?role=receiver`). Two peers are enough to compare V1–V3, and they keep the metrics clean.

- `role` only tells the automation which peer runs the workload.
- In manual mode, `role` is omitted and everyone draws.

**Per-link design:** everything in this plan is per *link*:

- Transport variant
- V3 state
- Metrics

A peer with 3 remotes simply has 3 links. Nothing in V1–V3 depends on the number of peers.

### Transport abstraction

The whiteboard only calls `transport.send(op)` and `transport.onOp(cb)`. The variants differ only in their DataChannel options and in whether the V3 layer is used:

| Variant | DataChannel options | Extra layer |
|---|---|---|
| V1 | `{ordered:false, maxRetransmits:0}` | – |
| V2 | `{ordered:true}` (default) | – |
| V3-* | `{ordered:false, maxRetransmits:0}` | `reliable.ts` with option flags (see `03-…`) |

### Op model

One op is one line segment:

```ts
{ peerId, seq, strokeId, x0, y0, x1, y1, color, width, tSend }
```

- **`seq`** is assigned by the drawing peer, once per op, counting up per peer. **`(peerId, seq)`** is the unique op id. It is the **only** sequence number in the system.
  - Metrics join sends and receives by it.
  - V3 acknowledges ops by `seq` per link.
  - V3 packets have no packet-level sequence number of their own (see `03`).
- `strokeId` is also unique per peer.
- Segments are **idempotent and order-independent**: the final picture is correct no matter in which order, or how late, they arrive.
- Messages are encoded as JSON. Every variant uses the same encoding, so overhead comparisons stay relative and fair.

### Signaling server

- A minimal aiohttp app with WebSocket rooms. It also serves `web/dist`.
- On join, the server assigns or accepts a `peerId`, sends the joining peer the list of peers already in the room, and notifies the others.
- Offer, answer and ICE messages carry `{from, to}`, and the server forwards each one to its addressee.
- It is started **once per session** (not per run), in the root namespace on `10.10.0.1`.
- It is used in both automated and manual mode.
- No STUN or TURN is needed, because the peers reach each other directly on the emulated network.

### Two ways to use it: automated tests and live testing

The same web app serves both. URL parameters and the orchestrator flags decide which mode runs.

**Automated tests** (the measurements):

- `sudo uv run harness/orchestrator.py configs/experiment.yaml`
- Playwright opens two headless Chromes (A in `ns_a`, B in `ns_b`) with `auto=1`, triggers the scripted workload, and collects the logs (see `02` §4).
- Mouse input is disabled.

**Live testing** (manual drawing, demo, presentation):

| Where | How | Netem |
|---|---|---|
| Mac, during development | `npm run dev`, then open 2+ tabs on `localhost` | none |
| VM, with network emulation | `sudo uv run harness/orchestrator.py --manual [--peers N] [--profile loss10] [--variant v3-hybrid]` | yes, switchable live |

In the VM, `--manual`:

1. Sets up the namespaces and starts the signaling server.
2. Opens **N headed Chrome windows** (default 2) with no workload. Peer 1 runs in `ns_a`, and every other peer runs in `ns_b`.
   - All peers in `ns_b` share that namespace's netem settings, so every link from A experiences the same network conditions.
3. Applies the starting profile, then waits until you press Ctrl+C, and clears netem on exit.

Everyone draws with the mouse. More tabs can also join the same room by hand.

### Live controls (control bar in the page)

A small control bar, shown only when `auto=1` is not set:

| Control | What it does | How |
|---|---|---|
| **Network profile dropdown** | Switches the netem profile **without restarting** browsers or connections. The current profile is shown in every peer's HUD. | The page sends `{type:'set_profile', name}` over the signaling WebSocket. In `--manual` mode, the server runs `tc qdisc replace dev eth0 root netem <args>` in both namespaces (`ideal` applies netem with no arguments: no impairment, but the `tc -s` byte counters keep running, which the default veth qdisc does not), then broadcasts `profile_changed` to the room. `replace` changes the parameters in place, and the WebRTC connections stay up. |
| **Clear (local)** | Clears only my own canvas and resets my HUD counters. | Purely local. |
| **Clear all** | Clears every peer's canvas and resets their counters. | Sent as `{type:'clear'}` over the **signaling WebSocket**, not the DataChannel. If it went over the DataChannel, V1 could lose it and leave some peers uncleared. |
| **View mode** | Toggles true color / latency heatmap (also on a key, e.g. `H`). | Local. |

Notes:

- Profile switching only works in `--manual` mode. That is when the orchestrator runs the signaling server as root with access to `netem.py`. On the Mac (no netem), the dropdown is hidden.
- Control messages (profile, clear) use the signaling WebSocket. That keeps them out of the measured DataChannel traffic and independent of the variant. In the VM they still pass through the emulated link, so they arrive with the profile's delay, which is fine.
- **Variant:** set per page load via `?variant=` or `--variant`, because DataChannel options are fixed when the channel is created. Switching it live is a nice-to-have (`02` §8).

## 3. Test environment: Linux VM + network namespaces (decided)

**Core requirement:** netem must impair **only the WebRTC traffic between the two browsers**. It must not impair:

- Playwright control traffic
- the signaling setup
- the host

Both browsers run on **the same kernel**. They then share one clock, which lets us measure one-way latency exactly without any clock synchronization.

### 3.1 Topology and browser launch

```
root ns: br0 10.10.0.1  (signaling server + orchestrator run here)
  ├── veth-a  <->  ns_a: eth0 10.10.0.2   (Chrome A)
  └── veth-b  <->  ns_b: eth0 10.10.0.3   (Chrome B)
```

- `netns.py` creates the topology with about 10 `ip` commands.
- Each namespace has only `lo` + `eth0`, so ICE can only choose the emulated path.
- netem goes on each namespace's `eth0` egress, which allows the two directions to be set independently.

**Why a wrapper script is needed.** A process starts in the network namespace of the program that launched it. The orchestrator, and with it Playwright, runs in the root namespace, because it has to control both browsers and run `tc`. If Playwright started Chrome directly, Chrome's traffic would bypass netem. Playwright has no "launch in namespace X" option, so we hand it a wrapper as the Chrome executable (`executable_path=harness/chrome-ns.sh`). The wrapper enters the namespace and then becomes Chrome:

```sh
#!/bin/sh
exec ip netns exec "$NETNS" google-chrome --no-sandbox "$@"
```

- Playwright talks to Chrome over a **pipe** (`--remote-debugging-pipe`). Pipes are inherited through `ip netns exec`, so control traffic never touches the emulated network, and a single orchestrator process controls both browsers.
- The alternatives are worse:
  - Connecting to a debugging *port* inside the namespace would send the control traffic through the impaired interface.
  - A Playwright process per namespace would need its own coordination protocol.

**Why `--no-sandbox` and root.**

- `ip netns exec` requires root, so the orchestrator runs as root (`sudo uv run …`), and Chrome inherits root.
- Chrome refuses to run as root with its sandbox enabled.
- The sandbox only protects the system against malicious website code. Our VM only ever loads our own page, and the sandbox has no influence on networking or timing.
- Dropping back to a normal user (e.g. `sudo -u`) is **not** an option:
  - sudo closes the inherited file descriptors, which kills Playwright's control pipe.
  - Playwright would also create Chrome's temporary profile directory as root, and the unprivileged Chrome couldn't write to it.
- For headed windows (demo), allow root to use the display once with `xhost +SI:localuser:root`.

### 3.2 Considered alternative: Docker containers

We considered running one Docker container per browser. A container *is* a network namespace plus a filesystem, so Docker adds no isolation we don't already have. It does add problems:

- The orchestrator would have to control Chrome over the network. That needs a second, unimpaired "control" network.
- With two networks, Chrome can pick the unimpaired one for WebRTC, which silently invalidates the measurements.
- Headed demos need X11 forwarding or VNC.

Reproducibility comes from the step-by-step VM guide in `docs/vm-setup.md` instead. This paragraph is worth keeping in the report as a justification of the design.

### 3.3 VM, Chrome, Debian

- **Hardware:** the development Mac is an M4 Pro (arm64). The UTM VM runs **arm64 Debian 13** with Google Chrome's arm64 `.deb`.
  - Don't emulate amd64, because emulation distorts timing.
  - Give the VM ≥ 4 vCPUs, and keep the Mac idle during measurement campaigns.
- **Why Debian 13 rather than Fedora:**

  | | Debian 13 (trixie) | Fedora 44 |
  |---|---|---|
  | Playwright support | Official; `playwright install-deps` works | Not official; manual dependency setup |
  | netem | In the default kernel package | Separate `kernel-modules-extra` package |
  | Stability over the semester | 6.12 LTS kernel, fixed versions | Frequent kernel/package updates |
  | Friction | – | SELinux can interfere with netns/Chrome |

- **Pin Chrome:** run `apt-mark hold google-chrome-stable` (see `docs/vm-setup.md`), so Chrome doesn't auto-update mid-campaign. Record the Chrome, kernel and iproute2 versions in `meta.json`.
- Use a light desktop (XFCE, or KDE) for headed demos. Measurement campaigns run headless.

## 4. Network emulation (tc/netem)

- **When to apply netem:** after the DataChannel is open, followed by a **3 s warm-up** before the workload starts. The warm-up lets SCTP's and V3's RTT estimators adapt to the new conditions. Clear netem before teardown. Signaling and ICE setup are then never impaired, and no tc filter rules are needed.
- **Where to apply it:** on the egress of each namespace's `eth0`, which gives symmetric impairment by default. A per-direction setting is possible for asymmetric experiments.
- **Chrome flags** (besides `--no-sandbox`):

  | Flag | Purpose |
  |---|---|
  | `--disable-features=WebRtcHideLocalIpsWithMdns` | Without it, `.local` ICE candidates are used, and they don't resolve in the namespaces. |
  | `--disable-background-timer-throttling` | Keeps timers accurate in background windows. |
  | `--disable-renderer-backgrounding` | Prevents background renderers from being deprioritized. |
  | `--disable-backgrounding-occluded-windows` | Keeps covered windows running at full speed. |

### Profiles

Profiles are plain netem argument strings, so they can be copied into the report directly.

| Name | netem args (per direction) | Purpose |
|---|---|---|
| ideal | *(none)* | Baseline / sanity |
| delay | `delay 40ms 10ms distribution normal` | Jitter only |
| loss2 | `delay 30ms loss 2%` | Mild loss |
| loss10 | `delay 30ms loss 10%` | Heavy loss |
| burst | `delay 30ms loss gemodel 2% 30% 100% 0%` | Gilbert-Elliott burst loss: average about 6% loss, mean burst about 3 packets (breaks redundancy) |
| reorder | `delay 30ms reorder 25% 50%` | Reordering |
| bad | `delay 80ms 30ms distribution normal loss 5%` | Combined "difficult network" |

In addition, a **loss sweep** (loss ∈ {0, 1, 2, 5, 10, 15, 20}% at `delay 30ms`) is generated from the `sweep:` config key for line plots. It is not a profile itself.

Notes:

- netem `reorder` requires `delay`, and large jitter alone already reorders packets.
- **Expected result:** reordering barely affects V1 and V3, because ops are order-independent. Only V2 (ordered delivery) suffers. That is a finding to explain in the report, not a bug.
- Optionally add `rate 1mbit` to make overhead costs visible.
- **netem `seed` is supported** (verified 2026-11-05 on the VM's Debian 13 kernel and iproute2: `tc qdisc show` lists a `seed`, which netem picks at random when none is given). Each repetition gets a fixed netem seed (`netem_seed + repetition index`), appended to the profile's args as `seed <n>`. Repetition k then uses the same random sequence in every variant, so the runs are reproducible.
  - A shared seed does not mean identical drops across variants: the random sequence is consumed per packet, and the variants send different packet streams (e.g. V3 adds ACKs and retransmissions).

### Config sketch

```yaml
seed: 42                # workload seed, the same for every repetition
netem_seed: 1000        # netem seed of repetition k = netem_seed + k
duration_s: 30
warmup_s: 3
drain_s: 10
repetitions: 5
headless: true

variants:
  v1:        { channel: unreliable }
  v2:        { channel: reliable_ordered }
  v3-arq:    { channel: unreliable, ack: sack, redundancyK: 0 }
  v3-nack:   { channel: unreliable, ack: nack, redundancyK: 0 }
  v3-red:    { channel: unreliable, ack: none, redundancyK: 2 }
  v3-hybrid: { channel: unreliable, ack: sack, redundancyK: 1, liveFirst: true }
  v3-sem:    { channel: unreliable, ack: none, strokeRepair: true }

profiles:
  ideal:  ""
  loss10: "delay 30ms loss 10%"
  bad:    "delay 80ms 30ms distribution normal loss 5%"
  # ...

sweep:
  base: "delay 30ms"
  loss: [0, 1, 2, 5, 10, 15, 20]
  variants: [v1, v2, v3-hybrid]   # only the interesting ones (runtime)
```
