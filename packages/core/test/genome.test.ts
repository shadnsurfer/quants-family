/**
 * Genome schema (§4.1) + canonical hash. The hash must be a pure function of the heritable
 * material: key order and birth-time fields (birthTx, genomeHash) must not affect it.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalGenomeJson,
  DEFAULT_SIGNAL_GENES,
  genomeHash,
  parseGenome,
  type Genome,
  type GenomeInput,
} from "../src/index.js";

/**
 * The kelly example from PROJECT.md §4.1, verbatim — it predates the strategy-math genes,
 * the flow research genes AND the econ genes, deliberately carrying NO edge.signal,
 * researchStyle, flowWeight, flowSkepticism or econ block: parse must accept it and fill
 * every default.
 */
function kelly(): GenomeInput {
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
    },
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

/** kelly with the signal genes explicit and filled — a full Genome for the hash tests. */
function kellyFull(): Genome {
  return parseGenome(kelly());
}

describe("parseGenome (§4.1 schema)", () => {
  it("accepts the kelly example genome verbatim, filling edge.signal, the research genes and econ with the defaults", () => {
    const parsed = parseGenome(kelly());
    expect(parsed).toEqual({
      ...kelly(),
      edge: {
        ...kelly().edge,
        signal: DEFAULT_SIGNAL_GENES,
        researchStyle: "priceAction",
        flowWeight: 0,
        flowSkepticism: 0.5,
      },
      econ: { holderRewardPct: 0.2 },
    });
    expect(parsed.meta.generation).toBe(1);
    expect(parsed.edge.archetype).toBe("momentum");
    expect(parsed.voice.archetype).toBe("cocky");
    // the research defaults reproduce the pre-flow behavior: price signal only, flow ignored
    expect(parsed.edge.researchStyle).toBe("priceAction");
    expect(parsed.edge.flowWeight).toBe(0);
    expect(parsed.edge.flowSkepticism).toBe(0.5);
    // old genesis JSONs carry no econ block — the holder-reward default is 0.2
    expect(parsed.econ).toEqual({ holderRewardPct: 0.2 });
  });

  it("econ defaults: an empty econ object fills holderRewardPct 0.2; an explicit value is kept", () => {
    const empty = kelly();
    empty.econ = {};
    expect(parseGenome(empty).econ.holderRewardPct).toBe(0.2);

    const explicit = kelly();
    explicit.econ = { holderRewardPct: 0.05 };
    expect(parseGenome(explicit).econ.holderRewardPct).toBe(0.05);
  });

  it("rejects holderRewardPct outside 0..0.4; the boundaries 0 and 0.4 are legal", () => {
    const withEcon = (holderRewardPct: number): GenomeInput => {
      const g = kelly();
      g.econ = { holderRewardPct };
      return g;
    };
    expect(() => parseGenome(withEcon(-0.01))).toThrowError(); // < 0
    expect(() => parseGenome(withEcon(0.41))).toThrowError(); // > 0.4
    expect(parseGenome(withEcon(0)).econ.holderRewardPct).toBe(0);
    expect(parseGenome(withEcon(0.4)).econ.holderRewardPct).toBe(0.4);
  });

  it("the default signal genes reproduce the original hardcoded strategy constants", () => {
    expect(DEFAULT_SIGNAL_GENES).toEqual({
      momentumLookback: 3,
      momentumEntryPct: 0.015,
      meanRevertWindow: 10,
      meanRevertEntryZ: 1.5,
      breakoutRange: 12,
      breakoutExpansion: 1.3,
      eventGapPct: 0.008,
      eventWindowMult: 1,
    });
  });

  it("a partial edge.signal keeps the given genes and defaults the rest (genesis-file shape)", () => {
    const g = kelly();
    g.edge.signal = { momentumLookback: 3, momentumEntryPct: 0.012 };
    const parsed = parseGenome(g);
    expect(parsed.edge.signal).toEqual({ ...DEFAULT_SIGNAL_GENES, momentumEntryPct: 0.012 });
  });

  it("rejects out-of-band signal genes — the schema mirrors GENE_RANGES", () => {
    const withSignal = (over: Record<string, number>): GenomeInput => {
      const g = kelly();
      g.edge.signal = over;
      return g;
    };
    expect(() => parseGenome(withSignal({ momentumLookback: 1 }))).toThrowError(); // < 2
    expect(() => parseGenome(withSignal({ momentumLookback: 13 }))).toThrowError(); // > 12
    expect(() => parseGenome(withSignal({ momentumLookback: 3.5 }))).toThrowError(); // non-integer
    expect(() => parseGenome(withSignal({ meanRevertEntryZ: 0.4 }))).toThrowError(); // < 0.5
    expect(() => parseGenome(withSignal({ breakoutExpansion: 2.6 }))).toThrowError(); // > 2.5
    expect(() => parseGenome(withSignal({ eventGapPct: 0.002 }))).toThrowError(); // < 0.003
    // boundary values are legal
    expect(parseGenome(withSignal({ momentumLookback: 2 })).edge.signal.momentumLookback).toBe(2);
    expect(parseGenome(withSignal({ momentumLookback: 12 })).edge.signal.momentumLookback).toBe(12);
  });

  it("rejects out-of-band research genes: flowWeight/flowSkepticism outside [0,1], unknown researchStyle", () => {
    const withEdge = (over: Record<string, unknown>): GenomeInput => {
      const g = kelly();
      Object.assign(g.edge, over);
      return g;
    };
    expect(() => parseGenome(withEdge({ flowWeight: 1.01 }))).toThrowError(); // > 1
    expect(() => parseGenome(withEdge({ flowWeight: -0.01 }))).toThrowError(); // < 0
    expect(() => parseGenome(withEdge({ flowSkepticism: 1.01 }))).toThrowError(); // > 1
    expect(() => parseGenome(withEdge({ flowSkepticism: -0.01 }))).toThrowError(); // < 0
    expect(() => parseGenome(withEdge({ researchStyle: "astrology" }))).toThrowError(); // not a RESEARCH_STYLE
    // boundary values and every declared style are legal
    expect(parseGenome(withEdge({ flowWeight: 0 })).edge.flowWeight).toBe(0);
    expect(parseGenome(withEdge({ flowWeight: 1 })).edge.flowWeight).toBe(1);
    expect(parseGenome(withEdge({ researchStyle: "flow" })).edge.researchStyle).toBe("flow");
    expect(parseGenome(withEdge({ researchStyle: "hybrid" })).edge.researchStyle).toBe("hybrid");
  });

  it("applies defaults for mutations/birthTx/genomeHash when absent", () => {
    const g = kelly() as unknown as {
      meta: Record<string, unknown>;
      edge: unknown;
      voice: unknown;
    };
    delete g.meta["mutations"];
    delete g.meta["birthTx"];
    delete g.meta["genomeHash"];
    const parsed = parseGenome(g);
    expect(parsed.meta.mutations).toEqual([]);
    expect(parsed.meta.birthTx).toBeNull();
    expect(parsed.meta.genomeHash).toBeNull();
  });

  it("throws a ZodError on violation", () => {
    const bad = kelly();
    bad.edge.aggression = 1.2;
    let caught: unknown = null;
    try {
      parseGenome(bad);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("ZodError");
  });

  it("rejects aggression > 1", () => {
    const g = kelly();
    g.edge.aggression = 1.01;
    expect(() => parseGenome(g)).toThrowError();
  });

  it("rejects an unknown edge archetype", () => {
    const g = kelly() as unknown as { edge: { archetype: string } };
    g.edge.archetype = "scalper";
    expect(() => parseGenome(g)).toThrowError();
  });

  it("rejects an unknown voice archetype", () => {
    const g = kelly() as unknown as { voice: { archetype: string } };
    g.voice.archetype = "sadboi";
    expect(() => parseGenome(g)).toThrowError();
  });

  it("rejects postsPerDay 0", () => {
    const g = kelly();
    g.voice.postsPerDay = 0;
    expect(() => parseGenome(g)).toThrowError();
  });

  it("rejects a ticker longer than 6 chars but accepts exactly 6", () => {
    const long = kelly();
    long.meta.ticker = "CHOLESKY";
    expect(() => parseGenome(long)).toThrowError();

    const six = kelly();
    six.meta.ticker = "CHOLES";
    expect(parseGenome(six).meta.ticker).toBe("CHOLES");
  });

  it("rejects an empty universe", () => {
    const g = kelly();
    g.edge.universe = [];
    expect(() => parseGenome(g)).toThrowError();
  });
});

describe("genomeHash (canonical keccak256)", () => {
  it("matches /^0x[0-9a-f]{64}$/", () => {
    expect(genomeHash(kellyFull())).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is stable across property insertion order", () => {
    // Same data as kellyFull(), every object's keys inserted in a different order —
    // including the signal block, the research genes and the econ block, written out
    // literally at the defaults.
    const shuffled: Genome = {
      voice: {
        emojiPolicy: "none",
        lowercase: true,
        beefiness: 0.3,
        flexStyle: "receipts-only",
        postsPerDay: 6,
        archetype: "cocky",
      },
      econ: { holderRewardPct: 0.2 },
      edge: {
        flowSkepticism: 0.5,
        signal: {
          eventWindowMult: 1,
          eventGapPct: 0.008,
          breakoutExpansion: 1.3,
          breakoutRange: 12,
          meanRevertEntryZ: 1.5,
          meanRevertWindow: 10,
          momentumEntryPct: 0.015,
          momentumLookback: 3,
        },
        entryThesisStyle: "strict-confluence",
        darkHours: 0.5,
        researchStyle: "priceAction",
        cadenceMin: 20,
        conviction: 0.12,
        fear: 0.05,
        patience: { maxHoldHrs: 48, minHoldMin: 30 },
        aggression: 0.85,
        flowWeight: 0,
        universe: ["NVDA", "TSLA", "HOOD"],
        archetype: "momentum",
      },
      meta: {
        genomeHash: null,
        birthTx: null,
        mutations: [],
        parents: [],
        generation: 1,
        ticker: "KELLY",
        name: "kelly",
        id: "g1-kelly",
      },
    };
    expect(genomeHash(shuffled)).toBe(genomeHash(kellyFull()));
  });

  it("omitted signal, research AND econ genes hash identically to the explicit defaults after parse", () => {
    // Genesis files written before the signal/research/econ genes existed must keep their
    // hash once parsed — the defaults fill deterministically.
    expect(genomeHash(parseGenome(kelly()))).toBe(genomeHash(kellyFull()));
    // and an explicit econ block at the default value hashes identically to the omitted one
    const explicitEcon = kelly();
    explicitEcon.econ = { holderRewardPct: 0.2 };
    expect(genomeHash(parseGenome(explicitEcon))).toBe(genomeHash(kellyFull()));
  });

  it("the canonical JSON includes the econ block (it is heritable material, so it is hashed)", () => {
    expect(canonicalGenomeJson(kellyFull())).toContain('"econ":{"holderRewardPct":0.2}');
    const raised = kellyFull();
    raised.econ.holderRewardPct = 0.4;
    expect(canonicalGenomeJson(raised)).toContain('"econ":{"holderRewardPct":0.4}');
    expect(genomeHash(raised)).not.toBe(genomeHash(kellyFull()));
  });

  it("ignores meta.birthTx and meta.genomeHash values", () => {
    const withBirthFields = kellyFull();
    withBirthFields.meta.birthTx = "0xabc123";
    withBirthFields.meta.genomeHash = "0x" + "ff".repeat(32);
    expect(genomeHash(withBirthFields)).toBe(genomeHash(kellyFull()));
  });

  it("does NOT ignore universe array order (arrays are ordered data)", () => {
    const reordered = kellyFull();
    reordered.edge.universe = ["HOOD", "TSLA", "NVDA"];
    expect(genomeHash(reordered)).not.toBe(genomeHash(kellyFull()));
  });

  it("changes when any gene changes", () => {
    const base = genomeHash(kellyFull());

    const a = kellyFull();
    a.edge.aggression = 0.86;
    expect(genomeHash(a)).not.toBe(base);

    const b = kellyFull();
    b.edge.patience.minHoldMin = 31;
    expect(genomeHash(b)).not.toBe(base);

    const c = kellyFull();
    c.voice.archetype = "stoic";
    expect(genomeHash(c)).not.toBe(base);

    const d = kellyFull();
    d.voice.postsPerDay = 7;
    expect(genomeHash(d)).not.toBe(base);

    const e = kellyFull();
    e.meta.name = "kellyprime";
    expect(genomeHash(e)).not.toBe(base);

    const f = kellyFull();
    f.edge.signal.momentumLookback = 4;
    expect(genomeHash(f)).not.toBe(base);

    const g = kellyFull();
    g.edge.signal.eventGapPct = 0.009;
    expect(genomeHash(g)).not.toBe(base);

    const h = kellyFull();
    h.edge.researchStyle = "hybrid";
    expect(genomeHash(h)).not.toBe(base);

    const i = kellyFull();
    i.edge.flowWeight = 0.25;
    expect(genomeHash(i)).not.toBe(base);

    const j = kellyFull();
    j.edge.flowSkepticism = 0.51;
    expect(genomeHash(j)).not.toBe(base);

    const k = kellyFull();
    k.econ.holderRewardPct = 0.25;
    expect(genomeHash(k)).not.toBe(base);
  });

  it("is deterministic across calls", () => {
    expect(genomeHash(kellyFull())).toBe(genomeHash(kellyFull()));
  });
});
