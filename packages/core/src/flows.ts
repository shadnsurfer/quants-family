/**
 * Money-flow math (PROJECT.md §4.6, amended 2026-08-02) — exact to the cent. All arithmetic in
 * integer cents; dollar-float helpers only at the edges. The system's flow ledger (apps/system)
 * builds on these primitives and asserts conservation structurally: every movement is
 * double-entry, money in = money out, always.
 */
import { MONEY } from "./constants.js";
import type { FeeSplitCents } from "./types.js";

export function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}

export function centsToUsd(cents: number): number {
  return cents / 100;
}

/**
 * Split a claimed fee amount with EXACT conservation: computeReserve = floor(10%),
 * holderReward = floor(r%) where r is the quant's econ.holderRewardPct gene, and the
 * discretion (trading capital / buyback-burn / reproduction savings) takes the remainder.
 * The three parts always sum to exactly `totalCents`; each part is ≥ 0.
 */
export function splitFeeClaimCents(totalCents: number, holderRewardPct: number): FeeSplitCents {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new RangeError(
      `splitFeeClaimCents: totalCents must be a non-negative integer, got ${totalCents}`,
    );
  }
  if (!(holderRewardPct >= 0 && holderRewardPct <= 0.4)) {
    throw new RangeError(
      `splitFeeClaimCents: holderRewardPct must be within 0..0.4, got ${holderRewardPct}`,
    );
  }
  const computeReserveCents = Math.floor(totalCents * MONEY.computeReserveSplit);
  const holderRewardCents = Math.floor(totalCents * holderRewardPct);
  const discretionCents = totalCents - computeReserveCents - holderRewardCents;
  return { computeReserveCents, holderRewardCents, discretionCents };
}

/**
 * The funding cascade: a child's endowment = MONEY.parentEndowmentPct of the parent's current
 * equity, in cents. The endowment covers the Pons launch fee; the remainder is the child's
 * trading seed, which must clear MONEY.minChildTradingUsd ($200, no maximum).
 */
export function childEndowmentCents(parentEquityCents: number): number {
  return Math.round(parentEquityCents * MONEY.parentEndowmentPct);
}

/** Can this endowment fund a viable child at the current launch fee? */
export function childSeedOk(endowmentCents: number, launchFeeCents: number): boolean {
  return endowmentCents - launchFeeCents >= usdToCents(MONEY.minChildTradingUsd);
}
