/**
 * The §5.4 memory stack: journal, rolling digests, self-model, birth letters, seals, and the
 * deterministic retrieval budgets. All mechanical in season 0 — the same seams the M6 LLM
 * backend fills.
 */
import { describe, expect, it } from "vitest";
import {
  birthLetter, createMemory, countTrade, journal, maintainMemory, mechanicalSelfModel,
  memoryContext, recentPostTexts, sealMemory, type MemoryState,
} from "../src/index.js";

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;

/** a memory with some traded history */
function seasoned(): MemoryState {
  const mem = createMemory(null, T0);
  countTrade(mem, { symbol: "NVDA", pnlUsd: 42, pnlPct: 0.042 });
  countTrade(mem, { symbol: "TSLA", pnlUsd: -18, pnlPct: -0.021 });
  countTrade(mem, { symbol: "NVDA", pnlUsd: 10, pnlPct: 0.011 });
  mem.counters.vetoes = 4;
  mem.counters.posts = 9;
  journal(mem, { atMs: T0, kind: "trade", text: "bought NVDA $420 — momentum fired", data: { symbol: "NVDA" } });
  journal(mem, { atMs: T0 + 1, kind: "post", text: "entered nvda. sized like i mean it." });
  journal(mem, { atMs: T0 + 2, kind: "post", text: "nvda closed +4.2%. receipts." });
  return mem;
}

describe("createMemory + journal", () => {
  it("starts blank without a letter; the letter seeds the first self-model", () => {
    const blank = createMemory(null, T0);
    expect(blank.journal).toHaveLength(0);
    expect(blank.birthLetter).toBeNull();
    expect(blank.selfModel.version).toBe(1);

    const born = createMemory("dear child — momentum paid me.", T0);
    expect(born.birthLetter).toBe("dear child — momentum paid me.");
    expect(born.selfModel.text).toContain("momentum paid me");
  });

  it("past the hard cap the oldest rows fold into a compaction note, never vanish silently", () => {
    const mem = createMemory(null, T0);
    for (let i = 0; i < 10_050; i++) {
      journal(mem, { atMs: T0 + i, kind: i % 3 === 0 ? "trade" : "post", text: `row ${i}` });
    }
    expect(mem.journal.length).toBeLessThanOrEqual(5_100);
    expect(mem.journal[0]!.kind).toBe("note");
    expect(mem.journal[0]!.text).toContain("compaction");
    expect(mem.journal[0]!.text).toContain("folded");
  });
});

describe("countTrade", () => {
  it("tracks wins, losses, best/worst, and per-symbol P&L", () => {
    const mem = seasoned();
    expect(mem.counters.trades).toBe(3);
    expect(mem.counters.wins).toBe(2);
    expect(mem.counters.losses).toBe(1);
    expect(mem.counters.bestTradePct).toBeCloseTo(0.042, 9);
    expect(mem.counters.worstTradePct).toBeCloseTo(-0.021, 9);
    expect(mem.counters.pnlBySymbol["NVDA"]).toBeCloseTo(52, 9);
    expect(mem.counters.pnlBySymbol["TSLA"]).toBeCloseTo(-18, 9);
  });
});

describe("maintainMemory — the rolling schedule", () => {
  it("closes finished days into digests and rewrites the self-model daily; idempotent in-day", () => {
    const mem = seasoned();
    maintainMemory(mem, T0 + 12 * 3_600_000); // same day: nothing rolls
    expect(mem.digests).toHaveLength(0);
    expect(mem.selfModel.version).toBe(1);

    maintainMemory(mem, T0 + DAY + 1); // next day: day-0 digest + self-model v2
    expect(mem.digests.filter((d) => d.span === "day")).toHaveLength(1);
    expect(mem.digests[0]!.text).toContain("day");
    expect(mem.selfModel.version).toBe(2);
    expect(mem.selfModel.text).toContain("self-model v2");

    const digestsAfter = mem.digests.length;
    maintainMemory(mem, T0 + DAY + 60_000); // still the same day: no re-roll
    expect(mem.digests.length).toBe(digestsAfter);
    expect(mem.selfModel.version).toBe(2);
  });

  it("seven dailies fold into a weekly; the weekly mentions the span", () => {
    const mem = seasoned();
    maintainMemory(mem, T0 + 8 * DAY); // rolls days 0..7
    const weeklies = mem.digests.filter((d) => d.span === "week");
    expect(weeklies.length).toBeGreaterThanOrEqual(1);
    expect(weeklies[0]!.text).toContain("week closing day");
    // digest retention is bounded
    expect(mem.digests.filter((d) => d.span === "day").length).toBeLessThanOrEqual(30);
  });
});

describe("self-model, letters, seals", () => {
  it("mechanicalSelfModel reads honestly off the counters", () => {
    const mem = seasoned();
    mem.selfModel = { version: 1, text: "x", updatedAtMs: T0 };
    const text = mechanicalSelfModel(mem);
    expect(text).toContain("3 trades");
    expect(text).toContain("67%");
    expect(text).toContain("what works for me: NVDA");
    expect(text).toContain("what costs me: TSLA");
  });

  it("the birth letter carries the parent's record and advice into the child", () => {
    const mem = seasoned();
    const letter = birthLetter(mem, "sigma", "sigmason");
    expect(letter).toContain("sigmason");
    expect(letter).toContain("3 trades");
    expect(letter).toContain("NVDA treated me well");
    expect(letter).toContain("TSLA cost me");
    expect(letter).toContain("— sigma");
  });

  it("death seals: final journal entry + the sealed doc carries the record and final words", () => {
    const mem = seasoned();
    const sealed = sealMemory(mem, { name: "sigma", cause: "ruin", finalWords: "farewell.", bornAtMs: T0, diedAtMs: T0 + 5 * DAY });
    expect(mem.journal[mem.journal.length - 1]!.kind).toBe("death");
    expect(sealed).toContain("sealed self-model of sigma");
    expect(sealed).toContain("ruin");
    expect(sealed).toContain("5 days");
    expect(sealed).toContain("farewell.");
  });
});

describe("retrieval budgets (deterministic, per call type)", () => {
  it("gate gets compact counters + latest digest within budget", () => {
    const mem = seasoned();
    maintainMemory(mem, T0 + DAY + 1);
    const ctx = memoryContext(mem, "gate");
    expect(ctx.length).toBeLessThanOrEqual(500);
    expect(ctx).toContain("t:3");
    expect(ctx).toContain("day");
  });

  it("post gets recent own posts within budget; review gets the large window", () => {
    const mem = seasoned();
    const post = memoryContext(mem, "post");
    expect(post.length).toBeLessThanOrEqual(900);
    expect(post).toContain("receipts");
    expect(memoryContext(mem, "review").length).toBeLessThanOrEqual(4000);
    expect(recentPostTexts(mem, 1)).toEqual(["nvda closed +4.2%. receipts."]);
  });
});
