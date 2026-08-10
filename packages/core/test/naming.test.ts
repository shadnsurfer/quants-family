/**
 * Naming — the parent's design voice (Charles 2026-08-02). Children are named by the parent:
 * lineage blends, leetspeak, random strings, freak symbol names, meme doubles. Display names are
 * free-form; ticker (A-Z0-9 ≤ 6), id (slugged, filename-safe), and xHandle (≤ 15) are derived
 * and collision-safe. Deterministic under a seeded Rng.
 */
import { describe, expect, it } from "vitest";
import {
  designChildIdentity, parseGenome, seededRng, slugOf, tickerOf, xHandleOf,
  type Genome,
} from "../src/index.js";

function parentGenome(name = "kelly"): Genome {
  return parseGenome({
    meta: { id: `g1-${name}`, name, ticker: name.toUpperCase(), generation: 1, parents: [] },
    edge: {
      archetype: "momentum", universe: ["NVDA"], aggression: 0.5,
      patience: { minHoldMin: 30, maxHoldHrs: 48 }, fear: 0.05, conviction: 0.12,
      cadenceMin: 20, darkHours: 0.5, entryThesisStyle: "strict-confluence",
    },
    voice: { archetype: "cocky", postsPerDay: 6, flexStyle: "receipts-only", beefiness: 0.3, lowercase: true, emojiPolicy: "none" },
  });
}

function ctx(over: Partial<Parameters<typeof designChildIdentity>[0]> = {}) {
  return {
    parent: parentGenome(),
    rng: seededRng("naming-test"),
    gen: 2,
    sport: false,
    takenNames: new Set<string>(),
    takenIds: new Set<string>(),
    takenTickers: new Set<string>(),
    ...over,
  };
}

describe("tickerOf", () => {
  it("strips non-alphanumerics and uppercases, capped at 6", () => {
    expect(tickerOf("kelly")).toBe("KELLY");
    expect(tickerOf("Df$<>")).toBe("DF");
    expect(tickerOf("superbob")).toBe("SUPERB");
    expect(tickerOf("x//en")).toBe("XEN");
  });
  it("falls back to QNT when nothing survives", () => {
    expect(tickerOf("$<>-_")).toBe("QNT");
    expect(tickerOf("")).toBe("QNT");
  });
});

describe("slugOf", () => {
  it("keeps a-z0-9 runs joined by single dashes, trimmed", () => {
    expect(slugOf("kelly")).toBe("kelly");
    expect(slugOf("Df$<>")).toBe("df");
    expect(slugOf("lil theta")).toBe("lil-theta");
    expect(slugOf("x//en")).toBe("x-en");
  });
  it("falls back to x when nothing survives", () => {
    expect(slugOf("$<>")).toBe("x");
  });
});

describe("xHandleOf", () => {
  it("lowercase a-z0-9_ capped at 15, with fallback", () => {
    expect(xHandleOf("KELLY")).toBe("kelly");
    expect(xHandleOf("superbobthegreat")).toBe("superbobthegrea".slice(0, 15));
    expect(xHandleOf("Df$<>")).toBe("df");
    expect(xHandleOf("$<>")).toBe("quant");
    expect(xHandleOf("lil theta")).toBe("liltheta");
  });
});

describe("designChildIdentity", () => {
  it("is deterministic under a fixed seed", () => {
    const a = designChildIdentity(ctx());
    const b = designChildIdentity(ctx());
    expect(a).toEqual(b);
  });

  it("produces a full, coherent identity", () => {
    const id = designChildIdentity(ctx());
    expect(id.name.length).toBeGreaterThan(0);
    expect(id.ticker).toBe(tickerOf(id.name));
    expect(id.id).toBe(`g2-${slugOf(id.name)}`);
    expect(id.xHandle.length).toBeLessThanOrEqual(15);
  });

  it("avoids taken names case-insensitively, retrying until free", () => {
    const first = designChildIdentity(ctx());
    const second = designChildIdentity(ctx({ takenNames: new Set([first.name.toUpperCase()]) }));
    expect(second.name.toLowerCase()).not.toBe(first.name.toLowerCase());
  });

  it("suffixes the id when the slug is taken", () => {
    const id = designChildIdentity(ctx({ takenIds: new Set([`g2-${slugOf("placeholder")}`]) }));
    // force the same name to be designed but its id already used
    const slug = slugOf(id.name);
    if (id.id === `g2-${slug}`) {
      const again = designChildIdentity(ctx({ takenIds: new Set([id.id]) }));
      expect(again.id === `g2-${slugOf(again.name)}` || again.id.startsWith(`g2-${slugOf(again.name)}-`)).toBe(true);
    }
  });

  it("suffixes the ticker when taken", () => {
    const id = designChildIdentity(ctx());
    const again = designChildIdentity(ctx({ takenTickers: new Set([id.ticker]) }));
    expect(again.ticker).not.toBe(id.ticker);
    expect(again.ticker.length).toBeLessThanOrEqual(6);
  });

  it("unconventional names really happen: freak/meme lanes produce non-plain names", () => {
    const names = new Set<string>();
    let symbolNames = 0;
    let parentEchoes = 0;
    for (let i = 0; i < 60; i++) {
      const id = designChildIdentity(ctx({ rng: seededRng(`lane-${i}`) }));
      names.add(id.name);
      if (/[^a-z0-9 ]/i.test(id.name)) symbolNames++;
      if (id.name.toLowerCase().includes("kelly")) parentEchoes++;
    }
    expect(symbolNames).toBeGreaterThan(0); // the freak lane is real
    expect(parentEchoes).toBeGreaterThan(0); // the lineage-blend lane is real
    expect(names.size).toBeGreaterThan(20); // and it is genuinely diverse
  });

  it("sports lean into freak names more than non-sports", () => {
    const freakRate = (sport: boolean) => {
      let freak = 0;
      for (let i = 0; i < 40; i++) {
        const id = designChildIdentity(ctx({ rng: seededRng(`sport-${i}`), sport }));
        if (/[^a-z0-9 ]/i.test(id.name)) freak++;
      }
      return freak / 40;
    };
    expect(freakRate(true)).toBeGreaterThanOrEqual(freakRate(false));
  });

  it("identity fields stay within protocol limits across many draws", () => {
    for (let i = 0; i < 40; i++) {
      const id = designChildIdentity(ctx({ rng: seededRng(`limits-${i}`), sport: i % 2 === 0 }));
      expect(id.ticker).toMatch(/^[A-Z0-9]{1,6}$/);
      expect(id.id).toMatch(/^g2-[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
      expect(id.xHandle).toMatch(/^[a-z0-9_]{1,15}$/);
    }
  });
});
