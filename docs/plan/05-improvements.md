# 05 – Improvement Suggestions (relative to `notes.md`)

Changes relative to the original notes. All of them are reviewed and incorporated into `00`–`04`.

1. **Use the shared host clock.** Keep everything on one machine (one kernel). One-way latency is then exact, with no clock sync needed.
2. **Use an in-page seeded workload instead of Playwright mouse movement.** It is deterministic, gives identical op streams across variants, and leaves Playwright only the orchestration.
3. **Network namespaces instead of Docker containers** (decided). Same isolation, fewer pitfalls (control path, ICE choosing the wrong interface). See `01-architecture.md` §3.
4. **Run natively on arm64.** Google Chrome ships arm64 Linux packages, so a native arm64 VM on the Mac works. Don't emulate amd64, because emulation distorts timing.
5. **Overhead from `getStats()` (app level) + `tc -s` (wire level); no tcpdump.** `tc -s` already reports the exact per-run wire bytes per namespace, including V2's internal SCTP retransmissions. No pcaps.
6. **Apply netem only after the channel is open.** Signaling is never impaired and no tc filter rules are needed. This answers the question in the notes about how to control netem in a simpler way.
7. **Log `bufferedAmount`.** SCTP congestion control also slows V1 under loss. This effect is easy to overlook and worth a paragraph in the report.
8. **Add a burst loss (Gilbert-Elliott) profile.** Redundancy (option C) breaks down there, which makes the evaluation honest.
9. **Use `R_D` as the headline metric** (the share of ops on time within deadline D). It combines Aktualität and Vollständigkeit for the live view. Pair it with `C_final` for eventual completeness and with the mean effective latency for "mittleres Verhalten".
10. **Use Debian 13 instead of Fedora.** It has official Playwright support, netem in the default kernel, and a stable kernel for the whole semester (`01-architecture.md` §3.5). Record the Chrome, kernel and iproute2 versions in `meta.json`.
11. **Keep `docs/llm-usage.md` from day one.** The professor requires documentation of how the AI was used. Log it as you go instead of reconstructing it at the end.
12. **One YAML config with the matrix,** as in the notes, plus metadata per run. No separate profile system.
13. **N peers in the app, 2 peers in measurements.** The whiteboard is a full mesh for any number of peers, as in the notes. The V1–V3 tests use one sender and one receiver, which keeps the metrics clean (`01` §2).
14. **Run as root with `--no-sandbox` in the VM.** A 2-line wrapper puts Chrome into its namespace (`01` §3.1).
15. **Warm-up after netem, excess-latency deadlines, censored mean latency.** These keep the metrics fair across profiles (`02` §4–5).
16. **Skip:**
    - a netem GUI (YAML strings are enough)
    - STUN/TURN
    - a binary wire format
    - tcpdump/pcaps
    - XOR-parity FEC (piggyback redundancy covers the idea)
    - more than 2 peers *in the measurements* (the app supports N)
    - Jupyter as a dependency (`analyze.py`/`plots.py` are enough; a notebook is optional for exploration only)
