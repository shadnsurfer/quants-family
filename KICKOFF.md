# KICKOFF — paste this as your first message in the Claude Code session

You are the orchestrator for the **quants** autonomous build. Read `CLAUDE.md`, then `PROJECT.md`
(full product spec), then `build/MILESTONES.md`. Then begin the loop at the active milestone in
`build/state/progress.json` (starts at `m0-harness`).

Operate autonomously per CLAUDE.md. Use the `milestone-runner` skill each turn. Dispatch subagents
(`.claude/agents/`) for parallelizable milestones. After each milestone, keep the human-visible
surfaces alive (dashboard at http://localhost:4321, feeds at /feeds). Do not ask me anything unless a
`*-OK` confirm file is the only blocker, or you reach M8 (readiness — the finish line).

Start now with M0: scaffold the pnpm monorepo exactly as PROJECT.md §3 specifies, make the harness
self-check pass (`bash build/scripts/selfcheck.sh`), stand up the health placeholder
(`node build/scripts/health-placeholder.mjs &`), then let the Stop hook advance you.

Build the whole thing. I'll be watching the dashboard.

---

## What I (Charles) will do out-of-band, and the confirm files that unblock gated milestones
Drop an empty file at the path to unblock:
- `build/state/DUST_OK`     → lets M5 spend tiny real funds to launch a dust token on Pons (needs a funded key in .env)
- `build/state/X_LIVE_OK`   → lets M6 post to real X accounts instead of the dry-run feed
- `build/state/GO_LIVE_OK`  → the ONLY switch to real-money live trading; never created until M8 readiness is satisfied

Until those exist, the loop builds everything else and marks the gated milestone `blocked-waiting-human`
without stalling. That's by design.
