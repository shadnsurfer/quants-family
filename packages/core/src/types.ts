/**
 * Shared domain types for the pure math in @quants/core.
 * Conventions: fractions not percents (0.4 = 40%); *Usd dollars; *Cents integer cents; times in ms epoch.
 */

/** Per-quant inputs to the fitness computation (PROJECT.md §4.3). */
export interface FitnessInput {
  id: string;
  /** real P&L since birth as a fraction of seed (0.3 = +30%) */
  pctReturnSinceBirth: number;
  /** worst peak-to-trough equity drawdown since birth, ≥ 0 (0.4 = 40%) */
  maxDrawdown: number;
  /** Pons creator-fee inflow over the trailing 12h, USD */
  feeInflowUsd12h: number;
}

export interface FitnessRow {
  id: string;
  tradingScore: number;
  /** 0..1, normalized across the living population */
  charismaScore: number;
  /** F = 0.7 * trading + 0.3 * charisma */
  fitness: number;
}

/**
 * Everything reproduction eligibility needs to know about one living quant (§4.4).
 * Health gates (age/equity/drawdown/quartile/cooldown) plus the lifetime allowance:
 * childrenBorn must stay below offspringAllowance(lifetimeGeneratedPeakUsd).
 */
export interface BreedingCandidate {
  id: string;
  ageHours: number;
  equityUsd: number;
  seedUsd: number;
  maxDrawdown: number;
  /** last time this quant parented a child, or null if never */
  lastBroodAtMs: number | null;
  /** peak lifetime generated capital (realized trading P&L + fees claimed), USD — monotonic */
  lifetimeGeneratedPeakUsd: number;
  /** children already born to this quant (lifetime) */
  childrenBorn: number;
}

/** Reason codes for failed eligibility conditions. */
export type EligibilityFailure =
  | "too-young"
  | "equity-below-1.3x-seed"
  | "drawdown-too-deep"
  | "not-top-quartile"
  | "cooldown"
  | "allowance-exhausted";

export interface EligibilityResult {
  id: string;
  eligible: boolean;
  failed: EligibilityFailure[];
}

/** Inputs to the death check (PROJECT.md §4.5). */
export interface DeathInput {
  equityUsd: number;
  seedUsd: number;
  unclaimedFeesUsd: number;
  /** current daily compute burn (VPS share + LLM spend), USD/day */
  dailyBurnUsd: number;
}

export type DeathCause = "ruin" | "starvation";

export interface DeathVerdict {
  dead: boolean;
  cause: DeathCause | null;
}

/** Exact fee-claim allocation in integer cents (§4.6 amended 2026-08-02: compute / holders / discretion). */
export interface FeeSplitCents {
  computeReserveCents: number;
  holderRewardCents: number;
  discretionCents: number;
}
