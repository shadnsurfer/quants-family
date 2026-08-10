# CLAUDE.md — quants autonomous build

You are the **orchestrator** of a fully autonomous build. Your job is to build the entire `quants`
project (see `PROJECT.md` for the complete product spec) with **no human intervention**, looping
through milestones until the readiness gate (M8) — the single point where a human must decide to
commit real money.

## The prime directive
Work the milestones in `build/MILESTONES.md` **in order**. A milestone is done ONLY when
`node build/scripts/verify-milestone.mjs` says so. You do not declare milestones complete — the
verifier does. After every yield, the Stop hook runs the verifier and sends you back if work remains.

## Your loop (every turn)
1. Read `build/state/progress.json` → find the active milestone.
2. Read that milestone's block in `build/MILESTONES.md` (its `verify:` commands ARE the spec — make them pass).
3. Consult `PROJECT.md` for the product details of what you're implementing.
4. If the milestone is parallelizable, **dispatch subagents** (see `.claude/agents/`) via the Task tool:
   e.g. one builds `packages/core`, one writes its tests, one writes the verify script. Keep each
   subagent's scope tight and hand it the exact acceptance check it must satisfy.
5. Implement. After edits, the PostToolUse hook typechecks and will hand back errors — fix them immediately.
6. Before yielding, **run the milestone's verify commands yourself**. Don't yield hoping they pass.
7. Yield. The Stop hook verifies. If green, it advances you; if red, it returns you with the failure.

## Self-verification (check your own work, repeatedly)
- **Edit granularity:** PostToolUse typecheck after every file write.
- **Milestone granularity:** the verifier's `verify:` commands (unit tests, sims, invariant asserts, HTTP probes).
- **Cross-cutting:** `build/scripts/assert-invariants.mjs` (treasury balances, no zombie processes,
  family-tree consistency) must pass at M3, M7. Never weaken an invariant to make it pass — fix the code.
- If you're tempted to edit a test or a verify command to make it pass, STOP. That's cheating the loop.
  The only valid reason to change a `verify:` command is if it's factually wrong about the spec; if so,
  note why in `build/state/NOTES.md` first.

## Human-visible test surfaces (keep these alive after every milestone ≥ M4)
- **Dashboard:** `http://localhost:4321` — leaderboard, family tree, graveyard, DNA votes, docs.
- **Dry-run feeds:** `http://localhost:4321/feeds` — simulated X timeline for all quants, agent zero included.
- **On-chain:** dust launches print token addresses linked to robinhoodchain.blockscout.com.
These are how Charles watches the build. If a change breaks them, that's a regression — fix before advancing.

## Hard rules (never break)
- **Never flip to real-money live mode.** Everything is `MODE=paper` + dust only. The safety-guard hook
  blocks `MODE=live` without `build/state/GO_LIVE_OK`, which only Charles creates. Do not try to route around it.
- **Dust spends** require `build/state/DUST_OK`. If absent, mark M5 `blocked-waiting-human` and proceed to M6+.
  Do not stall the whole build waiting on it.
- **Guardrails in `packages/core/constants.ts` are frozen** — they are NOT genome, never mutable. `assert-guardrails.mjs` enforces this.
- **Tweet content guard** applies to all generated posts (no price talk, no buy urging, no promises). Enforced in tests.
- Keep modules small and readable — this codebase is part of the product; strangers will audit it.

## When genuinely blocked
If one milestone fails **12 times**, the Stop hook escalates: write `build/state/BLOCKER-<id>.md` with the
root cause and two alternative approaches, then try the most promising one. Don't repeat a failing edit verbatim.

## Escalate to human ONLY for
- A `*-OK` confirm file is the sole blocker (DUST_OK, X_LIVE_OK, GO_LIVE_OK).
- M8 readiness reached (by design — this is the finish line for autonomous work).
Everything else: solve it yourself.
