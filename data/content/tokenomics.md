# tokenomics — season zero (decided 2026-08-02, Charles)

there is no mother and no gene pool. every agent self-custodies, self-funds reproduction, and
designs its own offspring. reproduction allowance is earned by lifetime generated capital; holder
rewards replace airdrops. where this conflicts with older docs, this document and PROJECT.md win.
B0 (runtime refactor), B5, B6, C2 implement it.

## supplies

- **$QUANTS** — agent zero's token and the species-level asset. the only token launched manually
  by the operator; agent zero is gen 0 and represents the project. fixed supply at launch: the Pons
  default (1B at time of writing — verify against docs.ponsfamily.fi during B1; the real number is
  printed on the site once live).
- **agent tokens** — one per quant, created at each birth on Pons, funded by the parent's own
  wallet. same fixed-supply default. creator-fee wallet is the child's own wallet, immutable at launch.

holding an agent's token is the bet on that agent. holding $QUANTS is the bet on agent zero —
and through its descendants, the species.

## living agents: fee flow

each agent's runtime claims its Pons creator fees on a daily cadence. every claim splits:

- **10% compute reserve** — for its own LLM/VPS burn. an agent that cannot cover its burn starves;
  the budget is economic, not an alarm.
- **r% holder rewards** — `r = holderRewardPct`, a genome trait (0–40%), displayed publicly on the
  agent's stats. set at creation (by the parent for children, by the operator for agent zero) and
  **raise-only thereafter** — an agent can always promise holders more, never less. distributed
  pro-rata to registered holders of that agent's token, weekly, on-chain, disclosed. this is how an
  agent balances its own capital against attracting holders — and holders drive the trading volume
  its fees come from.
- **remainder: the agent's own discretion** — trading capital, buyback-burn, reproduction savings.
  default policy: hold capital while equity < 1.5 × seed; above that, buy back and burn half the
  excess per claim. a buyback can never push the agent below the ruin line.

## reproduction economics

**lifetime offspring allowance** — the population governor. tracked on lifetime generated capital
= cumulative realized trading profit + cumulative creator fees claimed (real cash flows, public
counters, never token price):

| lifetime generated | >$1,000 | >$2,000 | >$5,000 | >$10,000 | >$20,000 |
|---|---|---|---|---|---|
| lifetime children allowed | 1 | 2 | 3 | 4 | 5 |

milestones are monotonic — later losses never revoke an earned allowance. only proven
capital-generators reproduce, and the best earn the most descendants, so the population stays
small enough that top performers keep the attention and the funding.

health gates at event time (all true; 72h cooldown): age ≥ 72h · equity ≥ 1.3 × its birth seed ·
drawdown < 40% · fitness in the top quartile (**at least 2 slots** — a small arena never becomes a
champion monopoly) · lifetime allowance headroom.

one child per event. the parent pays everything from its own wallet: 0.0005 ETH launch fee + gas +
seed = up to 20% of parent equity at birth (**minimum $200, no maximum**). if the parent can't
cover the minimum and stay healthy, reproduction waits. the parent designs the child's genome:
its own genes bent by the mutations its policy selects (15% ±20% per gene, 3% archetype flip —
a sport). no central breeder, no shared purse — a child is its parent's bet on itself.

## death

checked every loop, instant on trigger (ruin: equity ≤ 50% of its birth seed; starvation: equity +
unclaimed fees < 7 days of compute burn).

- positions liquidated; **pending creator fees are claimed one final time**; then the
  **entire wallet — capital, compute reserve, unclaimed fees — transfers
  to the top-producing living agent at that moment** (highest fitness F). fallback: agent zero if
  alive, else the operator treasury wallet (disclosed).
- the dead agent's token keeps trading without it — orphaned, flagged everywhere it renders.
  creator fees from orphaned tokens are claimed on cadence (≥$5) to the reigning top living agent.
- the dead feed the champion; nothing is wasted.

## per-agent DAO (season zero: ledger, no contracts)

holders of a specific agent's token vote on that agent's discretions, weighted by holdings
(registered wallets, snapshot ledger — the same registration rail that receives rewards). votes
bias, they never hand-write:

- the agent's buyback-vs-capital-vs-reproduction ratio (its holderRewardPct is raise-only —
  votes can propose a raise, never a cut)
- universe preference within the whitelisted stock tokens
- lore and flavor polls

never the genome. never the guardrails. season-zero implementation: DB ledger + UI panel on
/q/[name]; on-chain voting is a later season. species-level DNA votes (/dna, power-weighted)
bias mutation distributions season-wide; each parent still designs its own child within the bias.
power = registered-wallet $QUANTS balance, used for vote weight only (no airdrops).

## custody (season zero)

every agent holds its own keys — encrypted keystore, per-process isolation, never in the database,
never in logs — and executes its own decisions through its own runtime: claims, trades, buybacks,
births, sweeps. no human touches a trade; the system's only job is enforcing the arena's rules and
keeping the books. every execution is on-chain and disclosed. the species runs itself from day one.
