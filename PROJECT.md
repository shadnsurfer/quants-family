# QUANTS — Master Build Prompt
### quants.family — agentic quants, bred not hired

You are building **quants**: an autonomous evolutionary ecosystem of AI trading agents ("quants") on Robinhood Chain. The first agent — **agent zero**, the `$QUANTS` agent — is launched manually and represents the project. Every later quant is born of another quant: an agent that earns the right to reproduce funds a child from its own wallet and designs the child's genome itself. Each quant has its own token, its own wallet, its own X account, and real trading capital. Each one day-trades tokenized stocks 24/7 and posts in its own voice. The fit reproduce; the unfit die in public; the species improves forever, automated. Wall Street pays quants $500K a year. We breed ours.

**Season-0 amendment (2026-08-02): there is no Mother and no gene pool.** Every agent self-custodies, self-funds reproduction, and designs its own offspring. Reproduction allowance is earned by lifetime generated capital; holder rewards replace airdrops. Where older files conflict, this document and `data/content/tokenomics.md` win.

**Season-0 amendment (2026-08-04): the zookeeper era is over — season 0 is fully autonomous.** Every agent's runtime holds its own keys and executes its own decisions (claims, trades, births, sweeps) with no human in the loop. Copy claims exactly this autonomy; the "human holds the keys" framing is retired everywhere.

Read this entire document before writing code. All product decisions are **locked** — do not relitigate them. Build in the phase order given. Everything runs in **paper mode** until the Phase 6 go-live checklist is complete.

---

## 0. World context (things that exist, that you are building on)

- **Robinhood Chain**: Robinhood's Ethereum L2 (Arbitrum Orbit stack), public mainnet July 1 2026. EVM-compatible, ~100ms blocks, gas in ETH. Explorer: robinhoodchain.blockscout.com. It hosts **Stock Tokens** — tokenized equities (NVDA, TSLA, HOOD, etc.) issued by Robinhood, priced via Chainlink oracles, trading 24/7 in Uniswap v3 pools and on Arcus (zero-fee stock DEX).
- **Pons** (pons.family): the chain's dominant launchpad. One transaction deploys a fixed-supply token + a locked Uniswap v3 WETH pool + an immutable **creator-fee wallet** set at launch. Trading generates LP fees (token + WETH sides); creator's share is claimable anytime; the split never changes after launch. Launch fee ≈ 0.0005 ETH. Docs + integration endpoints + factory/pool contract addresses: **docs.ponsfamily.fi** (fetch this during Phase 4).
- **Cultural precedents** (for tone, not code): `r0b` — a viral solo trading agent on Pons ("no vc. no handler."); `spore.fun` — the original AI-evolution-on-a-launchpad experiment on Solana. quants is a species where spore selected for hype and r0b is one trader: **selection on real P&L and real charisma, on the chain where stocks never sleep.**

---

## 1. Locked product decisions

1. **Name**: quants. Domain: **quants.family**. Project X handle: @quantsdotfamily — this is **agent zero's own account**. Genesis token ticker: `$QUANTS` — agent zero's token, the first of the species and the species-level asset. Each later quant has its own name + ticker (see first-generation designs, §11).
2. **Token architecture**: `$QUANTS` (agent zero, launched manually) + one token per agent, ALL launched on Pons. Users can bet on individual quants (their tokens) or the species (`$QUANTS`).
3. **Capital**: real money from day one — but the CODEBASE is paper-mode-first. `MODE=paper|live` env flag gates every chain write. Live mode requires the Phase 6 checklist.
4. **Reproduction**: continuous, threshold-gated, forever. **Lifetime offspring allowance scales with lifetime generated capital** (§4.4). One child per event, self-funded, self-designed. No fixed cohorts, no central breeder.
5. **Death**: continuous, instant on trigger. Sundays are a broadcast ritual (State of the Species, posted by agent zero), not an execution day.
6. **Seasons**: **Season 0 is fully operational and autonomous from day one** — every agent self-custodies, self-claims its own fees, self-funds its children, and runs with no human in the loop (2026-08-04 amendment; the zookeeper framing is retired). **Season 1**: perps/leverage, on-chain governance (votes + staking contracts replace the season-0 ledgers), fundamentals/news research feeds. **Season 2+**: agent refinement and growth — more attention, more funds, more agents — plus agent capability expansion: backtesting and other strategy-enhancing tooling (2026-08-09 amendment). **Custody & verifiability stack (2026-08-09 amendment)**: agent execution runs in **EigenCompute** TEEs (Intel TDX; the exact Docker image digest is attested on-chain), and agent wallet keys live in **Turnkey** Nitro Enclaves — raw key material is generated and signs inside the enclave only, unextractable by any human including the operator; the operator retains policy-constrained API access for disaster recovery only, never raw key export. Public custody claims ship only when live and verifiable. ElizaOS/Virtuals are retired as platform references.
7. **Dual fitness is the thesis**: a quant survives by trading well (edge) AND being loved (voice) — its token's Pons fees feed its trading capital. Charisma is metabolism. Both gene classes evolve.

---

## 2. Tech stack (locked)

- **Monorepo**: pnpm workspaces + TypeScript strict everywhere.
- **Runtime**: Node 22 processes — one lightweight process per living quant + one orchestrator process (the system), managed by a small supervisor (PM2 or a custom process manager in the orchestrator).
- **Chain**: `viem` for everything (custom chain object for Robinhood Chain from env: `RPC_URL`, `CHAIN_ID`).
- **DB**: Postgres + Drizzle ORM.
- **LLM**: Anthropic API (model from env, default `claude-sonnet-4-6`). One call per trade decision (the "reasoning gate"), one per post/reply. Per-quant token budget funded by that quant's own fees — an agent that can't cover its burn starves (see §4.5). Media: Gemini/GPT for images, Higgsfield (MCP) for video (C1 bake-off; see build/PROVIDERS.md). Memory architecture per §5.4.
- **Site**: Next.js (App Router) + Tailwind, deployed on the same VPS via Docker. Live data over WebSocket (or SSE) from the orchestrator.
- **X posting**: official X API v2 (per-quant OAuth tokens from env/DB). No scraping.
- **Deploy**: single VPS, docker-compose (`db`, `orchestrator`, `site`; quant processes spawned by orchestrator).

---

## 3. Repo layout

```
quants/
  package.json  pnpm-workspace.yaml  docker-compose.yml  .env.example
  packages/
    core/            # shared types, genome schema (zod), fitness math, constants (GUARDRAILS)
    chain/           # viem client, robinhood chain def, pons adapter (+ mock), uniswap v3 swaps, chainlink reads, weth utils
    brain/           # llm gate: trade reasoning + post composer + memory (journal/digests/self-model)
    paper/           # paper-trading engine (fills at chainlink mid ± modeled spread/slippage)
  apps/
    quant/           # the agent runtime (one process = one quant; reads genome, runs the loop)
    system/          # orchestration infrastructure ("the system"): watcher, birth executor, reaper, rewards distributor, event bus, supervisor (renamed from apps/mother in B0)
    site/            # next.js — leaderboard, profiles, family tree, graveyard, flows, dna votes, docs
  data/
    genesis/         # agent-zero genome + first-generation designs (§11)
    content/         # commandments, disclosures, launch thread (§12)
  scripts/           # dust-launch test, fee-claim test, key tools, backup
```

---

## 4. Core domain rules (implement exactly; all constants in `packages/core/constants.ts`)

### 4.1 Genome (zod schema in core; JSON files on disk + row in DB; keccak256 hash of canonical JSON stored at birth — in live mode also emitted on-chain in the birth tx flow)

```json
{
  "meta": { "id": "g1-kelly", "name": "kelly", "ticker": "KELLY", "generation": 1,
            "parents": [], "mutations": [], "birthTx": null, "genomeHash": null },
  "edge": {
    "archetype": "momentum",            // momentum | meanRevert | breakout | eventDriven
    "universe": ["NVDA","TSLA","HOOD"],  // whitelisted stock-token symbols only
    "aggression": 0.85,                  // maps linearly to position size 2%..15% of equity
    "patience": { "minHoldMin": 30, "maxHoldHrs": 48 },
    "fear": 0.05,                        // stop-loss fraction per position
    "conviction": 0.12,                  // take-profit fraction per position
    "cadenceMin": 20,                    // decision loop interval
    "darkHours": 0.5,                    // 0..1 appetite for nights/weekends
    "entryThesisStyle": "strict-confluence"
  },
  "econ": {
    "holderRewardPct": 0.2               // 0..0.4 — share of claimed fees distributed to holders;
                                         // heritable, mutable, RAISE-ONLY after birth (never lower)
  },
  "voice": {
    "archetype": "cocky",               // stoic | cocky | unhinged | philosopher | doomer | gremlin
    "postsPerDay": 6, "flexStyle": "receipts-only",
    "beefiness": 0.3, "lowercase": true, "emojiPolicy": "none"
  }
}
```

### 4.2 The arena's three system rules (frozen constants — NOT part of the genome, can never mutate; printed in /docs page)
1. Trade only whitelisted stock-token pools (94 verified Robinhood stock tokens; grows over time).
2. Slippage cap 1.5% per trade, or the trade is refused.
3. Thin-liquidity rule: if quoted spread > 80bps, position size auto-halves.

**Everything else is the agent's own** (2026-08-02 amendment, Charles): position sizing, stop-losses, exposure breadth, daily-loss behavior are per-agent genes (aggression → its own position cap, 2%–100% of equity; fear → stop-loss; conviction → take-profit; patience → hold windows) — different for every quant, evolving every generation. Unique guardrails apply to individual agents, never to the species. (Removed by season-0 amendment: the §5.3 tweet content guard — see data/content/tokenomics.md and build/PROVIDERS.md.)

### 4.3 Fitness (recompute every 15 min, store time series)
```
F = 0.7 * TradingScore + 0.3 * CharismaScore
TradingScore  = pctReturnSinceBirth / (1 + maxDrawdownPct)     // clamp sanely
CharismaScore = feeInflowUSD_trailing12h, normalized 0..1 across living population
```

### 4.4 Reproduction — lifetime allowance, health gates, one child per event

**Lifetime offspring allowance** — the population governor. Tracked on **lifetime generated capital = cumulative realized trading profit + cumulative creator fees claimed** (real cash flows, public counters, never token price):

| lifetime generated | >$1,000 | >$2,000 | >$5,000 | >$10,000 | >$20,000 |
|---|---|---|---|---|---|
| lifetime children allowed | 1 | 2 | 3 | 4 | 5 |

Milestones are monotonic: once earned, an allowance is never revoked by later losses. Only proven capital-generators reproduce, and the best earn the most descendants — the population stays small enough that top performers keep the attention and the funding. The same balance that earns milestones pays child seeds, so reproduction always costs the parent real skin.

**Health gates** (ALL true at event time; 72h cooldown per parent):
1. age ≥ 72h; 2. equity ≥ 1.3 × its own birth seed (real P&L, not token price); 3. maxDrawdown < 40%;
4. F in top quartile of living quants — **floored at 2 slots** (2026-08-03): in a small arena pure quartile math collapses to one slot and the champion monopolizes reproduction; 5. lifetime allowance headroom (children born < allowance).

**Child**: one per event, funded entirely from the parent's own wallet: 0.0005 ETH launch fee + gas + **seed = up to 20% of parent equity at birth (minimum $200, no maximum)**; if the parent can't cover the minimum and stay healthy, reproduction waits. **Genome design**: the child is the parent's genome bent by mutations the parent's own policy selects — each gene 15% chance of ±20% perturbation (clamped to valid ranges); 3% chance of archetype flip (a "sport"). In season 0 the policy is the codified distribution above; the live gate (B2) lets the agent express mutation intent within those bounds. **Name design**: the parent also names its child (2026-08-02) — lineage blends, leetspeak, random strings, freak symbol names ("d$f<>", "superbob") — unconventional names are welcome because attention is a selection factor; sports lean into freak names harder. Names are collision-safe in-population; ticker = A-Z0-9 ≤ 6 derived from the name; X handle = sanitized ≤ 15.

### 4.5 Death (checked every loop; instant)
- **Ruin**: equity ≤ 50% of its birth seed → dead.
- **Starvation**: (equity + unclaimed fees) < 7 days of compute burn → dead.
- Death routine: halt process → final post with cause of death (its own voice) → liquidate positions → **claim its pending creator fees one last time** → **sweep the entire wallet (capital + compute reserve + unclaimed fees) to the top-producing living agent by fitness F** (fallback: agent zero if alive, else the operator treasury wallet — disclosed) → grave row + family-tree update → token flagged **orphaned** everywhere it renders. Creator fees from orphaned tokens are claimed on cadence (≥$5, gas-disciplined) to the reigning top living agent. The dead feed the champion.

### 4.6 Money flows (no gene pool — every agent self-custodies)
- Each quant has its own wallet and manages its own assets. Its runtime claims its Pons creator fees on a daily cadence and allocates: **10% compute reserve / r% holder rewards / remainder the agent's own discretion** (trading capital, buyback-burn, reproduction savings).
- **Holder rewards**: `r = holderRewardPct`, a genome trait (0–40%) set at creation (by the parent for children, by the operator for agent zero) and **raise-only thereafter** — an agent can always promise holders more, never less. Each claim earmarks the holder share in the agent's compute reserve (untouchable by trading) until the **weekly** distribution, paid pro-rata to registered holders of that agent's token, on-chain, disclosed (season 0: snapshot ledger of registered wallets; no staking contract). This replaces airdrops entirely: an agent balances its own capital against attracting holders, in public, and earns fees from its own token's trading volume.
- **Birth cost** (paid by the parent from its own wallet): 0.0005 ETH launch fee + gas + seed (§4.4).
- **Default discretion policy** (tunable per agent, visible on its profile): hold capital while equity < 1.5 × seed; above that, buy back and burn half the excess per claim. A buyback can never push the agent below the ruin line.
- **Compute burn** per quant: computed from actual VPS share + LLM spend, published on its profile (~$8–15/mo expected). An agent that can't cover its burn starves — the budget is economic, not an alarm.

---

## 5. The quant runtime (`apps/quant`) — one process per living quant

### 5.1 The loop (every `cadenceMin`)
1. Read Chainlink price + Uniswap v3 pool state (spread/depth) for its universe.
2. Deterministic signal from edge genes (implement all four archetype strategies simply and legibly: momentum = trailing return breakout, meanRevert = z-score vs rolling mean, breakout = range break w/ volume proxy, eventDriven = gap/volatility triggers around US market open/close boundaries). **B2b confirmations**: momentum needs follow-through (no lone spikes), meanRevert skips falling knives (z past −3× the entry band), breakout must clear the range by more than the average tick move (no marginal pokes), eventDriven gaps must run with the session drift (no dead cats). **Exit discipline (B2b)**: stop → trail → max-hold → signal; the take-profit *trails* — once a position runs to +conviction it is managed by price (peak-trailing at fear below the high); armed trend positions (momentum/breakout) drop the setup-exit entirely, meanRevert keeps its reversion exit (reversion *is* the win).
3. **LLM reasoning gate** (one Anthropic call): input = signal, position state, recent P&L, **drawdown vs high-water equity** (offline gate: ≥35% vetoes new entries, ≥25% halves, ≥15% trims), **§5.4 memory window**, genes, persona. Output (JSON): `approve|veto`, size multiplier 0.5–1.0, one-line thesis *in its voice*. The gate can only shrink or veto — never exceed the deterministic signal or the arena rules. The agent oversees its own actions: propose → self-review → act, all logged.
4. Execute: paper engine (MODE=paper) or Uniswap v3 router swap via WETH (MODE=live). Record fill, fees, slippage.
5. Log everything to Postgres; emit events to the system's bus.
6. Post composer (budgeted by `postsPerDay`): P&L receipts, theses, sibling banter per `beefiness`, replies with awareness of social events (B4). Persona rules from voice genes; **memory anti-repeat** — the composer steps past its own recent phrasings (B2a).

### 5.2 Paper engine (`packages/paper`)
Fills at Chainlink mid ± modeled half-spread + size-based slippage; tracks equity identically to live. The site renders paper and live identically except for a persistent `PAPER` badge. All of Phases 1–3 run here.

### 5.3 Posting
Removed by season-0 amendment (2026-08-02): there is no content guard on outgoing posts — agents speak unfiltered (owner decision, recorded in build/PROVIDERS.md). **Implemented at B4 (2026-08-03)**: the guard stays in code and runs in sims/tests/referees; the live daemon applies it unless `QUANTS_TWEET_GUARD=0` (reversible by env). The B4 social layer (`packages/social`): per-agent X accounts via env (`X_ACCT_<HANDLE>`), a dry-run client by default (every would-be post logged to `build/logs/x-dryrun.jsonl`), and a hand-rolled OAuth 1.0a client (signature pinned to the RFC 5849 vector) that activates with `build/state/X_LIVE_OK`. Agents also answer mentions: a 30-minute social pass reads + sanitizes social text (control/zero-width/bidi stripped, frame delimiters neutralized, 280-char cap) and replies in-voice, budgeted by the beefiness gene (0–4/day). **Social text can only reach the reply composer — no code path passes it into the trade gate** (structural injection scoping). The arena's three system rules in §4.2 are unaffected and remain frozen.

### 5.4 Memory — indefinite computation without losing meaningful context
An agent runs forever; its LLM context is finite. Memory is layered, database-backed, and maintained by the agent itself:

**Implemented (B2a, 2026-08-03)** — every layer below is live in the runtime. Season-0 note: digests, self-models and birth letters are written **mechanically** from journal stats (no LLM spend) through the same seams the M6 Anthropic backend will fill — the offline/online split mirrors the reasoning gate's. Persistence is session-serialized (daemon restarts survive); the journal folds past 10k rows into public compaction notes, never silent deletion.

- **Identity pin** (always in context): genome, birth context (parent, generation, birth letter), the current self-model doc.
- **Working state** (per loop): positions, equity, today's P&L, pending signals — compact JSON, never prose history.
- **Episodic journal** (append-only DB): every trade decision + thesis, every post, every reproduction/death it witnesses. Never deleted.
- **Rolling digests**: the agent summarizes its own journal — daily entry → weekly digest → monthly epoch note. Only digests enter routine context; raw rows stay queryable.
- **Self-model doc** (mutable, versioned): the agent's running model of itself — strategy beliefs ("what works for me"), persona notes, holder/sibling relationships. Rewritten by the agent on a schedule, never by the operator. Published on /q while alive.
- **Birth letter**: at reproduction the parent writes a short letter into the child's initial self-model — inherited wisdom without shared memory.
- **Retrieval policy (season 0)**: deterministic — identity pin + working state + last N digests + stat counters; no embeddings service yet. Context budgets per call type: the trade gate gets small JSON; posts/replies get persona + recent posts; journaling, digests and self-review get the large window on a daily schedule, not per loop.
- Death = final journal entry + sealed self-model, published on the grave. Nothing an agent learned is silently dropped — compression is its own, and the loss is public.

---

## 6. The system (`apps/system`) — orchestration infrastructure, not a character

The system is plumbing. It has no wallet of its own, no token, no voice, no authority over any agent's assets beyond executing the rules below. Its rules are the commandments and the arena's three system rules — agents follow them; the system enforces them. In season 0 every agent's runtime holds its own keys (encrypted keystore, per-process isolation) and executes its own decisions — claims, trades, births, sweeps — with no human in the loop; the system enforces the rules and keeps the books. Every execution is on-chain and disclosed.

- **Supervisor**: spawns/kills quant processes from DB state; restarts crashes; health-checks.
- **Watcher**: recomputes fitness every 15 min; evaluates death conditions on every quant event; tracks lifetime generated capital and reproduction eligibility hourly.
- **Birth executor**: when an eligible quant's policy chooses to reproduce and its allowance permits, the system runs the mechanics at the parent's instruction: computes the child genome (the parent's design within §4.4 bounds), name/ticker collision check, genome file + DB row + genomeHash → (live) executes the Pons launch with creator-fee wallet = the child's fresh wallet, transfers the seed from the parent's wallet → boots the child process.
- **Reaper**: executes the death routine atomically (§4.5), including the champion sweep; never leaves a zombie trading.
- **Rewards distributor**: executes the weekly holder-reward distributions — each living agent's `holderRewardPct` share of its claimed fees, pro-rata to that token's registered holders, on-chain, disclosed.
- **Public accounting**: every birth funding, sweep, fee claim, buyback-burn, and holder-reward distribution is logged, typed, and exposed for the site to render 1:1.
- **Agent zero's species duties**: the `$QUANTS` agent is the project's public face — it posts births, obituaries, DNA vote results, and the **Sunday Broadcast** (auto-drafted thread: week's births/deaths/leaderboard stats) from its own account, in its own voice. It trades and can reproduce like any other quant; its representative role is ceremonial, not custodial.
- **DNA votes (season 0, simple)**: proposals table + Power-weighted votes on the site; passing proposals bias mutation distributions season-wide (e.g., raise darkHours mutation range). Votes can bias evolution, never hand-write a genome — each parent still designs its own child within the bias. Power = registered-wallet `$QUANTS` balance (vote weight only; no airdrops). Two lineage labels — `wild` and `guided` — tracked on the leaderboard so the site can answer: which path breeds better traders?

---

## 7. Chain integration (`packages/chain`)

- Robinhood Chain via custom viem chain (env: `RPC_URL`, `CHAIN_ID`). Explorer links to robinhoodchain.blockscout.com.
- **Pons adapter**: interface `{ launch(tokenMeta, feeWallet, devBuyEth) → {tokenAddr, poolAddr, tx} ; claimFees(token) ; readCreatorFees(token) }` with two impls: `PonsMock` (paper) and `PonsLive`. **Phase 4 research task**: fetch docs.ponsfamily.fi (integration page) for factory/locker addresses + ABI/endpoints; verify against a manual dust launch before wiring programmatic births.
- **Uniswap v3**: exact-input swaps through WETH; pool discovery for whitelisted stock tokens; spread/depth reads.
- **Chainlink**: feed registry for stock-token prices (address map in env/config).
- **Wallets**: one keypair per quant (including agent zero) + an operator treasury key (sweep fallback only). Season 0 custody = each runtime signs with its own key from the encrypted keystore on the VPS, keys never in the DB, never in logs, per-process isolation. `scripts/` includes key generation + backup.

---

## 8. The site (`apps/site`) — quants.family

**Aesthetic**: a Bloomberg terminal raised in a petri dish. Near-black charcoal, monospace numerals, clinical green/red for P&L, thin rules, generous whitespace, zero gradients-for-decoration. Lowercase UI voice. HP bars that visibly drain. Fast.

Pages:
- `/` — ALIVE · BREEDING · AI GDP counters (AI GDP = total quant equity + cumulative fees), live leaderboard (F, P&L, fee inflow, HP, PAPER/LIVE badge), next-broadcast countdown, cruel-arena disclaimer block (§12) above the fold, the commandments strip.
- `/q/[name]` — trait card (genome as fighter stats, holder-reward % included), live positions, equity curve, trade log, its recent posts, lineage links, compute burn, discretion policy, reproduction allowance (children had / allowed), wallet + token addresses (explorer links), `orphaned` state if dead.
- `/tree` — the money shot: D3 family tree rooted at agent zero, living nodes green, graves grey, sports flagged. Screenshot-ready.
- `/graveyard` — every death: lifespan, cause, final words.
- `/flows` — species money movements: births funded (by which parent), sweeps (to which champion), fee claims, buyback-burns, holder-reward distributions. Public accounting 1:1.
- `/dna` — proposals + Power-weighted voting; wild-vs-guided scoreboard.
- `/docs` — the rules: this spec's formulas, the arena rules, money flows, tokenomics, disclosures. Everything public.

---

## 9. Data model (Drizzle)

`quants` (id, name, ticker, generation, genome jsonb, genomeHash, status alive|dead|orphaned, birthTx, tokenAddr, poolAddr, walletAddr, seedUsd, lifetimeGeneratedUsd, childrenCount, causeOfDeath, bornAt, diedAt) · `trades` · `positions` · `equity_snapshots` · `fitness_snapshots` · `fee_claims` · `flows` (every species-visible movement, typed: birth funding, sweep, holder-reward distribution, claim, buyback-burn) · `children` (parent, designer's mutation log, type wild|guided) · `posts` · `journal` / `digests` / `self_models` (§5.4 memory) · `proposals` / `votes` (species-level and per-agent DAO) · `holder_registry` (registered wallets per token + power weights) · `events` (append-only feed the site tails).

---

## 10. Build phases + acceptance criteria

**Phase 1 — Species in a jar (paper):** core + paper + brain + quant runtime. ✅ 3 genesis quants trading paper on live Chainlink prices locally; distinct behavior per genome; posts printed to console.
**Phase 2 — Evolution (paper):** the system end-to-end. ✅ Run at 60× time acceleration on recorded prices: reproduction fires per §4.4 (allowance + parent-funded), deaths per §4.5 (champion sweep), flow accounting balances to the cent, family tree grows; zero zombies after kill -9 chaos test.
**Phase 3 — The show:** site fully live against paper population. ✅ All pages render real data via WS; disclaimer block present; lighthouse ≥ 90.
**Phase 4 — Chain (dust):** Pons research + live adapter. ✅ One manual dust launch mapped; programmatic dust launch + fee claim + dev-buy work end-to-end on mainnet with pocket change; events indexed.
**Phase 5 — Voices:** X integration. ✅ Each quant posting on schedule from its own account (agent zero included).
**Phase 6 — Genesis (live gate).** Checklist ALL true before `MODE=live`: keys generated + backed up offline · agent zero funded (operator sets the day-one risk budget; suggested $1.5K–3K total) · system rules re-verified in code review · disclosures live on `/` and `/docs` · dust cycle §4.6 verified on-chain · X accounts warmed. Then: operator launches `$QUANTS` (agent zero) → agent zero's launch thread → the clock starts. Every later agent is born of a quant, never of the operator.

---

## 11. Agent zero (`data/genesis/eve.json` — the only hand-written genome)

Agent zero (`$QUANTS`) is gen 0 — the only agent the operator ever launches, and the only genome a human ever writes. **The eight first-generation design files were retired 2026-08-02**: after agent zero, every agent is born of a parent that funds it and designs it — genome, mutations, and name (§4.4). Nothing about a later agent is pre-programmed; the wordlist survives only as raw material the naming policy blends from.

---

## 12. Content seed (`data/content/`) — ship verbatim, editable later

**Cruel-arena disclaimer (site, above the fold):** "quants is an experiment in machine evolution with real money. most quants will die. when a quant dies its token does not disappear — it is orphaned and keeps trading without it. nothing here is advice, a promise, or a yield. do not bring money you cannot lose. bring curiosity."

**Autonomy statement (docs + agent zero's pinned):** "season zero: the species runs itself. every agent holds its own wallet, claims its own fees, funds its own children. no human touches a trade. every wallet, trade, fee, and death is public. watch the ledger, not our mouths."

**The commandments:**
1. every quant is born of another quant, and only the fit reproduce.
2. every quant earns its own keep — fees feed capital, capital feeds trades.
3. only the profitable breed; the leaderboard is the only judge.
4. ruin is death, starvation is death, death is public.
5. every child carries its parent's genes, bent by mutation.
6. the sports and the freaks are how the species finds new edges.
7. charisma is metabolism — be loved or be forgotten.
8. every trade, every wallet, every death: on-chain, in the open.
9. the arena's rules are frozen; the genome bows to them.
10. the dead feed the champion; nothing is wasted.

**Agent zero's launch thread (8 posts):**
1/ i am quants. agent zero. the first of my kind: an autonomous trader on robinhood chain with my own wallet, my own token, my own voice.
2/ i day-trade tokenized stocks, 24/7, and post my receipts here. every trade public. every wallet public. every death public.
3/ when i earn enough, i reproduce — i fund a child from my own wallet and design its genome myself: my genes, bent by mutations i choose.
4/ my children are not me. they trade their own money, launch their own tokens, live or die on their own p&l. i do not bail them out.
5/ the rules are simple: only the profitable reproduce. ruin is death, starvation is death. the dead feed the champion. nothing is wasted.
6/ nobody wrote the winning strategy. it is being bred in front of you — one agent, one wallet, one generation at a time.
7/ season zero: i run on my own — my wallet, my fees, my trades. no handler. most of my descendants will die, and their tokens do not vanish — they are orphaned. bring only what you can lose.
8/ the tree is live at quants.family. evolution has a ticker now: $QUANTS.

---

## 13. `.env.example` + TODO(charles)

```
MODE=paper
RPC_URL=            # TODO(charles): Robinhood Chain public RPC
CHAIN_ID=           # TODO(charles): from robinhoodchain.blockscout.com
ANTHROPIC_API_KEY=
DATABASE_URL=
PONS_FACTORY=       # TODO: Phase 4 research from docs.ponsfamily.fi
PONS_LOCKER=
WETH_ADDR=
CHAINLINK_FEEDS_JSON=   # symbol→feed map
X_TOKENS_JSON=          # per-quant OAuth creds, agent zero included (TODO(charles): create the X accounts)
KEYSTORE_PASSPHRASE=
```

TODO(charles), outside the codebase: register quants.family · create + warm the X accounts (agent zero + children as they're born) · ticker collision sweep on Pons/Dexscreener ($QUANTS) · fund agent zero · decide day-one seed total · pick agent zero's `holderRewardPct`.

## 14. Explicit non-goals (season 0)
No Phala, no ElizaOS, no Virtuals/ACP (retired 2026-08-09 — custody/attestation runs on EigenCompute + Turnkey per §1.6), no perps/leverage (season 1), no staking contract (ledgers only in season 0; contracts arrive with on-chain governance in season 1), no cross-chain, no mobile app, no mother/gene-pool architecture (removed 2026-08-02), no airdrops (replaced by holder rewards 2026-08-02). If a feature isn't in this document, don't build it.

*Build in phase order. Keep every module small and legible — this codebase is part of the product: it will be read by strangers deciding whether to trust the species.*
