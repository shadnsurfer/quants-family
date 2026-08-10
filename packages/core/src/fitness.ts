/**
 * Fitness math (PROJECT.md §4.3):
 *   F = 0.7 * TradingScore + 0.3 * CharismaScore
 *   TradingScore  = pctReturnSinceBirth / (1 + maxDrawdown), clamped to FITNESS.tradingScoreClamp
 *   CharismaScore = feeInflowUsd12h normalized 0..1 across the living population
 *                   (x / max over living; all zeros → all 0)
 */
import { FITNESS } from "./constants.js";
import type { FitnessInput, FitnessRow } from "./types.js";

/** Clamped trading score for one quant. maxDrawdown must be ≥ 0. */
export function tradingScore(pctReturnSinceBirth: number, maxDrawdown: number): number {
  const drawdown = maxDrawdown < 0 ? 0 : maxDrawdown;
  const raw = pctReturnSinceBirth / (1 + drawdown);
  const { min, max } = FITNESS.tradingScoreClamp;
  return Math.min(max, Math.max(min, raw));
}

/**
 * Normalize fee inflow to 0..1 across the living population: x / max(inflows).
 * If every inflow is 0 (or the population is empty), every score is 0.
 * Negative inflows are treated as 0 before normalizing.
 */
export function charismaScores(inputs: readonly FitnessInput[]): Map<string, number> {
  let maxInflow = 0;
  for (const input of inputs) {
    const inflow = Math.max(0, input.feeInflowUsd12h);
    if (inflow > maxInflow) maxInflow = inflow;
  }
  const scores = new Map<string, number>();
  for (const input of inputs) {
    const inflow = Math.max(0, input.feeInflowUsd12h);
    scores.set(input.id, maxInflow > 0 ? inflow / maxInflow : 0);
  }
  return scores;
}

/** Weighted blend of the two scores (weights from FITNESS constants). */
export function fitness(trading: number, charisma: number): number {
  return FITNESS.tradingWeight * trading + FITNESS.charismaWeight * charisma;
}

/** Full fitness table for the living population, one row per input, input order preserved. */
export function computeFitnessTable(inputs: readonly FitnessInput[]): FitnessRow[] {
  const charismaById = charismaScores(inputs);
  return inputs.map((input) => {
    const trading = tradingScore(input.pctReturnSinceBirth, input.maxDrawdown);
    const charisma = charismaById.get(input.id) ?? 0;
    return {
      id: input.id,
      tradingScore: trading,
      charismaScore: charisma,
      fitness: fitness(trading, charisma),
    };
  });
}
