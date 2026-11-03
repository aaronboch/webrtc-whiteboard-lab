# 00 – Overview

## Assignment (from `docs/WebRTC.pdf`)

Build a simulation environment for WebRTC with three parts:

1. A WebRTC shared whiteboard (Chrome).
2. A tc/netem-based environment that emulates delay, loss and reordering.
3. A measurement environment that quantifies a concrete run in terms of:
   - **Aktualität** (timeliness)
   - **Vollständigkeit** (completeness)
   - **Kommunikationsaufwand** (overhead)

Compare three DataChannel variants:

| Variant | Description |
|---|---|
| V1 | Unreliable/unordered (`maxRetransmits=0`) |
| V2 | Reliable/ordered |
| V3 | Unreliable/unordered plus a **reliability component we write ourselves** |

The work happens in two stages:

- **Stage 1: V1 vs V2.** Visualize and measure the difference. The whiteboard color-codes each segment by its delay, and the statistics give the numbers.
- **Stage 2: V3.** Build a hybrid that does better on average under bad network conditions, judged by live timeliness and eventual completeness.

Other conditions:

- LLMs are allowed for research, debugging and local optimization. We design the architecture and do the fine-tuning ourselves, and we document how the AI was used (see `docs/llm-usage.md`).
- The effort splits about 2/3 implementation and 1/3 write-up (10–15 pages plus a talk).
- There is a status report every 2 weeks.

## Constraints (confirmed with the professor)

- **The whiteboard supports N peers** (full mesh, everyone can draw), as in the notes. **Measurements use 2 peers**: A draws (sender), B receives. Two peers are enough to compare V1–V3, and they keep the metrics clean.
- **V3 must not use a reliable DataChannel**, not even as a side channel for repair. All reliability in V3 is our own code on top of `{ordered:false, maxRetransmits:0}`.
- **Several V3 options** (see `03-…`) are optional but welcome as a comparison.
- **The report and talk are in German.** The plan docs are in English.

## Guiding principles

- A clean solution that just works. No overengineering.
- The whiteboard stays minimal. The effort goes into network emulation, measurement and V3.
- All variants share one code path. They differ only in DataChannel options plus an optional reliability layer, which keeps the comparison fair.
- One config file drives a full experiment matrix (variants × profiles × repetitions). Every run is self-describing through its metadata.

## Plan files

| File | Content |
|---|---|
| `01-architecture.md` | Repo layout, components, test environment, netem setup, config |
| `02-measurement.md` | Workload, logging, run flow, metrics, statistics, visualization |
| `03-v3-reliability-options.md` | Options A–E for our own reliability layer |
| `04-milestones.md` | Step-by-step milestones, campaign runtime, verification |
| `05-improvements.md` | Changes relative to the original `notes.md` |

## Decisions

| Topic | Decision |
|---|---|
| Test environment | Debian 13 arm64 VM (UTM on the Mac) + plain network namespaces (`01` §3) |
| Browser | Google Chrome arm64, version held during the campaign, run as root with `--no-sandbox` inside the namespace (`01` §3.1) |
| Language | Plan docs in English; report and talk in German |

## Open

- Which V3 options from A–E to implement. All of them stay in the plan for now.
