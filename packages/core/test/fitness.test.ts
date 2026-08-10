/**
 * Fitness math (§4.3): F = 0.7*TradingScore + 0.3*CharismaScore.
 * TradingScore = pctReturnSinceBirth / (1 + maxDrawdown), clamped to [-1, 5].
 * CharismaScore = feeInflow72h / max(inflows) across living population; all-zero → all 0.
 */
import { describe, expect, it } from "vitest";
import {
  charismaScores,
  computeFitnessTable,
  fitness,
  tradingScore,
  type FitnessInput,
} from "../src/index.js";

function fin(id: string, feeInflowUsd12h: number, pctReturnSinceBirth = 0, maxDrawdown = 0): FitnessInput {
  return { id, pctReturnSinceBirth, maxDrawdown, feeInflowUsd12h };
}

describe("tradingScore", () => {
  it("computes the exact formula: ret 0.30, dd 0.20 → 0.25", () => {
    expect(tradingScore(0.3, 0.2)).toBeCloseTo(0.25, 12);
  });

  it("dd 0 divides by 1: ret 0.30 → 0.30", () => {
    expect(tradingScore(0.3, 0)).toBeCloseTo(0.3, 12);
  });

  it("negative return with drawdown: ret -0.3, dd 0.5 → -0.2", () => {
    expect(tradingScore(-0.3, 0.5)).toBeCloseTo(-0.2, 12);
  });

  it("clamps a huge return to 5", () => {
    expect(tradingScore(1000, 0)).toBe(5);
    expect(tradingScore(50, 0.1)).toBe(5);
  });

  it("floors a catastrophic score at -1", () => {
    expect(tradingScore(-10, 0)).toBe(-1);
    expect(tradingScore(-100, 0.2)).toBe(-1);
  });

  it("does not clamp at the exact clamp edges", () => {
    expect(tradingScore(5, 0)).toBe(5);
    expect(tradingScore(-1, 0)).toBe(-1);
  });

  it("treats negative drawdown as 0", () => {
    expect(tradingScore(0.3, -0.5)).toBeCloseTo(0.3, 12);
    expect(tradingScore(-0.3, -1)).toBeCloseTo(-0.3, 12);
  });
});

describe("charismaScores", () => {
  it("all-zero inflows → every score 0", () => {
    const scores = charismaScores([fin("a", 0), fin("b", 0), fin("c", 0)]);
    expect(scores.get("a")).toBe(0);
    expect(scores.get("b")).toBe(0);
    expect(scores.get("c")).toBe(0);
  });

  it("single member with positive inflow → 1", () => {
    expect(charismaScores([fin("solo", 42)]).get("solo")).toBe(1);
  });

  it("single member with zero inflow → 0", () => {
    expect(charismaScores([fin("solo", 0)]).get("solo")).toBe(0);
  });

  it("negative inflow is treated as 0 (scores 0, does not distort the max)", () => {
    const scores = charismaScores([fin("neg", -50), fin("pos", 100)]);
    expect(scores.get("neg")).toBe(0);
    expect(scores.get("pos")).toBe(1);
  });

  it("all-negative inflows → all 0 (no division by a negative max)", () => {
    const scores = charismaScores([fin("a", -5), fin("b", -2)]);
    expect(scores.get("a")).toBe(0);
    expect(scores.get("b")).toBe(0);
  });

  it("normalizes linearly against the population max", () => {
    const scores = charismaScores([fin("half", 30), fin("top", 60), fin("zero", 0)]);
    expect(scores.get("half")).toBeCloseTo(0.5, 12);
    expect(scores.get("top")).toBe(1);
    expect(scores.get("zero")).toBe(0);
  });

  it("empty population → empty map", () => {
    expect(charismaScores([]).size).toBe(0);
  });
});

describe("fitness (weighted blend)", () => {
  it("F = 0.7*0.25 + 0.3*0.5 = 0.325", () => {
    expect(fitness(0.25, 0.5)).toBeCloseTo(0.325, 12);
  });

  it("weights are 70/30: trading only → 0.7x, charisma only → 0.3x", () => {
    expect(fitness(1, 0)).toBeCloseTo(0.7, 12);
    expect(fitness(0, 1)).toBeCloseTo(0.3, 12);
  });

  it("carries negative trading scores through: F(-1, 0) = -0.7", () => {
    expect(fitness(-1, 0)).toBeCloseTo(-0.7, 12);
  });
});

describe("computeFitnessTable", () => {
  it("combines the pieces exactly for a two-quant population", () => {
    const rows = computeFitnessTable([
      { id: "A", pctReturnSinceBirth: 0.3, maxDrawdown: 0.2, feeInflowUsd12h: 60 },
      { id: "B", pctReturnSinceBirth: 0, maxDrawdown: 0, feeInflowUsd12h: 30 },
    ]);
    expect(rows).toHaveLength(2);
    const a = rows[0]!;
    const b = rows[1]!;
    expect(a.id).toBe("A");
    expect(a.tradingScore).toBeCloseTo(0.25, 12);
    expect(a.charismaScore).toBe(1);
    expect(a.fitness).toBeCloseTo(0.7 * 0.25 + 0.3 * 1, 12); // 0.475
    expect(b.id).toBe("B");
    expect(b.tradingScore).toBe(0);
    expect(b.charismaScore).toBeCloseTo(0.5, 12);
    expect(b.fitness).toBeCloseTo(0.15, 12);
  });

  it("preserves input order in the output rows", () => {
    const rows = computeFitnessTable([fin("z", 1), fin("a", 99), fin("m", 5)]);
    expect(rows.map((r) => r.id)).toEqual(["z", "a", "m"]);
  });

  it("clamps inside the table too (huge and catastrophic returns)", () => {
    const rows = computeFitnessTable([
      { id: "moon", pctReturnSinceBirth: 900, maxDrawdown: 0, feeInflowUsd12h: 0 },
      { id: "rekt", pctReturnSinceBirth: -900, maxDrawdown: 0.39, feeInflowUsd12h: 0 },
    ]);
    expect(rows[0]!.tradingScore).toBe(5);
    expect(rows[1]!.tradingScore).toBe(-1);
    expect(rows[0]!.fitness).toBeCloseTo(3.5, 12);
    expect(rows[1]!.fitness).toBeCloseTo(-0.7, 12);
  });

  it("empty population → empty table", () => {
    expect(computeFitnessTable([])).toEqual([]);
  });
});
