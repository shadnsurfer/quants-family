/**
 * @quants/core constants — the frozen spine of the species.
 *
 * GUARDRAILS are hard risk limits (PROJECT.md §4.2). They are NOT genome, they never mutate,
 * and nothing in packages/ or apps/ may assign to them. build/scripts/assert-guardrails.mjs
 * enforces this boundary on every verify run. Evolution parameters live in separate frozen
 * objects below — fixed for season 0, but conceptually distinct from the risk guardrails.
 *
 * Unit conventions (everywhere in @quants/core):
 *   - fractions, not percents: 0.15 means 15%
 *   - `*Usd` values are dollars (floats at the edges), `*Cents` are integer cents (exact math)
 *   - `*Bps` are basis points
 */

export const GUARDRAILS = Object.freeze({
  /**
   * The arena's three system rules (2026-08-02 amendment, Charles): the ONLY limits the species
   * imposes on every agent. Everything else — position sizing, stop-losses, exposure breadth,
   * daily-loss behavior — is per-agent, written in each genome's own genes (aggression, fear,
   * conviction, patience), and evolves. Unique guardrails belong to individual agents, never to
   * the species.
   *
   * 1. Trade only whitelisted stock-token pools. The list mirrors the canonical on-chain
   *    registry (packages/chain stockTokens.ts — 94 verified "• Robinhood Token" assets,
   *    2026-07-23). HOOD is absent because Robinhood does not tokenize itself. A chain-side
   *    test asserts this list and the address registry stay in lockstep. (Grows over time.)
   */
  venueWhitelist: Object.freeze([
    "NVDA", "SPCX", "TSLA", "AAPL", "GME", "SNDK", "GOOGL", "AMD", "SPY", "MSFT",
    "MU", "AMZN", "SGOV", "PLTR", "META", "COIN", "USO", "QQQ", "INTC", "CRCL",
    "ORCL", "CRWV", "USAR", "SLV", "BE", "BABA", "TSM", "COST", "NFLX", "RKLB",
    "NBIS", "DELL", "EWY", "QCOM", "RDDT", "CBRS", "RDW", "ASTS", "QUBT", "LUNR",
    "AMAT", "LLY", "MSTR", "SOFI", "AVGO", "AAOI", "XOM", "IONQ", "SMCI", "IREN",
    "SOXX", "MRVL", "RGTI", "SPMO", "QBTS", "POET", "PENG", "LITE", "NVTS", "UMC",
    "INOD", "CCL", "NNE", "CLSK", "XNDU", "MXL", "TSEM", "TTWO", "FLNC", "GLW",
    "APLD", "BA", "XLK", "ASML", "P", "ZS", "DDOG", "NU", "RBLX", "NOW",
    "F", "FUTU", "UPS", "INTU", "RIVN", "ZM", "CELH", "SHOP", "WDAY", "LULU",
    "MDB", "PR", "ELF", "SATS",
  ] as const),
  /** 2. hard slippage cap per trade (1.5%) */
  slippageCapPct: 0.015,
  /** 3. thin-liquidity rule: quoted spread above this halves position size */
  thinLiquiditySpreadBps: 80,
  thinLiquiditySizeFactor: 0.5,
} as const);

/** Fitness weights and cadence (PROJECT.md §4.3). */
export const FITNESS = Object.freeze({
  tradingWeight: 0.7,
  charismaWeight: 0.3,
  /** TradingScore = pctReturnSinceBirth / (1 + maxDrawdown), clamped to this band ("clamp sanely") */
  tradingScoreClamp: Object.freeze({ min: -1, max: 5 }),
  recomputeMinutes: 15,
  /** charisma window: fee inflow over the trailing 12 hours (Charles 2026-08-02) */
  charismaTrailingHours: 12,
} as const);

/** Spawn eligibility thresholds (PROJECT.md §4.4, lineage-model amendment 2026-07-24). */
export const BREEDING = Object.freeze({
  minAgeHours: 72,
  minEquityMultipleOfSeed: 1.3,
  /** strictly below this drawdown (0.40 exactly is INELIGIBLE) */
  maxDrawdownLimit: 0.4,
  topQuartileFraction: 0.25,
  /**
   * ...but never fewer than this many breeding slots (Charles 2026-08-03): in a small arena
   * pure quartile math collapses to ONE slot and the champion monopolizes reproduction —
   * the floor keeps at least 2 agents spawn-eligible while the population is small.
   */
  topQuartileMinSlots: 2,
  cooldownHours: 72,
} as const);

/**
 * The reproduction governor (Charles directive 2026-08-02): lifetime offspring allowance scales
 * with LIFETIME GENERATED CAPITAL — cumulative realized trading profit + cumulative creator fees
 * claimed (real cash flows, public counters, never token price). Milestones are monotonic: once
 * earned, an allowance is never revoked by later losses. One child per event, self-funded,
 * self-designed. This replaces the old brood/gen-cap/alive-cap attention model.
 */
export const OFFSPRING = Object.freeze({
  /** lifetime generated-capital milestones (USD, ascending, strictly-greater comparison) */
  allowanceMilestonesUsd: Object.freeze([1000, 2000, 5000, 10000, 20000] as const),
  /** children per reproduction event */
  childrenPerEvent: 1,
} as const);

/** Lifetime children allowed at a given lifetime generated-capital peak. */
export function offspringAllowance(lifetimeGeneratedPeakUsd: number): number {
  let n = 0;
  for (const m of OFFSPRING.allowanceMilestonesUsd) {
    if (lifetimeGeneratedPeakUsd > m) n += 1;
  }
  return n;
}

/** Mutation odds (PROJECT.md §4.4). */
export const MUTATION = Object.freeze({
  /** each numeric gene mutates with this probability */
  geneChance: 0.15,
  /** perturbation is uniform in ±this fraction of the current value, clamped to GENE_RANGES */
  perturbFraction: 0.2,
  /** chance an archetype gene flips to a random different archetype (a "sport") */
  sportChance: 0.03,
} as const);

/** Death triggers (PROJECT.md §4.5, amended 2026-08-02: ruin at 50% of seed). */
export const DEATH = Object.freeze({
  /** ruin: equity ≤ this fraction of seed */
  ruinEquityFractionOfSeed: 0.5,
  /** starvation: (equity + unclaimed fees) < this many days of compute burn */
  starvationRunwayDays: 7,
} as const);

/** Money flows (PROJECT.md §4.6, amended 2026-08-02: no pool, no tithe, no airdrops). */
export const MONEY = Object.freeze({
  launchFeeEth: 0.0005,
  /** fee-claim allocation: this share goes to the compute reserve; the genome's
   * econ.holderRewardPct goes to holders; the remainder is the agent's discretion */
  computeReserveSplit: 0.1,
  /**
   * Funding cascade (automated, no manual wallet funding): each child is endowed from its
   * PARENT's own balance — this fraction of the parent's current equity at birth. The endowment
   * covers the child's Pons launch fee, then the remainder is its trading seed. A parent that
   * hasn't grown its balance simply can't afford to reproduce — "only the profitable breed."
   */
  parentEndowmentPct: 0.2,
  /** minimum child trading seed, USD (after launch costs) — Charles 2026-08-02: $200, no maximum */
  minChildTradingUsd: 200,
} as const);

/** Valid range per mutable numeric gene, addressed by dot-path into the genome. */
export interface GeneRange {
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
}

export const GENE_RANGES: Readonly<Record<string, GeneRange>> = Object.freeze({
  "edge.aggression": Object.freeze({ min: 0.05, max: 1 }),
  "edge.fear": Object.freeze({ min: 0.01, max: 0.25 }),
  "edge.conviction": Object.freeze({ min: 0.02, max: 0.5 }),
  "edge.cadenceMin": Object.freeze({ min: 5, max: 240, integer: true }),
  "edge.darkHours": Object.freeze({ min: 0, max: 1 }),
  "edge.patience.minHoldMin": Object.freeze({ min: 5, max: 720, integer: true }),
  "edge.patience.maxHoldHrs": Object.freeze({ min: 1, max: 168, integer: true }),
  "voice.postsPerDay": Object.freeze({ min: 1, max: 24, integer: true }),
  "voice.beefiness": Object.freeze({ min: 0, max: 1 }),
  // strategy-math genes (appended so earlier paths keep their mutation roll order)
  "edge.signal.momentumLookback": Object.freeze({ min: 2, max: 12, integer: true }),
  "edge.signal.momentumEntryPct": Object.freeze({ min: 0.005, max: 0.05 }),
  "edge.signal.meanRevertWindow": Object.freeze({ min: 5, max: 30, integer: true }),
  "edge.signal.meanRevertEntryZ": Object.freeze({ min: 0.5, max: 3 }),
  "edge.signal.breakoutRange": Object.freeze({ min: 6, max: 30, integer: true }),
  "edge.signal.breakoutExpansion": Object.freeze({ min: 1.05, max: 2.5 }),
  "edge.signal.eventGapPct": Object.freeze({ min: 0.003, max: 0.03 }),
  "edge.signal.eventWindowMult": Object.freeze({ min: 0.25, max: 3 }),
  // research genes (flow desk)
  "edge.flowWeight": Object.freeze({ min: 0, max: 1 }),
  "edge.flowSkepticism": Object.freeze({ min: 0, max: 1 }),
  // econ genes: the holder-reward share (Charles 2026-08-02). Heritable and mutable at design
  // time like any numeric gene; the RAISE-ONLY rule binds only post-birth self-adjustment.
  "econ.holderRewardPct": Object.freeze({ min: 0, max: 0.4 }),
});

/**
 * aggression 0..1 → position size as a fraction of equity, mapped linearly 2%..100%.
 * The agent's OWN risk limit (2026-08-02 amendment): there is no species position cap —
 * aggression IS the cap, written in the genome, evolving per agent. Oversized agents
 * meet the ruin line quickly; that is the arena working.
 */
export function aggressionToPositionPct(aggression: number): number {
  const minPct = 0.02;
  const a = Math.min(1, Math.max(0, aggression));
  return minPct + a * (1 - minPct);
}
