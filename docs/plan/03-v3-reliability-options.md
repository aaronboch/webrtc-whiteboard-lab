# 03 – V3: Options for Our Own Reliability Layer

All options **A–E stay candidates**. Implementing one is required; implementing several as a comparison is optional but welcome. Every implemented option is compared against the others and against V1 and V2.

**Hard rule:** V3 uses only `{ordered:false, maxRetransmits:0}` DataChannels. No reliable DataChannel may be used, not even as a side channel for repair. All reliability is our own code.

## Common framework

- **Sequence numbers:** the op's `seq` (assigned per drawing peer, see `01` §2) is the only sequence number. Acknowledgements, NACKs and repair requests all refer to op `seq`s.
- **Per link:** V3 runs independently on every link (pair of peers), and "sender" and "receiver" below refer to the two ends of one link.
  - In a mesh, a drawing peer keeps one history buffer of its own ops but tracks acknowledgements separately per remote peer.
  - An op leaves the buffer only once every remote has acked it.
  - Measurements use one link (A→B).
- **Packet format** (JSON). A packet has no sequence number of its own:

  ```ts
  { type: 'DATA', ops: [op, ...] }                          // live op + redundant copies (option C)
  { type: 'ACK',  cumAck, sack: [[from, to], ...], echoTs }  // option A
  { type: 'NACK', missing: [[from, to], ...] }              // option B
  { type: 'HEARTBEAT', highestSeq }                         // option B
  { type: 'STROKE_END' | 'STROKE_STATUS' | 'REPAIR', ... }  // option D
  ```

- **Rendering:** the receiver **renders every op immediately when it arrives**, with no head-of-line blocking, and drops duplicates by `seq`. Since segments are idempotent and order-independent, ordering never matters for the final picture.
- **Mechanisms as config flags:** `reliable.ts` implements each mechanism once, and a variant is just a set of flags in the `variants:` map of `configs/experiment.yaml` (see `01` §4):

  ```ts
  { ack: 'none' | 'sack' | 'nack', redundancyK: 0..3, strokeRepair: bool, liveFirst: bool, adaptiveK: bool }
  ```

- **Shared building blocks:**
  - Sender history buffer: `seq → op`, with `tFirstSent` and `retries`.
  - Receiver received-set: highest seq, plus a list of received ranges.
  - RTT estimator: srtt/rttvar (Jacobson/Karels), fed by echoed timestamps in the feedback messages.
  - Tick timer: `setInterval` at about 10 ms, drives retransmission checks and feedback sending.

## Option A: Selective-repeat ARQ with SACK (sender-driven)

**Mechanism:**

- The receiver sends `ACK` every 30–50 ms, and right away when it detects a gap:

  ```
  { cumAck, sack: [[from, to], ...], echoTs }
  ```

  The SACK is a list of received ranges above `cumAck`. A fixed-size bitmap (e.g. 64 ops ≈ 1 s at 60 ops/s) would be too small for long bursts. Ranges are simpler in JSON and have no window limit.
- The sender keeps unacked ops in its buffer and retransmits:
  - **Fast retransmit:** when 3 or more later seqs are acked and the op is still missing.
  - **Timeout:** after `RTO = srtt + 4·rttvar` (floor of 50 ms), with exponential backoff on repeated loss.
- Buffer entries are freed once they are acked.

| Pros | Cons |
|---|---|
| Textbook design, exact completeness, tail loss handled naturally (RTO) | Constant feedback traffic, even without loss |
| Easy to explain and to relate to TCP/SCTP | Repair always costs ≥ 1 RTT |

**Expected:** `C_final` ≈ 1. p50 ≈ V1. p99 improves on V2 because there is no head-of-line blocking. Moderate overhead.

## Option B: NACK-based, receiver-driven (as in RTP / RFC 4585)

**Mechanism:**

- The receiver detects gaps in `seq` and waits a short reorder tolerance (about 1× the jitter estimate, or a fixed 20 ms). It then sends `NACK` with the missing ranges, and repeats the NACK if the op is still missing after about 1 RTT.
- The sender retransmits from a **bounded** history buffer, limited by a time window.
- **Tail loss:** while idle, the sender sends `HEARTBEAT {highestSeq}` every 100 ms. This lets the receiver detect lost final ops.
- **Completeness guarantee:** only within the history window. Ops older than the window can no longer be repaired. Size the window larger than run duration + drain (e.g. 60 s) for the measurements, so completeness is effectively guaranteed. State the limitation in the report.

| Pros | Cons |
|---|---|
| Almost zero overhead at low loss, since feedback is only sent on loss | Tail loss needs heartbeats |
| Repair starts as soon as a gap is noticed | Without ACKs the sender never knows when it is safe to free buffer space, so the buffer must be bounded |
| Same approach as RTP video retransmission, which is good material for the report | NACKs themselves can be lost, so they need repetition |

**Expected:** similar to A in timeliness, lower overhead at low loss, slightly worse tail-loss handling.

## Option C: Proactive redundancy (piggyback last K ops)

**Mechanism:**

- Each `DATA` packet carries the new op **plus the last K ops**, the same idea as RFC 2198 / Opus RED. The receiver deduplicates.
- There is no feedback channel at all.

| Pros | Cons |
|---|---|
| Zero-RTT recovery: the biggest timeliness win under random loss | Bandwidth roughly × (K+1) |
| No feedback traffic, so it is simple | Fails when bursts are longer than K (see the `burst` profile) |
| | **No completeness guarantee on its own.** Use it standalone only as a reference, otherwise combine it with A, B or D. |

**Expected:** a big `R_50`/`R_150` gain at 2–10% random loss, weak under burst loss, `C_final` < 1.

## Option D: Application-aware stroke reconciliation (semantic repair)

**Mechanism:**

- Live segments are sent once, best-effort, and are **never retransmitted individually**. The reasoning: a segment that arrives late adds little to the *live* view.
- When a stroke ends, the sender sends `STROKE_END {strokeId, firstSeq, lastSeq}`. It retries this every RTO until the receiver answers.
- The receiver answers `STROKE_STATUS {strokeId, missing: [[from, to], ...] | complete}`.
- The sender then resends the missing segments as `REPAIR` (D1).
- *Only if time:* D2, which resends the whole stroke as one compact simplified polyline (Ramer-Douglas-Peucker) instead.

| Pros | Cons |
|---|---|
| Truly *anwendungsbezogen*, which is the assignment's own wording | Repair latency ≥ stroke length, so long strokes stay incomplete for longer |
| Lowest overhead: feedback only once per stroke | `STROKE_END`/`STROKE_STATUS` need their own small retry logic |
| Clean story: the live path optimizes Aktualität, the repair path optimizes Vollständigkeit | |

**Expected:** the lowest overhead and live behavior equal to V1, but slower completeness than A or B. The most interesting option for discussion in the presentation.

## Option E: Deadline-aware hybrid (A or B + C, live-first)

**Mechanism:**

- Redundancy K = 1–2 covers most random losses immediately.
- SACK (A) or NACK (B) repairs whatever redundancy missed.
- **Live-first (`liveFirst`):** `dc.send()` sends immediately, so there is no queue to prioritize in. "Live first" therefore means that retransmissions are **throttled** and live ops never are:
  - Retransmissions pass through a token bucket limited to ≤ 20% of the current live send rate.
  - Retransmissions are only sent while `dc.bufferedAmount` is below a small threshold (e.g. 16 KB), so they never queue up in front of live ops inside SCTP.
  - Retransmissions that are not allowed yet wait in our own repair queue (oldest first).
- *Only if time:* `adaptiveK`, which adjusts K from the loss rate measured through feedback. For example, K = 0 below 1% loss, K = 1 below 5%, otherwise K = 2.

| Pros | Cons |
|---|---|
| Combines the strengths of A/B and C: best expected "mean behavior" | The most code: it builds on A/B and C |
| Repair never hurts the live view | More parameters to tune and justify |

**Expected:** the best `R_150` and mean effective latency under `loss10`/`bad`, and `C_final` ≈ 1, at the cost of more overhead than D.

## Comparison overview

| | A SACK-ARQ | B NACK | C Redundancy | D Semantic | E Hybrid |
|---|---|---|---|---|---|
| Live timeliness under loss | + | + | ++ | + (≈V1) | ++ |
| Final completeness | ++ | ++ (within window) | – | ++ (slower) | ++ |
| Overhead | medium (constant ACKs) | low | high (×K+1) | lowest | medium–high |
| Burst loss | ok | ok | weak | ok | ok |
| Complexity | medium | medium | low | medium | high (but reuses A/B + C) |
| Report value | baseline, TCP analogy | RTP analogy | FEC analogy | application-specific design | "best mean behavior" |

## Suggested implementation order (if implementing several)

Each step reuses the previous one:

1. **Shared framework:** packet format, history buffer, received-set, RTT estimator, tick timer.
2. **A (SACK-ARQ):** the first complete V3. Validates the framework.
3. **C (redundancy K):** a few lines, and combines with anything.
4. **E = A + C + live-first.**
5. **B (NACK):** swaps the feedback module of A.
6. **D (semantic):** a separate repair path that only reuses the framework.

The evaluation chapter then becomes an ablation study: same workload, same profiles, one mechanism changed at a time.
