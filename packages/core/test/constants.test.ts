/**
 * Frozen guardrails, gene ranges, aggression→size mapping, rng determinism, wordlist hygiene.
 * These pin PROJECT.md §4.2 (guardrails are NOT genome and can never change at runtime).
 */
import { describe, expect, it } from "vitest";
import {
  aggressionToPositionPct,
  BREEDING,
  DEATH,
  FITNESS,
  GENE_RANGES,
  GENESIS_NAMES,
  GUARDRAILS,
  hashSeed,
  MONEY,
  MUTATION,
  mulberry32,
  OFFSPRING,
  offspringAllowance,
  pick,
  QUANT_WORDLIST,
  seededRng,
} from "../src/index.js";

describe("GUARDRAILS (frozen, §4.2)", () => {
  it("is deeply frozen", () => {
    expect(Object.isFrozen(GUARDRAILS)).toBe(true);
    expect(Object.isFrozen(GUARDRAILS.venueWhitelist)).toBe(true);
  });

  it("assignment to a guardrail throws in strict mode and leaves the value unchanged", () => {
    expect(() => {
      (GUARDRAILS as unknown as { slippageCapPct: number }).slippageCapPct = 0.99;
    }).toThrow(TypeError);
    expect(GUARDRAILS.slippageCapPct).toBe(0.015);
  });

  it("push onto the venue whitelist throws and leaves it unchanged", () => {
    const before = GUARDRAILS.venueWhitelist.length;
    expect(() => {
      (GUARDRAILS.venueWhitelist as unknown as string[]).push("DOGE");
    }).toThrow(TypeError);
    expect(GUARDRAILS.venueWhitelist.length).toBe(before);
  });

  it("pins the three system rules exactly (2026-08-02: the rest is per-agent genes)", () => {
    expect(GUARDRAILS.slippageCapPct).toBe(0.015);
    expect(GUARDRAILS.thinLiquiditySpreadBps).toBe(80);
    expect(GUARDRAILS.thinLiquiditySizeFactor).toBe(0.5);
    expect(GUARDRAILS.venueWhitelist.length).toBeGreaterThan(0);
    // the species-level risk caps are GONE — position size, open positions, and daily-loss
    // behavior are written in each genome now
    expect(GUARDRAILS).not.toHaveProperty("maxPositionPctEquity");
    expect(GUARDRAILS).not.toHaveProperty("maxOpenPositions");
    expect(GUARDRAILS).not.toHaveProperty("dailyLossHaltPct");
    expect(GUARDRAILS).not.toHaveProperty("dailyLossHaltHours");
  });

  it("all constant families are frozen (FITNESS, BREEDING, OFFSPRING, MUTATION, DEATH, MONEY, GENE_RANGES)", () => {
    for (const obj of [FITNESS, BREEDING, OFFSPRING, MUTATION, DEATH, MONEY, GENE_RANGES]) {
      expect(Object.isFrozen(obj)).toBe(true);
    }
    expect(Object.isFrozen(OFFSPRING.allowanceMilestonesUsd)).toBe(true);
    for (const range of Object.values(GENE_RANGES)) expect(Object.isFrozen(range)).toBe(true);
  });

  it("pins the locked evolutionary constants from PROJECT.md §4.3–§4.6", () => {
    expect(FITNESS.tradingWeight).toBe(0.7);
    expect(FITNESS.charismaWeight).toBe(0.3);
    expect(FITNESS.tradingScoreClamp).toEqual({ min: -1, max: 5 });
    expect(BREEDING.minAgeHours).toBe(72);
    expect(BREEDING.minEquityMultipleOfSeed).toBe(1.3);
    expect(BREEDING.maxDrawdownLimit).toBe(0.4);
    expect(BREEDING.topQuartileFraction).toBe(0.25);
    expect(BREEDING.cooldownHours).toBe(72);
    // the sexual-era knobs are GONE — the lineage model has no mate bias and no pool-tiered broods
    expect(BREEDING).not.toHaveProperty("inheritParentBias");
    expect(BREEDING).not.toHaveProperty("broodMin");
    expect(BREEDING).not.toHaveProperty("broodMax");
    expect(BREEDING).not.toHaveProperty("broodPoolThresholdsUsd");
    // the offspring governor (Charles directive 2026-08-02): lifetime allowance scales with
    // lifetime generated capital, one child per event — the brood/gen-cap/alive-cap model is GONE
    expect([...OFFSPRING.allowanceMilestonesUsd]).toEqual([1000, 2000, 5000, 10000, 20000]);
    expect(OFFSPRING.childrenPerEvent).toBe(1);
    expect(MUTATION.geneChance).toBe(0.15);
    expect(MUTATION.perturbFraction).toBe(0.2);
    expect(MUTATION.sportChance).toBe(0.03);
    expect(DEATH.ruinEquityFractionOfSeed).toBe(0.5);
    expect(DEATH.starvationRunwayDays).toBe(7);
    expect(MONEY.launchFeeEth).toBe(0.0005);
    // fee-claim allocation: 10% compute reserve, genome's econ.holderRewardPct to holders, rest discretion
    expect(MONEY.computeReserveSplit).toBe(0.1);
    // the funding cascade: bred children are endowed from their parent's own balance
    expect(MONEY.parentEndowmentPct).toBe(0.2);
    expect(MONEY.minChildTradingUsd).toBe(200);
    // the gene-pool-era money knobs are GONE — no pool tithe, no seed clamp band, no 80/10/10 split
    expect(MONEY).not.toHaveProperty("seedPctOfPool");
    expect(MONEY).not.toHaveProperty("seedFloorUsd");
    expect(MONEY).not.toHaveProperty("seedCeilingUsd");
    expect(MONEY).not.toHaveProperty("feeSplit");
  });

  it("GENE_RANGES covers exactly the twenty mutable numeric genes, econ.holderRewardPct appended last", () => {
    // Exact ORDER is spec: mutate() rolls genes in Object.keys order, so the original nine
    // must come first, the eight strategy-math genes strictly after, then the two flow research
    // genes, and the econ gene (added 2026-08-02) LAST — inserting it anywhere earlier would
    // silently reshuffle every seeded mutation tape. (Appending still shifts seeded streams by
    // the extra gate roll; that tape change is expected and accepted.)
    expect(Object.keys(GENE_RANGES)).toEqual([
      "edge.aggression",
      "edge.fear",
      "edge.conviction",
      "edge.cadenceMin",
      "edge.darkHours",
      "edge.patience.minHoldMin",
      "edge.patience.maxHoldHrs",
      "voice.postsPerDay",
      "voice.beefiness",
      "edge.signal.momentumLookback",
      "edge.signal.momentumEntryPct",
      "edge.signal.meanRevertWindow",
      "edge.signal.meanRevertEntryZ",
      "edge.signal.breakoutRange",
      "edge.signal.breakoutExpansion",
      "edge.signal.eventGapPct",
      "edge.signal.eventWindowMult",
      "edge.flowWeight",
      "edge.flowSkepticism",
      "econ.holderRewardPct",
    ]);
  });

  it("pins the eight strategy-math gene ranges exactly (integer flags included)", () => {
    expect(GENE_RANGES["edge.signal.momentumLookback"]).toEqual({ min: 2, max: 12, integer: true });
    expect(GENE_RANGES["edge.signal.momentumEntryPct"]).toEqual({ min: 0.005, max: 0.05 });
    expect(GENE_RANGES["edge.signal.meanRevertWindow"]).toEqual({ min: 5, max: 30, integer: true });
    expect(GENE_RANGES["edge.signal.meanRevertEntryZ"]).toEqual({ min: 0.5, max: 3 });
    expect(GENE_RANGES["edge.signal.breakoutRange"]).toEqual({ min: 6, max: 30, integer: true });
    expect(GENE_RANGES["edge.signal.breakoutExpansion"]).toEqual({ min: 1.05, max: 2.5 });
    expect(GENE_RANGES["edge.signal.eventGapPct"]).toEqual({ min: 0.003, max: 0.03 });
    expect(GENE_RANGES["edge.signal.eventWindowMult"]).toEqual({ min: 0.25, max: 3 });
  });

  it("pins the two flow research gene ranges exactly (unit-interval floats, no integer flag)", () => {
    expect(GENE_RANGES["edge.flowWeight"]).toEqual({ min: 0, max: 1 });
    expect(GENE_RANGES["edge.flowSkepticism"]).toEqual({ min: 0, max: 1 });
  });

  it("pins the econ gene range exactly (0..0.4, float, no integer flag)", () => {
    expect(GENE_RANGES["econ.holderRewardPct"]).toEqual({ min: 0, max: 0.4 });
  });
});

describe("offspringAllowance (lifetime generated-capital milestones, strictly-greater)", () => {
  it("boundary table: a peak AT a milestone does NOT count it; $20000.01+ caps at 5", () => {
    const table: ReadonlyArray<readonly [peak: number, allowance: number]> = [
      [0, 0],
      [999.99, 0],
      [1000, 0], // exactly at the milestone: strictly-greater comparison → not earned
      [1000.01, 1],
      [2000, 1],
      [2000.01, 2],
      [5000.01, 3],
      [10000.01, 4],
      [20000, 4],
      [20000.01, 5],
      [1e9, 5], // the milestone list is the only cap — there is no alive-cap anymore
    ];
    for (const [peak, allowance] of table) {
      expect(offspringAllowance(peak)).toBe(allowance);
    }
  });

  it("is monotonic non-decreasing in the peak (milestones once earned are never revoked)", () => {
    let prev = -1;
    for (let peak = 0; peak <= 21000; peak += 250) {
      const a = offspringAllowance(peak);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
});

describe("aggressionToPositionPct (linear 2%..100% — the agent's own cap, no species ceiling)", () => {
  it("maps 0 → 0.02 and 1 → 1 exactly", () => {
    expect(aggressionToPositionPct(0)).toBe(0.02);
    expect(aggressionToPositionPct(1)).toBe(1);
  });

  it("is linear in between: 0.5 → 0.51, 0.25 → 0.265", () => {
    expect(aggressionToPositionPct(0.5)).toBeCloseTo(0.51, 12);
    expect(aggressionToPositionPct(0.25)).toBeCloseTo(0.265, 12);
  });

  it("never leaves [0.02, 1] for any input, including out-of-range aggression", () => {
    for (const a of [-1, -0.001, 0, 0.1, 0.25, 0.5, 0.75, 0.999, 1, 1.001, 2, 100]) {
      const pct = aggressionToPositionPct(a);
      expect(pct).toBeGreaterThanOrEqual(0.02);
      expect(pct).toBeLessThanOrEqual(1);
    }
  });

  it("is monotonic non-decreasing on 0..1", () => {
    let prev = -Infinity;
    for (let a = 0; a <= 1.0001; a += 0.05) {
      const pct = aggressionToPositionPct(Math.min(a, 1));
      expect(pct).toBeGreaterThanOrEqual(prev);
      prev = pct;
    }
  });
});

describe("seeded rng (mulberry32) — the determinism substrate", () => {
  it("same seed → identical sequence", () => {
    const a = seededRng("determinism-check");
    const b = seededRng("determinism-check");
    for (let i = 0; i < 16; i++) expect(a()).toBe(b());
  });

  it("numeric and string seeds both reproduce; values stay in [0, 1)", () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("hashSeed is stable and discriminates strings", () => {
    expect(hashSeed("sim-evolution-1")).toBe(hashSeed("sim-evolution-1"));
    expect(hashSeed("sim-evolution-1")).not.toBe(hashSeed("sim-evolution-2"));
  });

  it("pick is deterministic under a seed and throws on an empty array", () => {
    expect(pick(seededRng(7), ["a", "b", "c", "d"])).toBe(pick(seededRng(7), ["a", "b", "c", "d"]));
    expect(() => pick(seededRng(7), [])).toThrow();
  });
});

describe("wordlist hygiene (supports collision-checked child naming)", () => {
  it("GENESIS_NAMES: eve (the gen-0 progenitor) joined the eight retired genesis names — 9 reserved", () => {
    expect(GENESIS_NAMES).toHaveLength(9);
    expect(GENESIS_NAMES).toContain("eve");
  });

  it("never contains a genesis name (case-insensitive)", () => {
    const genesis = new Set(GENESIS_NAMES.map((n) => n.toLowerCase()));
    for (const w of QUANT_WORDLIST) expect(genesis.has(w.toLowerCase())).toBe(false);
  });

  it("is non-empty, all-lowercase, and unique case-insensitively", () => {
    expect(QUANT_WORDLIST.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const w of QUANT_WORDLIST) {
      expect(w).toBe(w.toLowerCase());
      expect(seen.has(w.toLowerCase())).toBe(false);
      seen.add(w.toLowerCase());
    }
  });
});
