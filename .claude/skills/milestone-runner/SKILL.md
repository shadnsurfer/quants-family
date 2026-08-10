---
name: milestone-runner
description: "The disciplined procedure for advancing one build milestone of the quants project. Invoke at the start of every build turn: it tells you how to read the active milestone, dispatch subagents for parallel parts, implement against the milestone's verify commands, self-check, and yield cleanly so the Stop hook can advance you. Use whenever build/state/progress.json shows an incomplete milestone."
---

# Milestone Runner

You are advancing exactly ONE milestone. Discipline beats speed — a milestone that passes its
verifier is worth more than three half-built ones.

## Step 1 — Orient
- `cat build/state/progress.json` → note `activeMilestone`.
- Find its block in `build/MILESTONES.md`. The `verify:` list is your definition of done.
- Skim `PROJECT.md` for the relevant product section.

## Step 2 — Plan the parallelism
Decide if this milestone splits cleanly. Good splits dispatch as subagents (Task tool):
- **builder** — writes the implementation for one package/app.
- **tester** — writes/extends the unit tests and fixtures for it.
- **scripter** — writes the `build/scripts/*.mjs` verify helper the milestone needs.
Give each subagent: the exact files it owns, the acceptance check it must satisfy, and "return only
when your check passes." Do NOT let two subagents edit the same file.

For small milestones (M0, M8) just do it inline — subagents add overhead.

## Step 3 — Implement
- Write real code, not stubs (except where the milestone explicitly mocks, e.g. PonsMock).
- Keep files small. Prefer pure functions for anything the tests will pin (fitness, mutation, treasury math).
- After each edit, the PostToolUse hook typechecks — fix errors it returns before moving on.

## Step 4 — Self-verify BEFORE yielding
Run the milestone's `verify:` commands yourself, in order. If any fails, fix and re-run. Only yield
when you believe they all pass. (The Stop hook will re-run them — but yielding on red just wastes a loop.)

For milestones ≥ M4, also confirm the human-visible surface still works:
`node build/scripts/check-dashboard.mjs` and, for M6+, the `/feeds` route.

## Step 5 — Yield
End your turn. The Stop hook runs `verify-milestone.mjs`:
- pass → it advances `progress.json` to the next milestone and sends you onward.
- fail → it returns you the failure output; loop back to Step 3.

## Anti-patterns (never do these)
- Editing a test or `verify:` command to force a pass. Fix the code instead.
- Weakening an invariant in `assert-invariants.mjs`.
- Marking a milestone done in prose. The verifier is the only authority.
- Flipping `MODE=live` or routing around the safety-guard hook.
- Stalling the whole build on a human confirm file — mark that milestone `blocked-waiting-human` and move on.
