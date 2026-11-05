# LLM Usage Log

The assignment requires documenting how AI was used. Add an entry per session or task.

| Date | Tool / Model | Purpose | What was produced | What we changed / validated ourselves |
|---|---|---|---|---|
| 2026-11-03 | Claude Code (Claude Opus 5.5) | Planning | Refined project plan in `docs/plan/` from `notes.md` and the assignment PDF, including V3 reliability options A–E and an environment comparison (netns vs Docker) | Review pending |
| 2026-11-05 | Claude Code (Claude Opus 5.5) | Planning | Removed `setup_vm.sh` from the plan; `docs/vm-setup.md` is now the reproducibility record (decision ours) | Reviewed the diff |
| 2026-11-05 | Claude Code (Claude Opus 5.5) | Repo skeleton (step 0.3) | Folder skeleton, `.gitignore`, setup commands, verification of build/dev server/imports | Ran the Vite and uv setup ourselves |
| 2026-11-05 | Claude Code (Claude Opus 5.5) | Step 0.4 (`harness/netns.py`) | Implementation of `up`/`down`/`status` | Chose the per-step idempotency design and the status output; tested all commands as root in the VM |
| 2026-11-05 | Claude Code (Claude Opus 5.5) | Step 0.5 (`harness/netem.py`) | Implementation of `apply`/`clear`/`stats`; found that noqueue has no counters (ideal = netem without args) and that netem `seed` is supported | Approved the ideal and seed decisions; tested all commands as root in the VM (delay, 10% loss, counters) |
