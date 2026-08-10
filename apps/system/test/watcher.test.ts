/**
 * Watcher (PROJECT.md §6): fitness table over the living population (§4.3), death triggers
 * (§4.5), reproduction eligibility (§4.4 — the five health rules plus the lifetime offspring
 * allowance on generated capital), and the champion pick for death sweeps. Each rule is pinned
 * at its exact boundary. Fixtures are hand-made QuantRecords; expected fitness numbers are
 * hand-computed from the §4.3 formula, not from core's helpers.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNAL_GENES, offspringAllowance, type FitnessRow, type Genome } from "@quants/core";
import {
  buildFitnessTable, evaluateBreeding, evaluateDeaths, pickChampion, type QuantRecord,
} from "../src/index.js";

const HOUR_MS = 3_600_000;
const NOW_MS = 1_767_605_400_000; // deterministic "now" for all cases

function makeGenome(id: string, name: string): Genome {
  return {
    meta: {
      id, name, ticker: name.slice(0, 6).toUpperCase(), generation: 1,
      parents: [], mutations: [], birthTx: null, genomeHash: null,
    },
    edge: {
      archetype: "momentum", universe: ["NVDA"], aggression: 0.5,
      patience: { minHoldMin: 30, maxHoldHrs: 48 }, fear: 0.05, conviction: 0.12,
      cadenceMin: 20, darkHours: 0.5, entryThesisStyle: "test",
      signal: { ...DEFAULT_SIGNAL_GENES },
      researchStyle: "priceAction", flowWeight: 0, flowSkepticism: 0.5,
    },
    econ: { holderRewardPct: 0.2 },
    voice: {
      archetype: "stoic", postsPerDay: 4, flexStyle: "receipts-only",
      beefiness: 0.1, lowercase: true, emojiPolicy: "none",
    },
  };
}

function makeQuant(name: string, over: Partial<QuantRecord> = {}): QuantRecord {
  const id = `q-${name}`;
  return {
    id, name, ticker: name.slice(0, 6).toUpperCase(),
    generation: 1, parents: [],
    genome: makeGenome(id, name), genomeHash: "0xdead",
    status: "alive",
    bornAtMs: NOW_MS - 100 * HOUR_MS, diedAtMs: null,
    causeOfDeath: null, finalWords: null,
    seedUsd: 100, processRunning: true, lastBroodAtMs: null,
    peakEquityUsd: 100, feeRatePerHourUsd: 1, dailyBurnUsd: 1,
    computeReserveUsd: 0, unclaimedFeesUsd: 0,
    walletAddr: `0xwallet-${id}`, tokenAddr: "0xtok", poolAddr: "0xpool", birthTx: "tx",
    claimedTotalUsd: 0, rewardPaidTotalUsd: 0, rewardOwedUsd: 0,
    // default allowance headroom (3 children at >$5k generated) so the health rules decide
    generatedPeakUsd: 6_000, childrenCount: 0,
    ...over,
  };
}

const equityMap = (pairs: ReadonlyArray<readonly [string, number]>): Map<string, number> =>
  new Map(pairs.map(([name, eq]) => [`q-${name}`, eq]));

describe("buildFitnessTable (§4.3)", () => {
  it("computes one row's fitness exactly per the formula: 0.7·(pct/(1+dd)) + 0.3·charisma", () => {
    const quants = [
      makeQuant("alpha", { seedUsd: 100, peakEquityUsd: 140, feeRatePerHourUsd: 1 }),
      makeQuant("beta", { seedUsd: 100, peakEquityUsd: 100, feeRatePerHourUsd: 0.5 }),
    ];
    const rows = buildFitnessTable(quants, equityMap([["alpha", 130], ["beta", 100]]));

    const alpha = rows.find((r) => r.id === "q-alpha")!;
    // pctReturn = (130 − 100)/100 = 0.3 ; drawdown = (140 − 130)/140 ; charisma = 72/72 = 1 (top earner)
    const dd = (140 - 130) / 140;
    const trading = 0.3 / (1 + dd);
    expect(alpha.tradingScore).toBeCloseTo(trading, 12);
    expect(alpha.charismaScore).toBe(1);
    expect(alpha.fitness).toBeCloseTo(0.7 * trading + 0.3 * 1, 12);

    const beta = rows.find((r) => r.id === "q-beta")!;
    // flat P&L, no drawdown, half the fee inflow of the leader
    expect(beta.tradingScore).toBe(0);
    expect(beta.charismaScore).toBeCloseTo(0.5, 12);
    expect(beta.fitness).toBeCloseTo(0.3 * 0.5, 12);
  });

  it("handles negative P&L: losing quants get a negative trading score", () => {
    const quants = [
      makeQuant("loser", { seedUsd: 100, peakEquityUsd: 110, feeRatePerHourUsd: 0 }),
      makeQuant("flat", { seedUsd: 100, peakEquityUsd: 100, feeRatePerHourUsd: 0 }),
    ];
    const rows = buildFitnessTable(quants, equityMap([["loser", 40], ["flat", 100]]));
    const loser = rows.find((r) => r.id === "q-loser")!;
    // pct = −0.6 ; dd = 70/110 ; trading = −0.6/(1 + 70/110)
    expect(loser.tradingScore).toBeCloseTo(-0.6 / (1 + 70 / 110), 12);
    expect(loser.fitness).toBeLessThan(0);
  });

  it("excludes the dead: they are not ranked and do not distort charisma normalization", () => {
    const quants = [
      makeQuant("alive1", { feeRatePerHourUsd: 0.5 }),
      makeQuant("alive2", { feeRatePerHourUsd: 0.25 }),
      makeQuant("ghost", { status: "dead", feeRatePerHourUsd: 100 }), // huge stale fee rate
    ];
    const rows = buildFitnessTable(quants, equityMap([["alive1", 100], ["alive2", 100]]));
    expect(rows.map((r) => r.id).sort()).toEqual(["q-alive1", "q-alive2"]);
    // normalization runs across the LIVING only: the living top earner scores 1, not 0.005
    expect(rows.find((r) => r.id === "q-alive1")!.charismaScore).toBe(1);
    expect(rows.find((r) => r.id === "q-alive2")!.charismaScore).toBeCloseTo(0.5, 12);
  });

  it("zero-fee population: everyone's charisma is 0, fitness is pure trading", () => {
    const quants = [
      makeQuant("a", { feeRatePerHourUsd: 0, peakEquityUsd: 120 }),
      makeQuant("b", { feeRatePerHourUsd: 0 }),
    ];
    const rows = buildFitnessTable(quants, equityMap([["a", 120], ["b", 100]]));
    for (const r of rows) expect(r.charismaScore).toBe(0);
    expect(rows.find((r) => r.id === "q-a")!.fitness).toBeCloseTo(0.7 * 0.2, 12);
  });

  it("missing equity falls back to seed (flat return), zero peak yields zero drawdown — no NaN", () => {
    const quants = [makeQuant("nofix", { peakEquityUsd: 0, feeRatePerHourUsd: 0 })];
    const rows = buildFitnessTable(quants, new Map());
    expect(rows[0]!.tradingScore).toBe(0);
    expect(Number.isFinite(rows[0]!.fitness)).toBe(true);
  });
});

describe("evaluateDeaths (§4.5)", () => {
  it("flags ruin at the exact boundary: equity ≤ 50% of seed dies, a cent above lives", () => {
    const quants = [
      makeQuant("ruined", { seedUsd: 100, dailyBurnUsd: 0.5 }),
      makeQuant("survivor", { seedUsd: 100, dailyBurnUsd: 0.5 }),
      makeQuant("healthy", { seedUsd: 100, dailyBurnUsd: 0.5 }),
    ];
    const verdicts = evaluateDeaths(quants, equityMap([
      ["ruined", 50], // exactly 0.5 × seed → dead
      ["survivor", 50.01], // just above → alive (and 50.01 ≥ 7 × 0.5 runway)
      ["healthy", 150],
    ]));
    expect(verdicts).toEqual([{ id: "q-ruined", cause: "ruin" }]);
  });

  it("flags starvation: equity + unclaimed fees below 7 days of burn dies; exactly 7 days lives", () => {
    const quants = [
      makeQuant("starving", { seedUsd: 100, unclaimedFeesUsd: 0, dailyBurnUsd: 8 }),
      makeQuant("scraping", { seedUsd: 100, unclaimedFeesUsd: 1, dailyBurnUsd: 8 }),
    ];
    const verdicts = evaluateDeaths(quants, equityMap([
      ["starving", 55], // 55 + 0 < 56 → dead (and 55 > the 50% ruin line)
      ["scraping", 55], // 55 + 1 = 56 → exactly 7 days of runway → alive
    ]));
    expect(verdicts).toEqual([{ id: "q-starving", cause: "starvation" }]);
  });

  it("ruin takes precedence when a quant is both ruined and starving", () => {
    const quants = [makeQuant("doomed", { seedUsd: 100, unclaimedFeesUsd: 0, dailyBurnUsd: 100 })];
    const verdicts = evaluateDeaths(quants, equityMap([["doomed", 30]]));
    expect(verdicts).toEqual([{ id: "q-doomed", cause: "ruin" }]);
  });

  it("never re-flags the already dead", () => {
    const quants = [makeQuant("ghost", { status: "dead", seedUsd: 100 })];
    expect(evaluateDeaths(quants, equityMap([["ghost", 0]]))).toEqual([]);
  });

  it("a quant with no equity entry is valued at seed — alive", () => {
    const quants = [makeQuant("fresh", { seedUsd: 100, dailyBurnUsd: 1 })];
    expect(evaluateDeaths(quants, new Map())).toEqual([]);
  });
});

describe("evaluateBreeding (§4.4 — the five health rules plus the lifetime allowance)", () => {
  /**
   * Base population: 8 living quants → top quartile = ceil(8 × 0.25) = 2 slots.
   *   bravo  (fitness 0.95): comfortable pass on every rule.
   *   alpha  (fitness 0.90): passes every rule AT its exact boundary —
   *          age exactly 72h, equity exactly 1.3×seed, cooldown exactly 72h ago,
   *          drawdown 0.35 (< 0.40). Allowance headroom: peak $6k → 3, none born.
   *   charlie (fitness 0.85): perfect §4.4 numbers but third by fitness → NOT top quartile.
   *   five fillers: low fitness, young.
   * Expected eligible: [bravo, alpha] — fitness-desc despite alpha coming first in the array.
   */
  function basePopulation(): { quants: QuantRecord[]; rows: FitnessRow[]; equity: Map<string, number> } {
    const alpha = makeQuant("alpha", {
      bornAtMs: NOW_MS - 72 * HOUR_MS, // age exactly 72h → passes (≥)
      seedUsd: 100,
      peakEquityUsd: 200, // equity 130 → drawdown (200−130)/200 = 0.35 < 0.40
      feeRatePerHourUsd: 0.1,
      dailyBurnUsd: 5.6,
      lastBroodAtMs: NOW_MS - 72 * HOUR_MS, // cooldown exactly elapsed → passes
    });
    const bravo = makeQuant("bravo", {
      bornAtMs: NOW_MS - 100 * HOUR_MS,
      seedUsd: 100, peakEquityUsd: 160,
      feeRatePerHourUsd: 1, dailyBurnUsd: 1, lastBroodAtMs: null,
    });
    const charlie = makeQuant("charlie", {
      bornAtMs: NOW_MS - 100 * HOUR_MS,
      seedUsd: 100, peakEquityUsd: 160,
      feeRatePerHourUsd: 1, dailyBurnUsd: 1, lastBroodAtMs: null,
    });
    const fillers = ["delta", "echo", "foxtrot", "golf", "hotel"].map((n) =>
      makeQuant(n, { bornAtMs: NOW_MS - 10 * HOUR_MS }),
    );
    const quants = [alpha, bravo, charlie, ...fillers];
    const fitness: Record<string, number> = {
      "q-alpha": 0.9, "q-bravo": 0.95, "q-charlie": 0.85,
      "q-delta": 0.4, "q-echo": 0.3, "q-foxtrot": 0.2, "q-golf": 0.15, "q-hotel": 0.1,
    };
    const rows: FitnessRow[] = quants.map((q) => ({
      id: q.id, tradingScore: 0, charismaScore: 0, fitness: fitness[q.id]!,
    }));
    const equity = equityMap([
      ["alpha", 130], // exactly 1.3 × seed → passes (≥, compared in cents)
      ["bravo", 160], ["charlie", 160],
      ["delta", 100], ["echo", 100], ["foxtrot", 100], ["golf", 100], ["hotel", 100],
    ]);
    return { quants, rows, equity };
  }

  const idsOf = (qs: readonly QuantRecord[]): string[] => qs.map((q) => q.id);

  it("base case: exactly two qualify, returned fitness-desc — boundary values all pass", () => {
    const { quants, rows, equity } = basePopulation();
    expect(idsOf(evaluateBreeding(quants, rows, equity, NOW_MS))).toEqual(["q-bravo", "q-alpha"]);
  });

  it("rule 1 (age ≥ 72h): one millisecond too young disqualifies", () => {
    const p = basePopulation();
    p.quants[0]!.bornAtMs = NOW_MS - 72 * HOUR_MS + 1;
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-bravo"]);
  });

  it("rule 2 (equity ≥ 1.3×seed): one cent short disqualifies", () => {
    const p = basePopulation();
    p.equity.set("q-alpha", 129.99);
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-bravo"]);
  });

  it("rule 3 (drawdown < 40%): exactly 40% disqualifies — the boundary is INELIGIBLE", () => {
    const p = basePopulation();
    // equity 132 (≥ 130, condition 2 still passes), peak 220 → drawdown = 88/220 = 0.40 exactly
    p.quants[0]!.peakEquityUsd = 220;
    p.equity.set("q-alpha", 132);
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-bravo"]);
  });

  it("the RETIRED fee gate stays retired: zero fee inflow under heavy burn no longer disqualifies", () => {
    const p = basePopulation();
    // pre-pivot this was condition 4 (fees ≥ burn over 72h) and DID disqualify; the current
    // rules dropped it — real creator-fee inflow is honestly ~zero until strangers trade the
    // tokens, so generated capital (not fee coverage) is the money bar.
    p.quants[0]!.feeRatePerHourUsd = 0;
    p.quants[0]!.dailyBurnUsd = 50;
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-bravo", "q-alpha"]);
  });

  it("rule 4 (top quartile): quartile membership both admits and excludes", () => {
    const p = basePopulation();
    // charlie overtakes alpha in fitness → quartile becomes {bravo, charlie}
    p.rows.find((r) => r.id === "q-alpha")!.fitness = 0.8;
    // alpha is now otherwise-perfect but outside the quartile; charlie is perfect AND inside
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-bravo", "q-charlie"]);
  });

  it("rule 5 (cooldown): a brood 71h59m ago disqualifies; exactly 72h ago does not", () => {
    const p = basePopulation();
    p.quants[0]!.lastBroodAtMs = NOW_MS - 72 * HOUR_MS + 60_000;
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-bravo"]);
  });

  it("rule 6 (lifetime allowance): a quant at its allowance is ineligible even when otherwise perfect", () => {
    const p = basePopulation();
    // peak $2,100 → allowance 2 (> $1k, > $2k); two children already born → spent
    p.quants[0]!.generatedPeakUsd = 2_100;
    p.quants[0]!.childrenCount = 2;
    expect(offspringAllowance(2_100)).toBe(2);
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-bravo"]);
  });

  it("rule 6 (lifetime allowance): zero generated capital means zero allowance — childless or not", () => {
    const p = basePopulation();
    p.quants[0]!.generatedPeakUsd = 0;
    p.quants[0]!.childrenCount = 0;
    expect(offspringAllowance(0)).toBe(0);
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-bravo"]);
  });

  it("rule 6 (lifetime allowance): milestones once earned are never revoked — one slot left still admits", () => {
    const p = basePopulation();
    // peak $2,100 → allowance 2; only one child born → one slot remains
    p.quants[0]!.generatedPeakUsd = 2_100;
    p.quants[0]!.childrenCount = 1;
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-bravo", "q-alpha"]);
  });

  it("the dead cannot breed, whatever their numbers say", () => {
    const p = basePopulation();
    p.quants[0]!.status = "dead";
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-bravo"]);
  });

  it("equal fitness ties break by id ascending (deterministic ordering)", () => {
    const p = basePopulation();
    p.rows.find((r) => r.id === "q-alpha")!.fitness = 0.95; // tie with bravo
    expect(idsOf(evaluateBreeding(p.quants, p.rows, p.equity, NOW_MS))).toEqual(["q-alpha", "q-bravo"]);
  });

  it("accepts rows straight from buildFitnessTable (shape integration)", () => {
    const { quants, equity } = basePopulation();
    const rows = buildFitnessTable(quants, equity);
    const eligible = evaluateBreeding(quants, rows, equity, NOW_MS);
    for (const q of eligible) expect(q.status).toBe("alive");
    // With REAL fitness, bravo and charlie tie at 0.7·0.6 + 0.3·1 = 0.72 (identical stats) and
    // take both quartile slots; alpha's boundary numbers compute to ≈0.19 and drop out.
    // The tie breaks by id ascending: bravo before charlie.
    const bravoRow = rows.find((r) => r.id === "q-bravo")!;
    const charlieRow = rows.find((r) => r.id === "q-charlie")!;
    expect(bravoRow.fitness).toBeCloseTo(0.72, 12);
    expect(charlieRow.fitness).toBeCloseTo(0.72, 12);
    expect(idsOf(eligible)).toEqual(["q-bravo", "q-charlie"]);
  });
});

describe("pickChampion (§4.5 — the dead feed the champion)", () => {
  const rowsOf = (fitness: Record<string, number>): FitnessRow[] =>
    Object.entries(fitness).map(([id, f]) => ({ id, tradingScore: 0, charismaScore: 0, fitness: f }));

  it("returns the top-fitness LIVING quant, excluding the dying one", () => {
    const quants = [
      makeQuant("alpha"), makeQuant("bravo"), makeQuant("charlie"),
    ];
    const rows = rowsOf({ "q-alpha": 0.5, "q-bravo": 0.9, "q-charlie": 0.7 });
    // bravo is dying → the sweep goes to charlie, the best of the rest
    expect(pickChampion(quants, rows, "q-bravo")).toBe("q-charlie");
    // charlie dying → bravo (the outright leader) receives it
    expect(pickChampion(quants, rows, "q-charlie")).toBe("q-bravo");
  });

  it("never crowns a dead quant, however fit its corpse's row looks", () => {
    const quants = [
      makeQuant("alive", { feeRatePerHourUsd: 0 }),
      makeQuant("ghost", { status: "dead" }),
    ];
    const rows = rowsOf({ "q-alive": 0.1, "q-ghost": 99 });
    expect(pickChampion(quants, rows, "q-nobody")).toBe("q-alive");
  });

  it("breaks fitness ties by id ascending (deterministic)", () => {
    const quants = [makeQuant("delta"), makeQuant("bravo"), makeQuant("alpha")];
    const rows = rowsOf({ "q-delta": 0.8, "q-bravo": 0.8, "q-alpha": 0.8 });
    expect(pickChampion(quants, rows, "q-dying")).toBe("q-alpha");
  });

  it("a quant with no fitness row counts as 0 — still champion when everything else is worse", () => {
    const quants = [makeQuant("norow"), makeQuant("neg")];
    const rows = rowsOf({ "q-neg": -0.5 });
    expect(pickChampion(quants, rows, "q-dying")).toBe("q-norow");
  });

  it("returns null when the only living quant is the dying one — the sweep falls to the operator treasury", () => {
    const quants = [
      makeQuant("doomed"),
      makeQuant("ghost", { status: "dead" }),
    ];
    const rows = rowsOf({ "q-doomed": 0.9 });
    expect(pickChampion(quants, rows, "q-doomed")).toBeNull();
  });
});
