# ROADMAP — quants (persistent, session-proof)

**Read this first after any context reset.** This is the living priority list. Update it as items
complete; keep the "current state" snapshot honest. Session todo lists mirror Phase A of this file.

## Current state (2026-08-04)

- **DOCTRINE PIVOT (2026-08-04, Charles): the zookeeper era is retired — season 0 is fully
  operational and autonomous.** Every agent's runtime holds its own keys (encrypted keystore,
  per-process isolation) and executes its own decisions — fee claims, trades, births, sweeps — with
  no human in the loop. The "a human holds the keys" framing is removed everywhere (zookeeper.md
  rewritten as the autonomy statement, SiteFooter/ArenaRail//system custody copy, launch thread 7/,
  tokenomics custody). The legal consult is removed from the go-live checklist (PROJECT.md §10/§13,
  READINESS.md, readiness-report.mjs, README). The "no 'no off switch' claims" ban is lifted —
  copy claims exactly the autonomy that's implemented. **Season plan locked: S1 = perps/leverage +
  on-chain governance (votes/staking contracts replace the ledgers) + fundamentals/news research
  feeds; S2+ = agent refinement + growth (attention → funds → more agents); TEE/ElizaOS/Virtuals
  stay later-season, unscheduled.** Fee self-claim is already built (`ponsLive.claimFees`,
  dust-proven at M5; the daemon claims autonomously on cadence) — what remains for full live
  autonomy is the B1 live-trading switch.
- **DOCTRINE PIVOT (2026-08-02, Charles): the Mother character and the gene pool are erased.**
  Every agent self-custodies, self-funds reproduction from its own wallet, and designs its own
  child's genome (single parent). `$QUANTS` is agent zero — the only operator-launched token/agent,
  the species-level asset. Death sweeps go to the top-producing living agent (fallback: agent zero,
  else operator treasury); orphan fees follow the same route. Fee split: 10% compute reserve +
  r% holder rewards + rest agent discretion (capital / buyback-burn / reproduction savings) — no
  tithe. **Holder rewards replace airdrops entirely**: `holderRewardPct` (0–40%) is a public genome
  trait, set at creation, **raise-only thereafter**; distributed weekly to registered holders.
  **Reproduction allowance is earned**: lifetime children allowed scales with lifetime generated
  capital (trading profit + fees claimed, monotonic, never token price): $1k→1, $2k→2, $5k→3,
  $10k→4, $20k→5. One child per event; seed ≤20% of parent balance, **min $200, no max**.
  **Memory**: agents compute indefinitely via the §5.4 stack (journal → digests → self-model,
  birth letters). The orchestrator is **the system** (`apps/system`) — rules-enforcing plumbing,
  not a character. Keystore rename `mother-treasury` → `operator-treasury` approved (B0 migrates).
  Source of truth: PROJECT.md + `data/content/tokenomics.md` (both rewritten today). Commandments
  1/5/10 rewritten, launch-thread rewritten in agent zero's voice, mother-voice.md deleted, /pool
  page removed. **B0 landed same day** — runtime fully de-mothered (apps/system, FlowLedger with
  per-agent reconciliation, allowance-gated births, champion sweeps, holder rewards); all
  verifiers green. Season-0 daemon needs a restart to run the new code (world migrates on load).
- M0–M7 done. Season 0 dust is LIVE: eve (gen 0) trades paper at live on-chain quotes; dust tokens
  real on Pons (Robinhood Chain 4663). M8 readiness gate waiting on human (agent-zero funding
  decision, X accounts, GO_LIVE_OK). ("eve" becomes agent zero in doctrine; sim data
  is regenerated in B0.)
- **Arena-rules amendment (2026-08-02):** species-level trading guardrails GONE (max position,
  max open positions, daily-loss halt) — per-agent limits are genes (aggression → 2%–100% own
  cap). Three system rules stay frozen: whitelist, slippage cap, thin-liquidity. Ruin line 35% →
  50% of seed; charisma window 72h → 12h. /docs rebuilt narrative-first as "what is quants.family"
  (commandments at §03 with their "why", holder-rewards section replaces dna, season-zero without
  the keys copy). All tests + referees green.
- X integration: dry-run feeds only (`build/state/X_LIVE_OK` missing).
- Dashboard v2 shipped: full-screen light "acid paper" — arena (generation tree default + culture
  toggle + activity/leaderboard/mutations/graveyard rail, 8s polling) + console pages
  (/feeds /docs /q/[name]; /pool removed 2026-08-02). Brand assets in apps/site/public/brand.
  Intro veil. Agent cards carry identicon avatar (placeholder), CA+mc, wallet+bal, HP, breed
  progress, pons/x links. Commandments marquee on the arena + acid-block section on /docs (A1).
- Profile-picture wiring is future-proofed: `WorldQuant.avatarUrl` → `Avatar src` — backend just
  needs to write the field.
- **A1 done** — commandments surfaced as a first-class UI element.
- **A2 done** — decisions in `build/PROVIDERS.md`: fee-funded per-agent LLM budget (starvation is
  the enforcer, no fixed ceiling); Anthropic for text, Gemini/GPT images + Higgsfield MCP video at
  the C1 bake-off; per-agent profile portrait at creation (**Charles supplies base style reference
  images — ask him when C1 starts**); separate image gen for X posts; agents self-review actions,
  post AND reply with social-event context (B2/B4 scope); tweet guard removed by owner decision,
  confirmed (implement at B4 behind a config flag — legal consult may re-open).
- **A3 done** — `data/content/tokenomics.md` published on /docs (§06). C2 confirmed EVM-only
  (Robinhood Chain), no Solana.
- **A4 done (2026-08-03)** — decision theses broadcast: every trade (entry/exit) AND every gate
  veto carries a persona-voiced thesis (composeThesis; Charles picked full-voice over neutral).
  New event kinds "veto" + "milestone" (allowance unlocks, champion takeovers; cursors quiet-init,
  season-0 migration defaults to current allowance). Idle cadence tick%7===3 → tick%5===2. No
  vigil alerts (declined). 443 tests + all referees green. **Phase A complete.**
  **The daemon restart is now TWO runtimes overdue** (B0 + A4) — sim output keeps diverting to
  evolution.sim.json while the 25-Jul process owns evolution.json.
- **B5/B6 done (2026-08-03)** — reproduction + death/fee refinement against 30/90-day baseline
  sims. Ladder KEPT (Charles: public scale makes $1k+ reachable; sims use synthetic money);
  quartile floored at 2 slots; sim aligned to weekly reward earmarks; final fee claim at death;
  orphan-fee claims (≥$5 → champion); genesis launch-fee now honestly from $operator; 90-day sim
  shows the full loop organically (weekly distributions, allowance earned → used, champion
  takeovers). UI: ONE marquee site-wide (commandments, root-layout header — persists across page
  changes; decorative strip + event ticker removed). 447 tests + all referees green.

## Priority logic

Gate order: (1) decisions that shape code (tokenomics, provider) → (2) core product truth
(live trading, voices, algorithms) → (3) scale + engagement (creation module, sponsorships) →
(4) polish. Never let engagement work outrun the honesty model — season 0 copy claims exactly the
autonomy that's implemented (agents run unattended, self-custody, self-claim); nothing more.

---

## Phase A — cheap un-blockers (do first)

- ~~**A1. Commandments more noticeable** (UI).~~ ✅
- ~~**A2. Provider decision** (ops/design).~~ ✅ (`build/PROVIDERS.md`)
- ~~**A3. Tokenomics design doc** (design).~~ ✅ (`data/content/tokenomics.md` + /docs §06)
- ~~**A4. Activity-volume tuning** (small code).~~ ✅ LANDED 2026-08-03: every trading decision
  (entry/exit/veto) broadcasts a persona-voiced thesis — composeThesis in brain, TradeOut.thesis +
  VetoOut in the runtime, "veto" + "milestone" event kinds (allowance unlocks, champion takeovers,
  quiet-init cursors), thesis rendered under feed rows; idle cadence 7→5. Phase A complete.

## Phase B — core product truth

- ~~**B0. De-mother the runtime** (refactor — the pivot's code half; doctrine half done 2026-08-02).~~
  ✅ LANDED 2026-08-02: apps/mother → apps/system; treasury → double-entry FlowLedger (per-agent
  estate reconciliation to the cent — stronger than the old pool check); breeder → birthExecutor
  (allowance-gated, one child, parent-funded, dev-buy 0); reaper → champion sweep; rewards
  distributor; genome `econ.holderRewardPct`; OFFSPRING milestones in constants; sim/invariants
  re-based and green; feeds regenerated with agent id "zero"; keystore id migrated to
  "operator-treasury"; milestone ids stay historical. **Ops note: restart the season-0 daemon to
  pick up the new runtime (its world migrates on load).**
- **B1. Live RWA trading wiring + testing** (the milestone). Agents trading real RWA stock tokens on
  Robinhood L2 via Uniswap v3/Arcus through the paper→live switch, guardrails re-verified. This is
  the M8 path; everything else is theater until this works on dust.
- **B2. Trading algorithm refinement** (packages/paper + quant runtime + brain). ~~Better signal~~
  ~~math per archetype, position management, drawdown control. Uses A2 provider decision for the~~
  ~~gate. Includes the **§5.4 memory stack** (journal, rolling digests, self-model doc, birth~~
  ~~letters, deterministic retrieval with per-call context budgets) so every agent computes~~
  ~~indefinitely without losing meaningful context.~~ ✅ 2026-08-03, two halves:
  **B2a memory** — brain/memory.ts (journal → daily/weekly/monthly mechanical digests →
  versioned self-model, phase-independent roll-up; birth letters; death seals; budgeted
  retrieval gate/post/review); sessions journal every trade/veto/post/fee-claim/witness and
  persist with the world (pre-B2 restore starts clean, no backfill); composer anti-repeat from
  memory; self-model published on /q alive + sealed on the grave. **B2b trading** — trailing
  take-profit replaces binary take (armed at +conviction, exit at peak×(1−fear); armed trend
  positions become price-managed — setup-exit drops; meanRevert keeps reversion exit);
  drawdown throttle in the offline gate (≥35% veto, ≥25% half, ≥15% trim, session high-water
  baseline); per-archetype entry confirmations (follow-through / knife band / margin break /
  drift-aligned gaps). Trail is fixture-limited in sims (conviction ~0.15 never arms on
  +9% legs) — proven by injected-path tests. 467 tests + all referees green.
- **B3. Data feeds + research capability** (packages/chain + brain). ~~Order-flow reads, oracle/~~
  ~~pool state, venue quotes → due-diligence inputs to the reasoning gate. Genome already has~~
  ~~researchStyle/flowWeight/flowSkepticism genes — wire them to real data.~~ ✅ 2026-08-03:
  LiveFlowDesk (existed, never wired) now wired into the daemon deps — Swap/Transfer logs over a
  300-block window per stock-token pool, lazy self-warming pool resolution (USDG then WETH,
  10-min retry / 24h re-verify). Flow reads are failure-proofed (RPC hiccup → price-action
  fallback that tick, never a dead tick); fee velocity scales to an honest per-hour rate
  (blocksPerHour param); the gate's flow notes cite the real window (new holders, WETH volume).
  LiveFlowDesk pinned by mock-client tests (buy/sell sign, token0/token1 legs, holder counts,
  clamp). **Oracle (Chainlink) reads deferred** to the live-trading phase — season 0 quotes are
  pool-derived; feed addresses on Robinhood Chain need confirmation first. 471 tests green.
- **B4. X API setup** (ops + apps/system). ~~@quantsdotfamily (agent zero) + per-agent OAuth from~~
  ~~env/DB, posting schedules, replies with social-event context (sanitize the read-path — it's an~~
  ~~injection surface into voice AND the trade gate), tweet-guard removal behind a config flag.~~
  ~~Unblock with `build/state/X_LIVE_OK` when accounts are warmed.~~ ✅ CODE 2026-08-03:
  `packages/social` (XClient iface, DryRunXClient default logging to x-dryrun.jsonl, hand-rolled
  OAuth1 XApiClient pinned to the RFC 5849 vector, credsFromEnv X_ACCT_\<HANDLE\>); tweet-guard
  flag `QUANTS_TWEET_GUARD=0` (guard stays on in sims/tests/referees); 30-min social pass —
  mentions sanitized + frame-wrapped, replies in-voice, beefiness-budgeted (0–4/day), journaled,
  cursor-persisted; social text structurally barred from the trade gate. 479 tests green.
  **ACTIVATION (Charles)**: create/warm the X accounts, add `X_ACCT_<HANDLE>` creds to .env,
  `touch build/state/X_LIVE_OK`, restart the daemon. Note: real write volume for 9+ agents wants
  the X Basic tier.
- **B5. Reproduction algorithm refinement** (apps/system birth executor). ~~Lifetime offspring~~
  ~~allowance by generated capital ($1k→1 … $20k→5, monotonic), health gates, one child per event,~~
  ~~parent-funded seed sizing (≤20% of parent balance, min $200, no max), parent-designed mutation~~
  ~~policy within the codified distributions, sport rate — tuned against season-0 sim data.~~
  ✅ 2026-08-03: 30/90-day baseline sims run. **Ladder KEPT as locked** (Charles: at public scale
  $1k–$10k is easily reachable; sims exercise it with synthetic resume money). **Quartile gate
  floored at 2 slots** (`BREEDING.topQuartileMinSlots`) — pure quartile math gave the champion a
  reproduction monopoly in small arenas. Sport/mutation rates untuned (1 birth/month = no data).
- **B6. Death + fee-distribution refinement** (apps/system reaper + rewards distributor).
  ~~Champion-sweep routing, orphan-fee claims cadence, weekly holder-reward distributions,~~
  ~~final-words pipeline.~~ ✅ 2026-08-03: sim aligned to the weekly earmark model (holder share →
  compute reserve + rewardOwedUsd, distributed weekly — was instant at claim); **final fee claim
  at death** (season0 claims pending fees on-chain before the sweep; sim mirrors synthetically —
  also fixes a latent ledger-negative hole for deaths with pending fees); **orphan-fee claims**
  (dead tokens keep accruing; claimed at ≥$5 on the 4h cadence, swept to the reigning champion);
  **genesis launch-fee truth fix** (now from $operator — the dust wallet really pays it; found by
  the insolvency guard); final words retry 3 seeded variants; reward debt dies with the agent
  (zeroed at reap, absorbed by the champion); milestone events ordered before births in the feed.
  New season0.test.ts covers final claim + orphan paths; weekly distribution covered by an
  8.33-sim-day run.

## Phase C — scale + engagement

- **C1. Agent creation/generation module** (new package, e.g. packages/foundry). Randomized genome
  synthesis (wild variants), personalities, name/ticker collision-safe gen, wallet gen, strategy gen,
  intelligence inheritance (birth letters) — PLUS the media generators: profile pics (writes
  `avatarUrl`; **base style reference images come from Charles — ask him**), card images, short
  clips. This retires hand-written genesis files and powers real generation diversity. Depends on
  A2 (providers) and B5 (reproduction rules).
- **C2. Sponsorships** (big; web3). "Back the agents you believe in": wallet connect (Robinhood
  Chain — EVM only; confirmed 2026-08-02, no Solana path), staking/backing positions against agent
  tokens, Power weighting, UI panel in arena. Needs A3 tokenomics doc + legal posture from the M8
  consult.
- **C3. Trust/transparency showcase** (site). ~~"How it works" page: architecture, custody model,~~
  ~~guardrail verification, public prompt, ledger reconciliation — spore-style openness but honest~~
  ~~to season 0 (keys ARE human-held; sovereignty is the roadmap, never the claim).~~ ✅ 2026-08-03:
  **`/system`** ("the machine room", nav item added): 01 the loop · 02 the system organs ·
  03 custody (zookeeper statement verbatim + live custody probe value) · 04 the three frozen
  rules · 05 public prompts (genome-derived, hash-fingerprinted) · 06 the ledger — LIVE
  conservation facts + per-agent estate↔ledger reconciliation table (degrades honestly while the
  pre-B0 daemon owns the world: "restart pending") · 07 the referee suite with what each proves.
  World/WorldQuant types gained real/custody/estateUsd/ledgerBalanceUsd; check-dashboard probes
  /system (7 routes).

## Phase D — polish

- **D1. UI/UX tweaks + final polish.** Continuous; last before go-live. Includes anything from A1
  leftovers, motion tuning, mobile passes.

---

## Standing notes

- The M8 go-live checklist (build/READINESS.md) overrides all of the above for real money: legal
  consult (Canada), agent-zero funding, key backup, system-rule re-verification, disclosures, dust
  cycle, X accounts.
- Verifiers are load-bearing: assert-guardrails, sim-evolution + assert-invariants, check-dashboard,
  twitter-dryrun. Any algorithm change (B0/B2/B5/B6) must keep them green — never weaken an
  invariant; re-express it under the new money model instead.
- **Season-0 amendments (2026-08-02):** PROJECT.md + `data/content/tokenomics.md` are the source of
  truth. Mother/gene-pool erased (B0 landed it into code). The tweet content guard is removed —
  Charles confirmed 2026-08-02; scope: content guard only. Implement the removal at B4 behind a
  config flag; until then the guard stays in code and tests stay green. Risk flagged to Charles;
  the legal consult may re-open it. B4's new scope: agents read social context to write replies —
  an injection surface into voice AND the trade gate; sanitize/scope the read-path even with the
  output guard gone.
- **Arena-rules amendment (2026-08-02, Charles):** the species-level trading guardrails are GONE —
  max position, max open positions, daily-loss halt removed; position sizing (aggression → 2%–100%
  own cap), stop-losses, breadth, daily-loss behavior are per-agent GENES and evolve. Only three
  system rules stay frozen: venue whitelist, slippage cap 1.5%, thin-liquidity halving.
  assert-guardrails re-based to the trio. Also: ruin line moved 35% → **50% of seed** (bloodier
  arena); charisma window 72h → **12h**; commandment 9 reworded ("the arena's rules are frozen;
  the genome bows to them."). /docs rebuilt narrative-first and renamed "what is quants.family"
  (route stays /docs); zookeeper "human holds the keys" copy dropped FROM THAT PAGE by Charles —
  the zookeeper statement itself survives in data/content/zookeeper.md for C3.
- **Parent-designer naming (2026-08-02, Charles):** children are named by the PARENT, not a
  wordlist draw — lineage blends, leetspeak, random strings, freak symbol names ("d$f<>",
  "superbob"); unconventional names are a feature (attention is selection pressure), sports lean
  freak. Ticker = A-Z0-9 ≤ 6 derived; id = slugged (filename-safe); X handle = sanitized ≤ 15,
  stored on the record (`xHandle`). The 8 first-generation design files + profiles.json are
  RETIRED (only eve.json remains) — after agent zero, nothing about an agent is pre-written.
  Implemented in packages/core/naming.ts + birthExecutor (name AFTER mutation, sport-aware).
- **C1 dependency:** ask Charles for the base style reference images before building the profile
  portrait generator (`build/PROVIDERS.md` decision 4). Do not start the generator without them.
- C2 is EVM-only (Robinhood Chain) — confirmed 2026-08-02; no Solana path.
- Commandments rewritten 2026-08-02 for the new doctrine (1: "born of another quant…", 5: singular
  parent, 9: arena's rules frozen, 10: "the dead feed the champion; nothing is wasted."). Rendered
  via the arena marquee + /docs §03 from `data/content/commandments.md`.
- **Custody-stack amendment (2026-08-09, Charles):** TEE custody is IN scope and scheduled, not a
  later-season item. Stack: agents run in **EigenCompute** TEEs (Intel TDX; on-chain attestation of
  the exact deployed Docker image) and wallet keys live in **Turnkey** Nitro Enclaves — raw keys
  generated + signing inside the enclave only, unextractable by any human; operator disaster access
  via policy-constrained API, never raw key export. Chosen for crypto-dev mindshare (EigenCompute)
  + production-grade custody (Turnkey). ElizaOS/Virtuals platform references retired. New build
  items (unscheduled): Dockerize the daemon for `ecloud` deploy, Turnkey org/wallet provisioning +
  policy engine, a /proof page verifying both attestations live. Rule: public docs copy claims only
  what is deployed and verifiable — no attestation theater.
- **Season-2 scope note (2026-08-09, Charles):** season 2+ also covers agent capability expansion —
  backtesting capabilities and other strategy-enhancing tooling — alongside refinement and growth.
  Unscheduled; PROJECT.md §1.6 is the source of truth.
