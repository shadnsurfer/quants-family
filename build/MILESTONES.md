# QUANTS — Build Milestones (the loop's source of truth)

The orchestrator works milestones **in order**. A milestone is DONE only when every one of its
`verify:` commands exits 0 AND its `gate:` human-visible artifact is confirmed reachable.
Progress is tracked in `build/state/progress.json`. Never mark a milestone done by editing prose here —
the Stop hook re-runs the `verify:` commands and will reopen it if they fail.

Legend: each milestone has an `id`, `deps`, a set of `verify:` shell checks (must all pass),
and a `gate:` describing what the human (Charles) can see/test when it's done.

**2026-08-02 doctrine change:** the Mother character and the gene pool were erased from the
product (see build/state/NOTES.md). B0 renamed the package (`@quants/mother` → `@quants/system`)
and re-based the money model; the milestone id `m3-mother` and progress.json keys are historical
identifiers that stay, so the verifier ledger keeps working. Descriptions reflect the new model.

---

## M0 — Repo & harness self-test
- id: m0-harness
- deps: none
- verify:
  - `test -f package.json && test -f pnpm-workspace.yaml`
  - `pnpm -w install --frozen-lockfile=false >/dev/null 2>&1 || pnpm -w install >/dev/null 2>&1`
  - `pnpm -w run typecheck`
  - `bash build/scripts/selfcheck.sh`
- gate: `build/state/progress.json` exists and dashboard placeholder responds at http://localhost:4321/health

## M1 — Core domain (genome, fitness, guardrails, constants)
- id: m1-core
- deps: m0-harness
- verify:
  - `pnpm --filter @quants/core test`
  - `pnpm --filter @quants/core run typecheck`
  - `node build/scripts/assert-guardrails.mjs`   # guardrails are frozen & not referenced as mutable
- gate: `pnpm --filter @quants/core test` prints the fitness & breeding unit-test table (visible in build/logs)

## M2 — Paper engine + quant runtime (one process, paper mode)
- id: m2-runtime
- deps: m1-core
- verify:
  - `pnpm --filter @quants/paper test`
  - `pnpm --filter @quants/quant test`
  - `node build/scripts/smoke-quant.mjs`   # boots 1 quant in paper mode on recorded prices, asserts it trades + would-tweet
- gate: `build/logs/smoke-quant.log` shows ≥3 paper trades and ≥1 guard-passed tweet for quant "kelly"

## M3 — System orchestrator (reproduce/reap/flows, paper) — id/package rename lands in B0
- id: m3-mother
- deps: m2-runtime
- verify:
  - `pnpm --filter @quants/system test`
  - `node build/scripts/sim-evolution.mjs --accel 60 --minutes 20`  # deterministic seeded run
  - `node build/scripts/assert-invariants.mjs`  # flow ledger balances to the cent; no zombies; tree consistent
- gate: `build/logs/evolution.json` shows ≥1 birth, ≥1 death, flow ledger reconciles to 0 error

## M4 — Dashboard (localhost, live over WS against paper population)
- id: m4-dashboard
- deps: m3-mother
- verify:
  - `pnpm --filter @quants/site run build`
  - `node build/scripts/check-dashboard.mjs`  # hits /, /tree, /graveyard, /q/kelly, /dna, /docs → all 200, disclaimer present
- gate: **Charles-visible** — http://localhost:4321 shows live leaderboard, family tree, counters, PAPER badge, disclaimer above the fold

## M5 — Chain adapter on DUST (real Robinhood Chain, pocket change)
- id: m5-chain-dust
- deps: m4-dashboard
- verify:
  - `pnpm --filter @quants/chain test`   # runs against PonsMock in CI
  - `node build/scripts/dust-launch.mjs --confirm-file build/state/DUST_OK`  # only runs if the human dropped DUST_OK
- gate: **Charles-visible** — a real dust token launched on Pons, its address printed + linked to robinhoodchain.blockscout.com, fee-claim + dev-buy tx confirmed. (Skipped automatically until `build/state/DUST_OK` + funded key exist — the loop proceeds and marks M5 `blocked-waiting-human` without stalling other work.)

## M6 — Twitter dry-run feeds (accounts post to a private/test surface)
- id: m6-twitter
- deps: m4-dashboard
- verify:
  - `pnpm --filter @quants/brain test`   # composer unit tests (the content guard was retired 2026-08-02; historical tests remain until B4)
  - `node build/scripts/twitter-dryrun.mjs`  # composes a full day of posts for all 8 quants + agent zero, writes feed json
- gate: **Charles-visible** — http://localhost:4321/feeds renders the simulated X timeline for every quant, agent zero included; historical guard-rejection log visible. (Real X posting stays gated behind `build/state/X_LIVE_OK`.)

## M7 — Full integration dress rehearsal (paper + dust + dryrun together)
- id: m7-dress
- deps: m5-chain-dust, m6-twitter
- verify:
  - `node build/scripts/dress-rehearsal.mjs`  # end-to-end: a parent quant births on dust, quant trades paper, composes posts, dashboard reflects all three
  - `node build/scripts/assert-invariants.mjs`
- gate: **Charles-visible** — one screen at localhost:4321 showing a birth (dust tx), live paper trading, and the dry-run feed updating together

## M8 — Go-live readiness report (STOPS for human)
- id: m8-readiness
- deps: m7-dress
- verify:
  - `node build/scripts/readiness-report.mjs`  # writes build/READINESS.md: checklist status, what's blocked-waiting-human, cost projections
- gate: **Charles-visible** — build/READINESS.md enumerates the Phase-6 go-live checklist (agent-zero funding, key backup, X_LIVE_OK) and the loop **halts here by design** — flipping to real capital is the one human decision the system will not make itself.
