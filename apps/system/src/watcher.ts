/**
 * Watcher (PROJECT.md §6): recomputes fitness, evaluates death conditions, surfaces
 * reproduction-eligible parents, and picks the champion for death sweeps. Pure functions
 * over the system's records — all state changes happen in the birth executor/reaper.
 */
import {
  FITNESS, checkEligibility, computeFitnessTable, deathCheck,
  type BreedingCandidate, type DeathCause, type FitnessRow,
} from "@quants/core";
import type { QuantRecord } from "./types.js";

function living(quants: readonly QuantRecord[]): QuantRecord[] {
  return quants.filter((q) => q.status === "alive");
}

/** Fitness across the LIVING population (dead quants stop being ranked). */
export function buildFitnessTable(
  quants: readonly QuantRecord[],
  equityById: ReadonlyMap<string, number>,
): FitnessRow[] {
  const rows = living(quants).map((q) => {
    const equity = equityById.get(q.id) ?? q.seedUsd;
    const drawdown = q.peakEquityUsd > 0 ? Math.max(0, (q.peakEquityUsd - equity) / q.peakEquityUsd) : 0;
    return {
      id: q.id,
      pctReturnSinceBirth: q.seedUsd > 0 ? (equity - q.seedUsd) / q.seedUsd : 0,
      maxDrawdown: drawdown,
      feeInflowUsd12h: q.feeRatePerHourUsd * FITNESS.charismaTrailingHours,
    };
  });
  return computeFitnessTable(rows);
}

/** §4.5 death triggers for every living quant. */
export function evaluateDeaths(
  quants: readonly QuantRecord[],
  equityById: ReadonlyMap<string, number>,
): Array<{ id: string; cause: DeathCause }> {
  const out: Array<{ id: string; cause: DeathCause }> = [];
  for (const q of living(quants)) {
    const verdict = deathCheck({
      equityUsd: equityById.get(q.id) ?? q.seedUsd,
      seedUsd: q.seedUsd,
      unclaimedFeesUsd: q.unclaimedFeesUsd,
      dailyBurnUsd: q.dailyBurnUsd,
    });
    if (verdict.dead && verdict.cause) out.push({ id: q.id, cause: verdict.cause });
  }
  return out;
}

/** §4.4 eligibility for every living quant, most-fit first. */
export function evaluateBreeding(
  quants: readonly QuantRecord[],
  fitnessRows: readonly FitnessRow[],
  equityById: ReadonlyMap<string, number>,
  nowMs: number,
): QuantRecord[] {
  const fitnessById = new Map(fitnessRows.map((r) => [r.id, r.fitness]));
  const eligible: QuantRecord[] = [];
  for (const q of living(quants)) {
    const candidate: BreedingCandidate = {
      id: q.id,
      ageHours: (nowMs - q.bornAtMs) / 3_600_000,
      equityUsd: equityById.get(q.id) ?? q.seedUsd,
      seedUsd: q.seedUsd,
      maxDrawdown: q.peakEquityUsd > 0
        ? Math.max(0, (q.peakEquityUsd - (equityById.get(q.id) ?? q.seedUsd)) / q.peakEquityUsd)
        : 0,
      lastBroodAtMs: q.lastBroodAtMs,
      lifetimeGeneratedPeakUsd: q.generatedPeakUsd,
      childrenBorn: q.childrenCount,
    };
    if (checkEligibility(candidate, fitnessById, nowMs).eligible) eligible.push(q);
  }
  eligible.sort((a, b) => (fitnessById.get(b.id) ?? 0) - (fitnessById.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1));
  return eligible;
}

/**
 * The champion: the top-producing living quant by fitness, excluding `excludeId` (the dying).
 * Receives death sweeps — the dead feed the champion. Null when nobody survives.
 */
export function pickChampion(
  quants: readonly QuantRecord[],
  fitnessRows: readonly FitnessRow[],
  excludeId: string,
): string | null {
  const fitnessById = new Map(fitnessRows.map((r) => [r.id, r.fitness]));
  let best: QuantRecord | null = null;
  let bestF = -Infinity;
  for (const q of living(quants)) {
    if (q.id === excludeId) continue;
    const f = fitnessById.get(q.id) ?? 0;
    if (f > bestF || (f === bestF && best && q.id < best.id)) {
      best = q;
      bestF = f;
    }
  }
  return best ? best.id : null;
}
