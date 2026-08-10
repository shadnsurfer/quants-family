# quants — autonomous build harness

This repo builds itself. You paste one kickoff message into Claude Code (running Fable 5 as the
orchestrator) and it loops through milestones — writing code, spawning subagents, checking its own
work, fixing failures — until it reaches the go-live readiness gate, the single point where a human
must decide to commit real money.

## How the autonomy works (3 mechanisms)

1. **The loop engine — a `Stop` hook.** When Claude tries to end its turn, `.claude/hooks/stop-loop.sh`
   runs `build/scripts/verify-milestone.mjs`. If the active milestone's checks don't pass, the hook
   returns `{"decision":"block", reason:...}` which *forces Claude to keep working*, injecting the next
   instruction + the failure output. When everything passes, it allows the stop. The consecutive-block
   cap is disabled in `settings.json` (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`) so long builds aren't
   cut off; a **12-attempt-per-milestone** escalation in the hook is the real infinite-loop guard.

2. **Continuous self-checking — a `PostToolUse` hook + the verifier.** After every file edit,
   `post-edit-check.sh` typechecks and hands back errors so Claude self-corrects at edit granularity.
   At milestone granularity, the verifier runs unit tests, seeded simulations, invariant assertions,
   and HTTP probes. Claude is structurally unable to "declare done" — only the verifier can.

3. **Resilience + safety — `SessionStart` and `PreToolUse` hooks.** `session-start.sh` re-primes Claude
   with current progress on every start/resume/compact, so the loop survives context resets.
   `safety-guard.sh` deterministically blocks destructive commands and — critically — blocks any flip
   to real-money live mode. Real capital is the one decision the loop will never make itself.

## The files

```
CLAUDE.md                     # always-loaded operating manual for the orchestrator
PROJECT.md                    # the full quants product spec (what's being built)
KICKOFF.md                    # the message you paste to start
build/MILESTONES.md           # M0..M8, each with verify: commands (the definition of done)
build/state/progress.json     # the loop's ledger (status per milestone)
build/scripts/verify-milestone.mjs   # the referee — decides done-ness
.claude/settings.json         # wires all hooks; raises the block cap
.claude/hooks/                # stop-loop, post-edit-check, safety-guard, session-start
.claude/skills/milestone-runner/     # the per-milestone discipline Claude follows
.claude/agents/               # builder / tester / verifier-scribe subagents
```

## Milestones (what you'll see, when)

| M | Name | You can watch/test |
|---|---|---|
| M0 | Repo & harness self-test | health at localhost:4321/health |
| M1 | Core domain (genome/fitness/guardrails) | unit-test table in build/logs |
| M2 | Paper engine + quant runtime | smoke log: kelly makes paper trades + a guarded tweet |
| M3 | Warden orchestrator (reproduce/reap/flows) | evolution sim: births, deaths, balanced ledger |
| M4 | **Dashboard** | **localhost:4321 — live leaderboard, family tree, counters** |
| M5 | Chain on dust | a real dust token on Pons, linked on the explorer *(needs DUST_OK)* |
| M6 | Twitter dry-run feeds | **localhost:4321/feeds — simulated timelines for all quants, agent zero included** |
| M7 | Integration dress rehearsal | one screen: dust birth + paper trading + feed, together |
| M8 | Readiness report | build/READINESS.md — **loop halts here for your go-live decision** |

## Running it

1. Install Claude Code, open this folder, ensure Fable 5 is the active model.
2. `pnpm install` (or let M0 do it).
3. Paste the contents of `KICKOFF.md` as your first message.
4. Watch `http://localhost:4321` from M4 on. Tail `build/logs/stop-loop.log` to see the loop think.

## The confirm files (you create these to unblock gated steps)

- `build/state/DUST_OK` — allow tiny real spend for a Pons dust launch (needs a funded key in `.env`).
- `build/state/X_LIVE_OK` — allow real X posting instead of the dry-run feed.
- `build/state/GO_LIVE_OK` — the only switch to real-money trading. Never create it until M8 says you're ready.

Until each exists, the loop builds everything else and marks that milestone `blocked-waiting-human` —
it never stalls the whole build waiting on you.

## Important

This harness will build and *paper-trade* the whole system autonomously, and will launch **dust** tokens
if you opt in. It will **not** trade real capital on its own — that gate is human-only by design.
Nothing here is financial or legal advice.

## Referee scripts (included, and proven to fail honestly)

All milestone verifiers are shipped as working referees in `build/scripts/`, each of which correctly
**fails before its target code exists** (verified) — so Claude cannot pass a milestone vacuously:

- `assert-guardrails.mjs` (M1) — proves risk guardrails are frozen constants, never mutable genome.
- `smoke-quant.mjs` (M2) — boots one quant in paper mode; requires ≥3 trades + ≥1 guarded tweet.
- `sim-evolution.mjs` + `assert-invariants.mjs` (M3/M7) — seeded evolution run; enforces treasury
  conservation, no-zombies, and family-tree consistency. These are load-bearing — never weaken them.
- `check-dashboard.mjs` (M4) — probes all localhost:4321 routes + the disclaimer.
- `twitter-dryrun.mjs` (M6) — runs the real content guard against clean + banned samples; writes the feed.
- `readiness-report.mjs` (M8) — writes READINESS.md and halts for your go-live decision.

They import the *real* shipped modules (from each package's `dist/`), so they test the actual build,
not a copy. Until a package is built, its referee fails with a clear "build X first" message — which is
exactly what drives the loop forward.
