/**
 * Breeding (§4.4, offspring-allowance amendment 2026-08-02): quartile ranking, the SIX spawn
 * gates (age, growth, drawdown, quartile, cooldown, and the lifetime offspring allowance —
 * the fee-covers-burn gate and the genCapacity/alive-cap attention rails are retired), asexual
 * spawnGenome cloning, mutation (gated, clamped, logged) across the 20 GENE_RANGES genes plus
 * three sport gates, the selfGeneOrigins birth report, and collision-checked child naming.
 *
 * Note on seeded streams: the appended "econ.holderRewardPct" gene adds one gate roll (plus a
 * delta roll when it fires) before the sport gates, so every seeded mutation tape from the
 * 19-gene era shifted — an expected, accepted tape change. Nothing here pins an absolute tape:
 * scripted rngs build their queues from the live GENE_RANGES key order, and the seeded scans
 * assert statistical/relative contracts only.
 *
 * Everything here runs on explicit rngs: constant rngs to pin branch semantics independent of
 * gene-enumeration order, scripted rngs to pin the documented roll order exactly, and
 * seededRng scans (deterministic) where the contract only promises statistical behavior.
 */
import { describe, expect, it } from "vitest";
import {
  BREEDING,
  checkEligibility,
  childName,
  DEFAULT_SIGNAL_GENES,
  EDGE_ARCHETYPES,
  GENE_RANGES,
  GENESIS_NAMES,
  INHERIT_UNITS,
  MUTATION,
  mutate,
  offspringAllowance,
  parseGenome,
  QUANT_WORDLIST,
  RESEARCH_STYLES,
  seededRng,
  selfGeneOrigins,
  spawnGenome,
  topQuartileIds,
  VOICE_ARCHETYPES,
  type BreedingCandidate,
  type EligibilityFailure,
  type Genome,
  type Rng,
} from "../src/index.js";

// ---------- helpers (all deterministic) ----------

function constRng(v: number): Rng {
  return () => v;
}

/** Rng fed from a fixed queue; throws if the implementation draws more than scripted. */
function scriptedRng(values: readonly number[]): { rng: Rng; calls: () => number } {
  let i = 0;
  const rng: Rng = () => {
    if (i >= values.length) throw new Error(`scripted rng exhausted after ${values.length} draws`);
    return values[i++]!;
  };
  return { rng, calls: () => i };
}

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], obj);
}

function kellyLike(): Genome {
  return {
    meta: {
      id: "g1-kelly",
      name: "kelly",
      ticker: "KELLY",
      generation: 1,
      parents: [],
      mutations: [],
      birthTx: null,
      genomeHash: null,
    },
    edge: {
      archetype: "momentum",
      universe: ["NVDA", "TSLA", "HOOD"],
      aggression: 0.85,
      patience: { minHoldMin: 30, maxHoldHrs: 48 },
      fear: 0.05,
      conviction: 0.12,
      cadenceMin: 20,
      darkHours: 0.5,
      entryThesisStyle: "strict-confluence",
      signal: { ...DEFAULT_SIGNAL_GENES },
      researchStyle: "priceAction", // the research defaults
      flowWeight: 0,
      flowSkepticism: 0.5,
    },
    econ: { holderRewardPct: 0.2 }, // the schema default, pinned explicitly
    voice: {
      archetype: "cocky",
      postsPerDay: 6,
      flexStyle: "receipts-only",
      beefiness: 0.3,
      lowercase: true,
      emojiPolicy: "none",
    },
  };
}

/** A second, fully different genome — clone tests prove spawning carries THESE genes, not a fixture default. */
function sharpeLike(): Genome {
  return {
    meta: {
      id: "g1-sharpe",
      name: "sharpe",
      ticker: "SHARPE",
      generation: 1,
      parents: [],
      mutations: [],
      birthTx: null,
      genomeHash: null,
    },
    edge: {
      archetype: "meanRevert",
      universe: ["AAPL", "MSFT"],
      aggression: 0.2,
      patience: { minHoldMin: 120, maxHoldHrs: 96 },
      fear: 0.1,
      conviction: 0.3,
      cadenceMin: 60,
      darkHours: 0.9,
      entryThesisStyle: "loose-vibes",
      signal: {
        momentumLookback: 7, // vs kelly's 3
        momentumEntryPct: 0.03, // vs 0.015
        meanRevertWindow: 20, // vs 10
        meanRevertEntryZ: 2.5, // vs 1.5
        breakoutRange: 24, // vs 12
        breakoutExpansion: 2, // vs 1.3
        eventGapPct: 0.02, // vs 0.008
        eventWindowMult: 2, // vs 1
      },
      researchStyle: "flow", // vs kelly's "priceAction"
      flowWeight: 0.8, // vs 0
      flowSkepticism: 0.2, // vs 0.5
    },
    econ: { holderRewardPct: 0.35 }, // vs kelly's 0.2
    voice: {
      archetype: "stoic",
      postsPerDay: 12,
      flexStyle: "silent-grind",
      beefiness: 0.7,
      lowercase: false,
      emojiPolicy: "rare",
    },
  };
}

const CHILD = { name: "ito", ticker: "ITO", id: "g2-ito" };

// ---------- topQuartileIds ----------

describe("topQuartileIds", () => {
  it("n=8 with distinct fitness → exactly ceil(8*0.25)=2 members, the top two", () => {
    // Insertion order deliberately shuffled: rank must come from fitness, not insertion.
    const m = new Map<string, number>([
      ["q5", 4],
      ["q1", 8],
      ["q7", 2],
      ["q2", 7],
      ["q8", 1],
      ["q3", 6],
      ["q6", 3],
      ["q4", 5],
    ]);
    expect(topQuartileIds(m)).toEqual(new Set(["q1", "q2"]));
  });

  it("ties are broken by id ASC", () => {
    // Quartile size ceil(8*0.25)=2: top is m(9); b and a tie at 5 → a wins by id ASC.
    const m = new Map<string, number>([
      ["b", 5],
      ["m", 9],
      ["a", 5],
      ["x1", 1],
      ["x2", 1],
      ["x3", 1],
      ["x4", 1],
      ["x5", 1],
    ]);
    const q = topQuartileIds(m);
    expect(q).toEqual(new Set(["m", "a"]));
    expect(q.has("b")).toBe(false);
  });

  it("n=1 → that quant is in the quartile", () => {
    expect(topQuartileIds(new Map([["solo", -3]]))).toEqual(new Set(["solo"]));
  });

  it("the floor rules small arenas: n=3 → 2 slots, n=4 → 2 slots; n=5 → ceil(1.25)=2 still", () => {
    // Charles 2026-08-03: never fewer than topQuartileMinSlots — a 1-slot arena lets the
    // champion monopolize reproduction.
    const three = new Map<string, number>([
      ["a", 3],
      ["b", 2],
      ["c", 1],
    ]);
    expect(topQuartileIds(three)).toEqual(new Set(["a", "b"]));

    const four = new Map<string, number>([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
    ]);
    expect(topQuartileIds(four)).toEqual(new Set(["a", "b"]));

    const five = new Map<string, number>([
      ["a", 5],
      ["b", 4],
      ["c", 3],
      ["d", 2],
      ["e", 1],
    ]);
    expect(topQuartileIds(five)).toEqual(new Set(["a", "b"]));
  });

  it("the fraction takes over past the floor: n=12 → ceil(3)=3 members", () => {
    const m = new Map<string, number>();
    for (let i = 1; i <= 12; i++) m.set(`q${i}`, 13 - i); // q1 fittest … q12 least
    expect(topQuartileIds(m)).toEqual(new Set(["q1", "q2", "q3"]));
  });

  it("empty population → empty set", () => {
    expect(topQuartileIds(new Map())).toEqual(new Set());
  });
});

// ---------- checkEligibility ----------

const NOW = 1_753_000_000_000;
const HOUR_MS = 3_600_000;

/** Passes every gate: old enough, 2× seed, shallow drawdown, never brooded, allowance headroom. */
function candidate(overrides: Partial<BreedingCandidate> = {}): BreedingCandidate {
  return {
    id: "cand",
    ageHours: 100,
    equityUsd: 200,
    seedUsd: 100,
    maxDrawdown: 0.1,
    lastBroodAtMs: null,
    // peak 1200 clears exactly the $1000 milestone → allowance 1, and no children yet
    lifetimeGeneratedPeakUsd: 1200,
    childrenBorn: 0,
    ...overrides,
  };
}

/** n=4, candidate on top → quartile is {cand, a} under the floor (min 2 slots). */
const FIT_TOP = new Map<string, number>([
  ["cand", 10],
  ["a", 5],
  ["b", 4],
  ["c", 3],
]);

/** n=8, candidate ranked 3rd → quartile is {q1, q2}, candidate excluded. */
const FIT_THIRD_OF_EIGHT = new Map<string, number>([
  ["q1", 9],
  ["q2", 8],
  ["cand", 7],
  ["q4", 6],
  ["q5", 5],
  ["q6", 4],
  ["q7", 3],
  ["q8", 2],
]);

describe("checkEligibility (§4.4 offspring-allowance amendment — the six gates: age, growth, drawdown, quartile, cooldown, allowance)", () => {
  it("a candidate passing everything is eligible with zero failure codes", () => {
    const res = checkEligibility(candidate(), FIT_TOP, NOW);
    expect(res.id).toBe("cand");
    expect(res.eligible).toBe(true);
    expect(res.failed).toEqual([]);
  });

  it("age 71.999h fails with exactly [too-young]", () => {
    const res = checkEligibility(candidate({ ageHours: 71.999 }), FIT_TOP, NOW);
    expect(res.eligible).toBe(false);
    expect(res.failed).toEqual(["too-young"]);
  });

  it("age exactly 72h passes", () => {
    const res = checkEligibility(candidate({ ageHours: 72 }), FIT_TOP, NOW);
    expect(res.eligible).toBe(true);
    expect(res.failed).toEqual([]);
  });

  it("equity 1.2999× seed fails with exactly [equity-below-1.3x-seed]", () => {
    const res = checkEligibility(candidate({ equityUsd: 129.99, seedUsd: 100 }), FIT_TOP, NOW);
    expect(res.eligible).toBe(false);
    expect(res.failed).toEqual(["equity-below-1.3x-seed"]);
  });

  it("equity exactly 1.3× seed passes", () => {
    const seed = 100;
    const res = checkEligibility(
      candidate({ equityUsd: BREEDING.minEquityMultipleOfSeed * seed, seedUsd: seed }),
      FIT_TOP,
      NOW,
    );
    expect(res.eligible).toBe(true);
    expect(res.failed).toEqual([]);
  });

  it("drawdown exactly 0.40 FAILS (strict <) with exactly [drawdown-too-deep]", () => {
    const res = checkEligibility(candidate({ maxDrawdown: 0.4 }), FIT_TOP, NOW);
    expect(res.eligible).toBe(false);
    expect(res.failed).toEqual(["drawdown-too-deep"]);
  });

  it("drawdown 0.3999 passes", () => {
    const res = checkEligibility(candidate({ maxDrawdown: 0.3999 }), FIT_TOP, NOW);
    expect(res.eligible).toBe(true);
    expect(res.failed).toEqual([]);
  });

  it("the retired fee gate stays retired: BreedingCandidate has exactly the eight allowance-era fields (compile-level)", () => {
    // Exhaustive key map: this literal fails to TYPECHECK if BreedingCandidate gains a field
    // (a missing key here) or loses one (an excess key here) — resurrecting the sexual-era
    // feeInflowUsd72h / computeBurnUsd72h pair would break the build, not just a test run.
    const shape: Record<keyof BreedingCandidate, true> = {
      id: true,
      ageHours: true,
      equityUsd: true,
      seedUsd: true,
      maxDrawdown: true,
      lastBroodAtMs: true,
      lifetimeGeneratedPeakUsd: true,
      childrenBorn: true,
    };
    expect(Object.keys(shape).sort()).toEqual(
      [
        "ageHours",
        "childrenBorn",
        "equityUsd",
        "id",
        "lastBroodAtMs",
        "lifetimeGeneratedPeakUsd",
        "maxDrawdown",
        "seedUsd",
      ],
    );
    // and a candidate built WITHOUT any fee/burn knowledge fully gates — zero-revenue quants
    // (the honest launch-day reality) can spawn on growth alone, once they have allowance
    expect(checkEligibility(candidate(), FIT_TOP, NOW).eligible).toBe(true);
  });

  it("rank 3 of 8 is outside the quartile: exactly [not-top-quartile]", () => {
    const res = checkEligibility(candidate(), FIT_THIRD_OF_EIGHT, NOW);
    expect(res.eligible).toBe(false);
    expect(res.failed).toEqual(["not-top-quartile"]);
  });

  it("rank 2 of 8 is inside the quartile (ceil(8*0.25)=2)", () => {
    const m = new Map(FIT_THIRD_OF_EIGHT);
    m.set("cand", 8.5); // now second-best
    const res = checkEligibility(candidate(), m, NOW);
    expect(res.eligible).toBe(true);
  });

  it("cooldown of exactly 72h in ms passes", () => {
    const res = checkEligibility(
      candidate({ lastBroodAtMs: NOW - BREEDING.cooldownHours * HOUR_MS }),
      FIT_TOP,
      NOW,
    );
    expect(res.eligible).toBe(true);
    expect(res.failed).toEqual([]);
  });

  it("1ms under the cooldown fails with exactly [cooldown]", () => {
    const res = checkEligibility(
      candidate({ lastBroodAtMs: NOW - (BREEDING.cooldownHours * HOUR_MS - 1) }),
      FIT_TOP,
      NOW,
    );
    expect(res.eligible).toBe(false);
    expect(res.failed).toEqual(["cooldown"]);
  });

  it("childrenBorn == allowance fails with exactly [allowance-exhausted] (boundary)", () => {
    // peak 1200 → offspringAllowance(1200) = 1; one child already born → the allowance is spent
    expect(offspringAllowance(1200)).toBe(1);
    const res = checkEligibility(candidate({ childrenBorn: 1 }), FIT_TOP, NOW);
    expect(res.eligible).toBe(false);
    expect(res.failed).toEqual(["allowance-exhausted"]);
  });

  it("one below the allowance passes; a zero-peak quant (allowance 0) cannot spawn at all", () => {
    // one below: 0 children against an allowance of 1 → headroom
    expect(checkEligibility(candidate({ childrenBorn: 0 }), FIT_TOP, NOW).eligible).toBe(true);
    // 0 peak / 0 children: no milestone cleared → allowance 0 → exhausted from birth
    const res = checkEligibility(
      candidate({ lifetimeGeneratedPeakUsd: 0, childrenBorn: 0 }),
      FIT_TOP,
      NOW,
    );
    expect(res.eligible).toBe(false);
    expect(res.failed).toEqual(["allowance-exhausted"]);
  });

  it("allowance boundary at the top milestone: allowance 5 at peak 20000.01 — 4 children pass, 5 fail", () => {
    expect(offspringAllowance(20000.01)).toBe(5);
    const rich = { lifetimeGeneratedPeakUsd: 20000.01 };
    expect(
      checkEligibility(candidate({ ...rich, childrenBorn: 4 }), FIT_TOP, NOW).eligible,
    ).toBe(true);
    const spent = checkEligibility(candidate({ ...rich, childrenBorn: 5 }), FIT_TOP, NOW);
    expect(spent.eligible).toBe(false);
    expect(spent.failed).toEqual(["allowance-exhausted"]);
  });

  it("a peak AT a milestone does not raise the allowance: peak exactly 1000 → allowance 0", () => {
    const res = checkEligibility(
      candidate({ lifetimeGeneratedPeakUsd: 1000, childrenBorn: 0 }),
      FIT_TOP,
      NOW,
    );
    expect(res.eligible).toBe(false);
    expect(res.failed).toEqual(["allowance-exhausted"]);
  });

  it("multiple simultaneous failures return EVERY failed code — all six gates at once", () => {
    const res = checkEligibility(
      candidate({
        ageHours: 10, // too-young
        equityUsd: 100, // < 1.3 × 100
        seedUsd: 100,
        maxDrawdown: 0.5, // too deep
        lastBroodAtMs: NOW - 1000, // cooling down
        lifetimeGeneratedPeakUsd: 0, // allowance 0, so 0 children already exhausts it
        childrenBorn: 0,
      }),
      FIT_THIRD_OF_EIGHT, // not top quartile
      NOW,
    );
    const all: EligibilityFailure[] = [
      "too-young",
      "equity-below-1.3x-seed",
      "drawdown-too-deep",
      "not-top-quartile",
      "cooldown",
      "allowance-exhausted",
    ];
    expect(res.eligible).toBe(false);
    expect([...res.failed].sort()).toEqual([...all].sort());
  });
});

// ---------- spawnGenome ----------

describe("spawnGenome (asexual clone — the child IS the parent, with fresh meta and no rng)", () => {
  it("INHERIT_UNITS is the documented 28-unit registry the origins report walks, in this order", () => {
    expect([...INHERIT_UNITS]).toEqual([
      "edge.archetype",
      "edge.universe",
      "edge.aggression",
      "edge.patience.minHoldMin",
      "edge.patience.maxHoldHrs",
      "edge.fear",
      "edge.conviction",
      "edge.cadenceMin",
      "edge.darkHours",
      "edge.entryThesisStyle",
      "edge.signal.momentumLookback",
      "edge.signal.momentumEntryPct",
      "edge.signal.meanRevertWindow",
      "edge.signal.meanRevertEntryZ",
      "edge.signal.breakoutRange",
      "edge.signal.breakoutExpansion",
      "edge.signal.eventGapPct",
      "edge.signal.eventWindowMult",
      "edge.researchStyle",
      "edge.flowWeight",
      "edge.flowSkepticism",
      "econ.holderRewardPct",
      "voice.archetype",
      "voice.postsPerDay",
      "voice.flexStyle",
      "voice.beefiness",
      "voice.lowercase",
      "voice.emojiPolicy",
    ]);
    // every mutable numeric gene must also be heritable — GENE_RANGES ⊆ INHERIT_UNITS
    for (const path of Object.keys(GENE_RANGES)) {
      expect(INHERIT_UNITS).toContain(path);
    }
  });

  it("every heritable gene is the parent's, verbatim — for BOTH fixture genomes", () => {
    const fromKelly = spawnGenome(kellyLike(), CHILD);
    expect(fromKelly.edge).toEqual(kellyLike().edge);
    expect(fromKelly.econ).toEqual(kellyLike().econ);
    expect(fromKelly.voice).toEqual(kellyLike().voice);

    const fromSharpe = spawnGenome(sharpeLike(), CHILD);
    expect(fromSharpe.edge).toEqual(sharpeLike().edge);
    expect(fromSharpe.econ).toEqual(sharpeLike().econ);
    expect(fromSharpe.voice).toEqual(sharpeLike().voice);
  });

  it("child meta: supplied identity, generation = parent + 1, parents = [parent.id], clean birth fields", () => {
    const child = spawnGenome(kellyLike(), CHILD); // kelly is gen 1
    expect(child.meta.id).toBe("g2-ito");
    expect(child.meta.name).toBe("ito");
    expect(child.meta.ticker).toBe("ITO");
    expect(child.meta.generation).toBe(2);
    expect(child.meta.parents).toEqual(["g1-kelly"]); // ONE parent — there is no mate
    expect(child.meta.mutations).toEqual([]);
    expect(child.meta.birthTx).toBeNull();
    expect(child.meta.genomeHash).toBeNull();
  });

  it("generation walks the lineage: a gen-0 progenitor births gen 1; a gen-5 parent births gen 6", () => {
    const progenitor = kellyLike();
    progenitor.meta.generation = 0;
    expect(spawnGenome(progenitor, CHILD).meta.generation).toBe(1);

    const elder = sharpeLike();
    elder.meta.generation = 5;
    const child = spawnGenome(elder, CHILD);
    expect(child.meta.generation).toBe(6);
    expect(child.meta.parents).toEqual(["g1-sharpe"]);
  });

  it("the parent's OWN history is not heritable: mutation log, birthTx, genomeHash all reset", () => {
    const parent = kellyLike();
    parent.meta.mutations = ["edge.fear: 0.04→0.05", "SPORT: voice.archetype: stoic→cocky"];
    parent.meta.birthTx = "0xparent-birth";
    parent.meta.genomeHash = "0xparent-hash";
    const child = spawnGenome(parent, CHILD);
    expect(child.meta.mutations).toEqual([]);
    expect(child.meta.birthTx).toBeNull();
    expect(child.meta.genomeHash).toBeNull();
  });

  it("deep-copies: writing into the child's universe/patience/signal/voice never touches the parent", () => {
    const parent = kellyLike();
    const child = spawnGenome(parent, CHILD);
    expect(child.edge.universe).toEqual(parent.edge.universe);
    expect(child.edge.universe).not.toBe(parent.edge.universe); // fresh array, not a shared ref

    child.edge.universe.push("ZZZZ");
    child.edge.patience.minHoldMin = 700;
    child.edge.signal.momentumLookback = 12;
    child.voice.postsPerDay = 24;

    expect(parent.edge.universe).toEqual(["NVDA", "TSLA", "HOOD"]);
    expect(parent.edge.patience.minHoldMin).toBe(30);
    expect(parent.edge.signal.momentumLookback).toBe(3);
    expect(parent.voice.postsPerDay).toBe(6);
  });

  it("never writes to the parent (deep-frozen parent does not throw) and the child parses", () => {
    const parent = deepFreeze(kellyLike());
    const child = spawnGenome(parent, CHILD);
    expect(() => parseGenome(child)).not.toThrow();
    expect(child.meta.parents).toEqual(["g1-kelly"]);
  });

  it("consumes NO randomness: two-arg signature, repeated calls byte-identical", () => {
    // the sexual-era inherit() burned 27 rng draws per child; the clone burns none —
    // ALL diversity now comes from mutate(), which the breeder runs right after
    expect(spawnGenome.length).toBe(2);
    const one = spawnGenome(kellyLike(), CHILD);
    const two = spawnGenome(kellyLike(), CHILD);
    expect(one).toEqual(two);
  });
});

// ---------- mutate ----------

const NUM_GENES = Object.keys(GENE_RANGES).length;

/**
 * Queue that fires exactly one numeric gene's gate (per the documented roll order:
 * GENE_RANGES key order, gate roll then delta roll only when fired, then the three
 * sport gates).
 */
function singleMutationQueue(path: string, deltaRoll: number): number[] {
  const keys = Object.keys(GENE_RANGES);
  const idx = keys.indexOf(path);
  if (idx < 0) throw new Error(`not a numeric gene path: ${path}`);
  const q: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (i === idx) q.push(0.001, deltaRoll);
    else q.push(0.9);
  }
  q.push(0.9, 0.9, 0.9); // edge.archetype, voice.archetype, edge.researchStyle gates — no sport
  return q;
}

const NO_MUTATION_RNG = () => 0.9; // above geneChance (0.15) and sportChance (0.03)

describe("mutate (§4.4 — gated perturbation, clamped, logged, pure)", () => {
  it("no gate fires → identical genome, empty log", () => {
    const g = kellyLike();
    const out = mutate(g, NO_MUTATION_RNG);
    expect(out.log).toEqual([]);
    expect(out.genome).toEqual(kellyLike());
  });

  it("a single fired gate perturbs exactly that gene, logs one 'path: old→new' line, and appends it to meta.mutations", () => {
    const g = kellyLike();
    g.meta.mutations = ["genesis-note"];
    const queue = singleMutationQueue("edge.aggression", 0.75);
    const s = scriptedRng(queue);
    const out = mutate(g, s.rng);

    // consumed exactly: one gate per numeric gene + one delta + three sport gates
    expect(s.calls()).toBe(NUM_GENES + 1 + 3);

    // value changed, stayed in range
    const v = out.genome.edge.aggression;
    expect(v).not.toBe(0.85);
    expect(v).toBeGreaterThanOrEqual(GENE_RANGES["edge.aggression"]!.min);
    expect(v).toBeLessThanOrEqual(GENE_RANGES["edge.aggression"]!.max);

    // exactly one log line, documented format, numerically consistent
    expect(out.log).toHaveLength(1);
    const m = out.log[0]!.match(/^edge\.aggression: (.+)→(.+)$/);
    expect(m).not.toBeNull();
    expect(Number.parseFloat(m![1]!)).toBeCloseTo(0.85, 6);
    expect(Number.parseFloat(m![2]!)).toBeCloseTo(v, 6);

    // mutation log appended to inherited history, not replacing it
    expect(out.genome.meta.mutations).toEqual(["genesis-note", ...out.log]);

    // every other gene untouched
    for (const path of Object.keys(GENE_RANGES)) {
      if (path === "edge.aggression") continue;
      expect(getPath(out.genome, path)).toBe(getPath(kellyLike(), path));
    }
    expect(out.genome.edge.archetype).toBe("momentum");
    expect(out.genome.voice.archetype).toBe("cocky");
    expect(out.genome.edge.researchStyle).toBe("priceAction");
  });

  it("integer genes stay integers when mutated (voice.postsPerDay)", () => {
    const g = kellyLike();
    const s = scriptedRng(singleMutationQueue("voice.postsPerDay", 0.99));
    const out = mutate(g, s.rng);
    const v = out.genome.voice.postsPerDay;
    expect(Number.isInteger(v)).toBe(true);
    expect(v).not.toBe(6);
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(24);
  });

  it("a perturbation that would exceed the range clamps to the max (aggression 0.95, extreme deltas)", () => {
    const results: number[] = [];
    for (const deltaRoll of [0.999999, 0.000001]) {
      const g = kellyLike();
      g.edge.aggression = 0.95;
      const s = scriptedRng(singleMutationQueue("edge.aggression", deltaRoll));
      const out = mutate(g, s.rng);
      results.push(out.genome.edge.aggression);
    }
    // One extreme pushes ~+19% → 1.14 → must clamp to exactly 1; the other lands ~0.76.
    for (const v of results) {
      expect(v).toBeGreaterThanOrEqual(0.05);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...results)).toBe(1);
    expect(Math.min(...results)).toBeLessThan(0.95);
  });

  it("integer gene at its ceiling: up-perturbation min-steps DOWN to 239 (only legal move), down-perturbation rounds to 192", () => {
    const results: number[] = [];
    for (const deltaRoll of [0.999999, 0.000001]) {
      const g = kellyLike();
      g.edge.cadenceMin = 240;
      const s = scriptedRng(singleMutationQueue("edge.cadenceMin", deltaRoll));
      const out = mutate(g, s.rng);
      expect(Number.isInteger(out.genome.edge.cadenceMin)).toBe(true);
      results.push(out.genome.edge.cadenceMin);
    }
    expect([...results].sort((x, y) => x - y)).toEqual([192, 239]);
  });

  it("signal gene near its ceiling: breakoutExpansion 2.4 up-perturbation clamps to exactly 2.5", () => {
    const results: number[] = [];
    for (const deltaRoll of [0.999999, 0.000001]) {
      const g = kellyLike();
      g.edge.signal.breakoutExpansion = 2.4; // ×~1.2 → 2.88, must clamp to the 2.5 ceiling
      const s = scriptedRng(singleMutationQueue("edge.signal.breakoutExpansion", deltaRoll));
      const out = mutate(g, s.rng);
      results.push(out.genome.edge.signal.breakoutExpansion);
    }
    for (const v of results) {
      expect(v).toBeGreaterThanOrEqual(1.05);
      expect(v).toBeLessThanOrEqual(2.5);
    }
    expect(Math.max(...results)).toBe(2.5); // the ceiling held exactly
    expect(Math.min(...results)).toBeLessThan(2.4); // the down-perturbation really moved
  });

  it("signal gene near its floor: eventGapPct 0.0035 down-perturbation clamps to exactly 0.003", () => {
    const results: number[] = [];
    for (const deltaRoll of [0.999999, 0.000001]) {
      const g = kellyLike();
      g.edge.signal.eventGapPct = 0.0035; // ×~0.8 → 0.0028, must clamp to the 0.003 floor
      const s = scriptedRng(singleMutationQueue("edge.signal.eventGapPct", deltaRoll));
      const out = mutate(g, s.rng);
      results.push(out.genome.edge.signal.eventGapPct);
    }
    for (const v of results) {
      expect(v).toBeGreaterThanOrEqual(0.003);
      expect(v).toBeLessThanOrEqual(0.03);
    }
    expect(Math.min(...results)).toBe(0.003); // the floor held exactly
    expect(Math.max(...results)).toBeGreaterThan(0.0035); // the up-perturbation really moved
  });

  it("signal integer gene at its ceiling: breakoutRange 30 min-steps to 29 up (only legal move), rounds to 24 down", () => {
    const results: number[] = [];
    for (const deltaRoll of [0.999999, 0.000001]) {
      const g = kellyLike();
      g.edge.signal.breakoutRange = 30;
      const s = scriptedRng(singleMutationQueue("edge.signal.breakoutRange", deltaRoll));
      const out = mutate(g, s.rng);
      expect(Number.isInteger(out.genome.edge.signal.breakoutRange)).toBe(true);
      results.push(out.genome.edge.signal.breakoutRange);
    }
    expect([...results].sort((x, y) => x - y)).toEqual([24, 29]);
  });

  it("min-step rule: a fired gate on a small integer gene ALWAYS moves it by at least 1", () => {
    // at 3, |±20%| < 0.5 always rounds back — the rule forces a ±1 step in the delta's direction
    for (const [deltaRoll, expected] of [[0.6, 4], [0.4, 2]] as const) {
      const g = kellyLike();
      const s2 = scriptedRng(singleMutationQueue("edge.signal.momentumLookback", deltaRoll));
      const out = mutate(g, s2.rng);
      expect(out.genome.edge.signal.momentumLookback).toBe(expected);
      expect(out.log).toEqual([`edge.signal.momentumLookback: 3→${expected}`]);
      expect(out.genome.meta.mutations).toContain(`edge.signal.momentumLookback: 3→${expected}`);
    }
    // at the FLOOR (2) a down-delta cannot go to 1 — it steps the other way, to 3
    const g = kellyLike();
    g.edge.signal.momentumLookback = 2;
    const s3 = scriptedRng(singleMutationQueue("edge.signal.momentumLookback", 0.000001));
    const out = mutate(g, s3.rng);
    expect(out.genome.edge.signal.momentumLookback).toBe(3);
    expect(out.log).toEqual(["edge.signal.momentumLookback: 2→3"]);
  });

  it("bias perturbScale 0 for a path → its value never changes even when the gate fires", () => {
    const g = kellyLike();
    // Exact queue: aggression gate fires (+delta), then the 18 remaining numeric gates + 3 sport gates.
    const queue = [0.001, 0.7, ...Array.from({ length: NUM_GENES - 1 + 3 }, () => 0.9)];
    const { rng } = scriptedRng(queue);
    const out = mutate(g, rng, { perturbScale: { "edge.aggression": 0 } });
    expect(out.genome.edge.aggression).toBe(0.85);
    // nothing else fired, so the rest of the genome is untouched
    expect(out.genome.edge).toEqual({ ...kellyLike().edge, aggression: out.genome.edge.aggression });
    expect(out.genome.voice).toEqual(kellyLike().voice);
    // a no-op may log old==old or nothing — but never more than the single fired gate
    expect(out.log.length).toBeLessThanOrEqual(1);
    if (out.log.length === 1) expect(out.log[0]!).toContain("edge.aggression");
  });

  it("never mutates the input genome (deep-frozen input, forced mutation, no throw)", () => {
    const g = deepFreeze(kellyLike());
    const before = JSON.stringify(g);
    const s = scriptedRng(singleMutationQueue("edge.aggression", 0.75));
    const out = mutate(g, s.rng);
    expect(JSON.stringify(g)).toBe(before);
    expect(out.genome.edge.aggression).not.toBe(0.85);
  });

  it("a forced archetype flip is a SPORT: logged with the prefix, and the archetype actually differs", () => {
    const g = kellyLike();
    g.edge.archetype = "meanRevert"; // not first in EDGE_ARCHETYPES, so pick-roll 0 cannot return it
    const queue = [...Array.from({ length: NUM_GENES }, () => 0.9), 0.001, 0.0, 0.9, 0.9];
    const s = scriptedRng(queue);
    const out = mutate(g, s.rng);

    expect(s.calls()).toBe(NUM_GENES + 4);
    expect(out.log).toHaveLength(1);
    const line = out.log[0]!;
    expect(line.startsWith("SPORT:")).toBe(true);
    expect(line).toContain("edge.archetype");
    expect(out.genome.edge.archetype).not.toBe("meanRevert");
    expect(EDGE_ARCHETYPES).toContain(out.genome.edge.archetype);
    expect(out.genome.voice.archetype).toBe("cocky"); // voice gate did not fire
    expect(out.genome.edge.researchStyle).toBe("priceAction"); // researchStyle gate did not fire
    expect(out.genome.meta.mutations).toEqual([...kellyLike().meta.mutations, line]);
  });

  it("a forced researchStyle flip is a SPORT: logged 'SPORT: edge.researchStyle: old→new', landing on a DIFFERENT style", () => {
    const g = kellyLike();
    g.edge.researchStyle = "flow"; // not first in RESEARCH_STYLES, so pick-roll 0 cannot return it
    // 20 numeric gates pass, edge.archetype and voice.archetype gates pass, researchStyle gate
    // fires (0.001 < 0.03), pick roll 0 → first style ≠ "flow" → "priceAction"
    const queue = [...Array.from({ length: NUM_GENES }, () => 0.9), 0.9, 0.9, 0.001, 0.0];
    const s = scriptedRng(queue);
    const out = mutate(g, s.rng);

    expect(s.calls()).toBe(NUM_GENES + 4);
    expect(out.log).toEqual(["SPORT: edge.researchStyle: flow→priceAction"]);
    expect(out.genome.edge.researchStyle).toBe("priceAction");
    expect(out.genome.edge.researchStyle).not.toBe("flow"); // the flip really moved
    expect(RESEARCH_STYLES).toContain(out.genome.edge.researchStyle);
    expect(out.genome.edge.archetype).toBe("momentum"); // the other sport gates did not fire
    expect(out.genome.voice.archetype).toBe("cocky");
    expect(out.genome.meta.mutations).toEqual([...kellyLike().meta.mutations, ...out.log]);
  });

  it("a seeded scan finds all three sport kinds, and every flip lands on a DIFFERENT valid value", () => {
    const seen = { edge: 0, voice: 0, research: 0 };
    for (let seed = 1; seed <= 3000; seed++) {
      const input = kellyLike();
      const out = mutate(input, seededRng(seed));
      for (const line of out.log) {
        if (!line.startsWith("SPORT:")) continue;
        if (line.includes("edge.archetype")) {
          seen.edge++;
          expect(out.genome.edge.archetype).not.toBe(input.edge.archetype);
          expect(EDGE_ARCHETYPES).toContain(out.genome.edge.archetype);
        } else if (line.includes("voice.archetype")) {
          seen.voice++;
          expect(out.genome.voice.archetype).not.toBe(input.voice.archetype);
          expect(VOICE_ARCHETYPES).toContain(out.genome.voice.archetype);
        } else {
          expect(line).toContain("edge.researchStyle");
          seen.research++;
          expect(out.genome.edge.researchStyle).not.toBe(input.edge.researchStyle);
          expect(RESEARCH_STYLES).toContain(out.genome.edge.researchStyle);
        }
      }
    }
    // each gate fires at ~3% of 3000 seeds — all three kinds must actually appear in the scan
    expect(seen.edge).toBeGreaterThan(0);
    expect(seen.voice).toBeGreaterThan(0);
    expect(seen.research).toBeGreaterThan(0);
  });

  it("patience consistency: a mutated minHoldMin can never exceed maxHoldHrs*60", () => {
    let minHoldMutations = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const g = kellyLike();
      g.edge.patience = { minHoldMin: 60, maxHoldHrs: 1 }; // tight: +20% on minHold would bust it
      const out = mutate(g, seededRng(seed));
      const { minHoldMin, maxHoldHrs } = out.genome.edge.patience;
      expect(minHoldMin).toBeLessThanOrEqual(maxHoldHrs * 60);
      if (out.log.some((l) => l.includes("edge.patience.minHoldMin"))) minHoldMutations++;
    }
    // the scan must actually have exercised minHold mutations (≈15% of 500 seeds)
    expect(minHoldMutations).toBeGreaterThan(0);
  });

  it("property (seeds 1..150): output always schema-valid, in-range, log appended, input untouched", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const g = kellyLike();
      g.meta.mutations = ["prior-line"];
      const before = JSON.stringify(g);
      const out = mutate(g, seededRng(seed));

      expect(JSON.stringify(g)).toBe(before); // input untouched
      expect(() => parseGenome(out.genome)).not.toThrow(); // schema covers ranges + integers
      expect(out.genome.meta.mutations).toEqual(["prior-line", ...out.log]);
      for (const line of out.log) {
        expect(line).toMatch(/^(SPORT: ?)?(edge|voice|econ)\.[A-Za-z.]+: .+→.+$/);
      }
      for (const [path, range] of Object.entries(GENE_RANGES)) {
        const v = getPath(out.genome, path) as number;
        expect(v).toBeGreaterThanOrEqual(range.min);
        expect(v).toBeLessThanOrEqual(range.max);
        if (range.integer) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it("is deterministic: same seed → same genome and log", () => {
    const one = mutate(kellyLike(), seededRng(4242));
    const two = mutate(kellyLike(), seededRng(4242));
    expect(one.genome).toEqual(two.genome);
    expect(one.log).toEqual(two.log);
  });

  it("gene odds sanity: over many seeds each of the 20 numeric genes mutates sometimes, but far from always", () => {
    // Fixture note: an integer gene sitting at 3 (the default momentumLookback) has |±20%| < 0.5
    // for ~83% of fired gates, so rounding swallows most perturbations and the LOG (the only
    // observable here) under-counts the 15% gate — that behavior is pinned by its own scripted
    // test above. Likewise flowWeight's default 0 is a multiplicative fixed point (0×(1+δ)=0):
    // a fired gate can never move it, so the scan runs both genes mid-band to keep the log a
    // faithful proxy for the gate.
    const scanFixture = (): Genome => {
      const g = kellyLike();
      g.edge.signal.momentumLookback = 7;
      g.edge.flowWeight = 0.5;
      return g;
    };
    const hits = new Map<string, number>(Object.keys(GENE_RANGES).map((k) => [k, 0]));
    const RUNS = 400;
    for (let seed = 1; seed <= RUNS; seed++) {
      const out = mutate(scanFixture(), seededRng(seed));
      for (const line of out.log) {
        for (const path of hits.keys()) {
          if (line.includes(path)) hits.set(path, hits.get(path)! + 1);
        }
      }
    }
    // 15% gate: expect roughly 60/400 per gene; assert a loose deterministic band.
    for (const [path, count] of hits) {
      expect(count, `gene ${path} should mutate occasionally`).toBeGreaterThan(10);
      expect(count, `gene ${path} mutates too often for a ${MUTATION.geneChance} gate`).toBeLessThan(
        RUNS * 0.35,
      );
    }
  });
});

// ---------- selfGeneOrigins ----------

describe("selfGeneOrigins (per-birth inheritance report — parent or mutated, nothing else)", () => {
  it("an unmutated clone attributes all 28 units to the parent, with no `was` anywhere", () => {
    const parent = kellyLike();
    const { genome: child } = mutate(spawnGenome(parent, CHILD), NO_MUTATION_RNG);
    const origins = selfGeneOrigins(parent, child);
    // exact key set AND order — the dashboard renders births in registry order
    expect(Object.keys(origins)).toEqual([...INHERIT_UNITS]);
    for (const unit of INHERIT_UNITS) {
      const o = origins[unit]!;
      expect(o.from).toBe("parent");
      expect(o.value).toEqual(getPath(parent, unit));
      expect(o.was).toBeUndefined();
    }
  });

  it("a logged numeric mutation reads from:'mutated' with `was` = the parent's value as the log printed it", () => {
    const parent = kellyLike();
    const s = scriptedRng(singleMutationQueue("edge.aggression", 0.75));
    const { genome: child, log } = mutate(spawnGenome(parent, CHILD), s.rng);
    expect(log).toHaveLength(1);

    const origins = selfGeneOrigins(parent, child);
    const o = origins["edge.aggression"]!;
    expect(o.from).toBe("mutated");
    expect(o.was).toBe(String(parent.edge.aggression)); // "0.85" — the log's old-value string
    expect(o.value).toBe(child.edge.aggression);
    // every other unit is the parent's, untouched
    for (const unit of INHERIT_UNITS) {
      if (unit === "edge.aggression") continue;
      expect(origins[unit]!.from).toBe("parent");
      expect(origins[unit]!.value).toEqual(getPath(parent, unit));
      expect(origins[unit]!.was).toBeUndefined();
    }
  });

  it("an archetype-flip sport is 'mutated' with `was` = the old archetype (the SPORT prefix parses)", () => {
    const parent = kellyLike(); // archetype "momentum"
    // 20 numeric gates pass; edge.archetype gate fires (0.001 < 0.03), pick 0 → first
    // non-momentum archetype ("meanRevert"); voice and researchStyle gates pass
    const queue = [...Array.from({ length: NUM_GENES }, () => 0.9), 0.001, 0.0, 0.9, 0.9];
    const { genome: child } = mutate(spawnGenome(parent, CHILD), scriptedRng(queue).rng);
    expect(child.edge.archetype).toBe("meanRevert");
    expect(child.meta.mutations).toEqual(["SPORT: edge.archetype: momentum→meanRevert"]);

    const origins = selfGeneOrigins(parent, child);
    expect(origins["edge.archetype"]!).toEqual({ value: "meanRevert", from: "mutated", was: "momentum" });
    for (const unit of INHERIT_UNITS) {
      if (unit === "edge.archetype") continue;
      expect(origins[unit]!.from).toBe("parent");
    }
  });

  it("a researchStyle sport is 'mutated' with `was` = the old style STRING", () => {
    const parent = kellyLike(); // researchStyle "priceAction"
    // no numeric mutation, no archetype sports; researchStyle gate fires, pick roll 0 →
    // first style ≠ "priceAction" → "flow"
    const queue = [...Array.from({ length: NUM_GENES }, () => 0.9), 0.9, 0.9, 0.001, 0.0];
    const { genome: child } = mutate(spawnGenome(parent, CHILD), scriptedRng(queue).rng);
    expect(child.edge.researchStyle).toBe("flow");
    expect(child.meta.mutations).toEqual(["SPORT: edge.researchStyle: priceAction→flow"]);

    const origins = selfGeneOrigins(parent, child);
    expect(origins["edge.researchStyle"]!).toEqual({ value: "flow", from: "mutated", was: "priceAction" });
  });

  it("the patience-fix repair — a divergence WITHOUT a gene-path log line — still reads 'mutated', with no `was`", () => {
    // a hand-made parent that violates the consistency rule: zod allows it (the rule lives in
    // mutate()), so the clone gets repaired with a 'patience-fix:' line that maps to NO gene path
    const parent = kellyLike();
    parent.edge.patience = { minHoldMin: 200, maxHoldHrs: 2 };
    const { genome: child, log } = mutate(spawnGenome(parent, CHILD), NO_MUTATION_RNG);
    expect(log).toEqual(["patience-fix: minHoldMin 200→120"]);
    expect(child.edge.patience.minHoldMin).toBe(120);

    const origins = selfGeneOrigins(parent, child);
    const o = origins["edge.patience.minHoldMin"]!;
    expect(o.from).toBe("mutated"); // the value differs from the parent → honest attribution
    expect(o.value).toBe(120);
    expect(o.was).toBeUndefined(); // no gene-path log line to source `was` from
    expect(origins["edge.patience.maxHoldHrs"]!).toEqual({ value: 2, from: "parent" });
  });

  it("property (seeds 1..200): every unit is 'parent' or 'mutated' — logged paths carry `was`, untouched paths match the parent exactly", () => {
    let mutatedSeen = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const parent = kellyLike();
      const { genome: child, log } = mutate(spawnGenome(parent, CHILD), seededRng(seed));
      const logged = new Set(
        log.map((l) =>
          l.startsWith("SPORT: ")
            ? l.slice("SPORT: ".length, l.indexOf(":", "SPORT: ".length))
            : l.slice(0, l.indexOf(":")),
        ),
      );
      const origins = selfGeneOrigins(parent, child);
      expect(Object.keys(origins)).toEqual([...INHERIT_UNITS]);
      for (const unit of INHERIT_UNITS) {
        const o = origins[unit]!;
        expect(["parent", "mutated"]).toContain(o.from); // "mate"/"both" are extinct values
        expect(o.value).toEqual(getPath(child, unit));
        if (logged.has(unit)) {
          expect(o.from).toBe("mutated");
          expect(o.was).toBe(String(getPath(parent, unit)));
          mutatedSeen++;
        } else {
          // kellyLike cannot trip the patience-fix (30 ≤ 48×60 survives any single ±20% move),
          // so every unlogged unit must still BE the parent's value
          expect(o.from).toBe("parent");
          expect(o.value).toEqual(getPath(parent, unit));
          expect(o.was).toBeUndefined();
        }
      }
    }
    expect(mutatedSeen).toBeGreaterThan(0); // the scan really exercised mutations
  });
});

// ---------- childName ----------

describe("childName (collision-checked, genesis excluded)", () => {
  const allTaken = new Set(QUANT_WORDLIST);

  it("returns the single free word regardless of where the rng starts probing", () => {
    const taken = new Set(QUANT_WORDLIST.filter((w) => w !== "copula"));
    for (const rng of [constRng(0), constRng(0.5), constRng(0.999999), seededRng("start-anywhere")]) {
      const res = childName(rng, taken, 2);
      expect(res.name).toBe("copula");
      expect(res.ticker).toBe("COPULA");
    }
  });

  it("collision check is case-insensitive", () => {
    const taken = new Set(QUANT_WORDLIST.filter((w) => w !== "markov").map((w) => w.toUpperCase()));
    const res = childName(seededRng("case-check"), taken, 3);
    expect(res.name).toBe("markov");
  });

  it("whole list taken → falls through to the generation suffix", () => {
    const res = childName(seededRng("exhausted"), allTaken, 7);
    expect(res.name).toMatch(/7$/);
    const base = res.name.slice(0, -1);
    expect(QUANT_WORDLIST).toContain(base);
    expect((GENESIS_NAMES as readonly string[]).includes(res.name)).toBe(false);
    expect(res.ticker).toBe(res.name.toUpperCase().slice(0, 6));
  });

  it("genesis names are always excluded even with an empty taken set", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const res = childName(seededRng(seed), new Set(), 2);
      expect(QUANT_WORDLIST).toContain(res.name);
      expect((GENESIS_NAMES as readonly string[]).includes(res.name)).toBe(false);
    }
  });

  it("ticker is the uppercased name truncated to 6 chars ('cholesky' → 'CHOLES')", () => {
    const taken = new Set(QUANT_WORDLIST.filter((w) => w !== "cholesky"));
    const res = childName(seededRng("long-name"), taken, 2);
    expect(res.name).toBe("cholesky");
    expect(res.ticker).toBe("CHOLES");
    expect(res.ticker.length).toBeLessThanOrEqual(6);
  });

  it("ticker is always uppercase and ≤ 6 chars for any pick", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const res = childName(seededRng(seed), new Set(), 2);
      expect(res.ticker).toBe(res.ticker.toUpperCase());
      expect(res.ticker.length).toBeLessThanOrEqual(6);
      expect(res.ticker).toBe(res.name.toUpperCase().slice(0, 6));
    }
  });

  it("is deterministic under a fixed seed", () => {
    const a = childName(seededRng(99), new Set(["ito", "wiener"]), 4);
    const b = childName(seededRng(99), new Set(["ito", "wiener"]), 4);
    expect(a).toEqual(b);
  });
});
