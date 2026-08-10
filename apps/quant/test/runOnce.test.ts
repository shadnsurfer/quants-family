/**
 * runQuantOnce integration on the deterministic fixture (PROJECT.md §5.1, M2).
 * Drives a tuned kelly-style genome (the retired first-generation design, inlined 2026-08-02
 * when the design files were retired — the tests' point is runtime behavior, not the file)
 * and targeted variants over the recorded-price fixture: fixture legs referenced in comments
 * come from packages/paper/src/fixture.ts DRIFT_LEGS (NVDA rises ticks 4–14, falls 15–19;
 * TSLA rises 6–16, falls 17–24). All runs are fully deterministic — no tolerance games.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SIGNAL_GENES, parseGenome, type Genome } from "@quants/core";
import { FIXTURE_EPOCH_MS, midSeries, quoteAt, resetFixture } from "@quants/paper";
import { guardTweet } from "@quants/brain";
import {
  getSessionMemory,
  inspectSession,
  resetQuantSessions,
  restoreQuantSession,
  runQuantOnce,
  serializeQuantSessions,
  signalExit,
  type PriceView,
  type RunOnceResult,
  type TradeOut,
  type TweetOut,
} from "../src/index.js";

/** The tuned fixture genome (formerly data/genesis/kelly.json, retired with the design files). */
function kelly(): Genome {
  return parseGenome({
    meta: { id: "g1-kelly", name: "kelly", ticker: "KELLY", generation: 1, parents: [] },
    edge: {
      archetype: "momentum", universe: ["NVDA", "TSLA", "PLTR"], aggression: 0.85,
      patience: { minHoldMin: 30, maxHoldHrs: 48 }, fear: 0.05, conviction: 0.12,
      cadenceMin: 20, darkHours: 0.5, entryThesisStyle: "strict-confluence",
      researchStyle: "priceAction", flowWeight: 0, flowSkepticism: 0.5,
      signal: { momentumEntryPct: 0.012 }, // the retired design's signature: faster trigger than the 0.015 default
    },
    voice: { archetype: "cocky", postsPerDay: 6, flexStyle: "receipts-only", beefiness: 0.3, lowercase: true, emojiPolicy: "none" },
  });
}

/** kelly with a fresh id and targeted gene overrides (full patience object when overridden). */
function variant(id: string, edgeOver: Partial<Genome["edge"]> = {}, voiceOver: Partial<Genome["voice"]> = {}): Genome {
  const g = kelly();
  return {
    meta: { ...g.meta, id },
    edge: { ...g.edge, ...edgeOver },
    voice: { ...g.voice, ...voiceOver },
  };
}

async function runTicks(genome: Genome, n: number, seedUsd?: number): Promise<RunOnceResult[]> {
  const out: RunOnceResult[] = [];
  for (let tick = 0; tick < n; tick++) {
    out.push(await runQuantOnce({ genome, mode: "paper", tick, ...(seedUsd !== undefined ? { seedUsd } : {}) }));
  }
  return out;
}

type TradeRow = TradeOut & { tick: number };
type TweetRow = TweetOut & { tick: number };
const tradesOf = (rs: readonly RunOnceResult[]): TradeRow[] =>
  rs.flatMap((r) => (r.trade ? [{ ...r.trade, tick: r.tick }] : []));
const tweetsOf = (rs: readonly RunOnceResult[]): TweetRow[] =>
  rs.flatMap((r) => (r.tweet ? [{ ...r.tweet, tick: r.tick }] : []));

beforeEach(() => {
  resetQuantSessions();
  resetFixture();
});

describe("the 40-tick smoke window (mirrors build/scripts/smoke-quant.mjs)", () => {
  it("kelly makes ≥3 trades, ≥1 clean tweet, and ends solvent", async () => {
    const rs = await runTicks(kelly(), 40);
    expect(rs).toHaveLength(40);
    rs.forEach((r, i) => expect(r.tick).toBe(i));

    const ts = tradesOf(rs);
    expect(ts.length).toBeGreaterThanOrEqual(3);
    expect(ts.some((t) => t.side === "buy")).toBe(true);

    const sells = ts.filter((t) => t.side === "sell");
    expect(sells.length).toBeGreaterThanOrEqual(1);
    for (const s of sells) {
      expect(["stop", "trail", "max-hold", "signal"]).toContain(s.reason);
      expect(s.pnlUsd).toBeTypeOf("number");
      expect(s.pnlPct).toBeTypeOf("number");
    }

    // the agent's own cap: no buy may exceed its aggression-mapped share of the same tick's
    // marked equity (kelly 0.85 → 85%), and never more than the book holds
    const { aggressionToPositionPct } = await import("@quants/core");
    for (const r of rs) {
      if (r.trade?.side === "buy") {
        expect(r.trade.notionalUsd).toBeLessThanOrEqual(aggressionToPositionPct(0.85) * r.equityUsd + 1e-6);
        expect(r.trade.notionalUsd).toBeLessThanOrEqual(r.equityUsd + 1e-6);
      }
    }

    expect(tweetsOf(rs).filter((t) => !t.rejected).length).toBeGreaterThanOrEqual(1);

    const last = rs[39];
    expect(last).toBeDefined();
    expect(Number.isFinite(last!.equityUsd)).toBe(true);
    expect(last!.equityUsd).toBeGreaterThan(0);
  });

  it("is deterministic: two full 40-tick runs are deep-equal", async () => {
    const first = await runTicks(kelly(), 40);
    resetQuantSessions();
    resetFixture();
    const second = await runTicks(kelly(), 40);
    expect(second).toEqual(first);
  });
});

/** an injected market: quotes + series from one crafted mid path (scenario tests) */
function viewOf(path: readonly number[]): PriceView {
  return {
    quoteFor: (_s, t) => ({ symbol: "NVDA", mid: path[t]!, spreadBps: 10 }),
    seriesFor: (_s, t) => path.slice(0, t + 1),
  };
}

async function runPath(genome: Genome, path: readonly number[]): Promise<RunOnceResult[]> {
  const out: RunOnceResult[] = [];
  for (let tick = 0; tick < path.length; tick++) {
    out.push(await runQuantOnce({ genome, mode: "paper", tick, prices: viewOf(path) }));
  }
  return out;
}

describe("exits", () => {
  it("fear=0.25 never stops out on the fixture's gentle drifts", async () => {
    const rs = await runTicks(variant("t-maxfear", { fear: 0.25 }), 40);
    const ts = tradesOf(rs);
    expect(ts.filter((t) => t.side === "buy").length).toBeGreaterThanOrEqual(1); // non-vacuous
    expect(ts.filter((t) => t.reason === "stop")).toHaveLength(0);
  });

  it("fear=0.01 stops out on a plunge, and stop outranks the signal-exit", async () => {
    // Injected path: flat, a ramp (the entry fires), then a plunge through the 1% stop.
    // minHold 720 parks the signal-exit; conviction 0.5 keeps the trail unarmed — "stop"
    // is the only exit that can fire, on a path no fixture leg can produce (the fixture's
    // falling legs are too short to reach −1% under an early entry; pre-B2b this scenario
    // was engineered through take-profit recycling, which the trail replaced).
    const g = variant("t-stop", {
      universe: ["NVDA"], fear: 0.01, conviction: 0.5,
      patience: { minHoldMin: 720, maxHoldHrs: 168 },
    });
    const path = [100, 100, 100, 100, 101.3, 102.6, 103.9, 100.5, 99.2, 98.1];
    const rs = await runPath(g, path);
    const stop = tradesOf(rs).find((t) => t.reason === "stop");
    expect(stop).toBeDefined();
    expect(stop!.side).toBe("sell");
    expect(stop!.symbol).toBe("NVDA");
    expect(stop!.tick).toBeGreaterThanOrEqual(7); // on the plunge, past the ramp
    expect(stop!.pnlPct).toBeLessThan(0); // a 1% stop realizes a loss

    // at the stop tick the momentum signal-exit condition ALSO held (blocked only by
    // minHold): reporting "stop" pins the §5.1 exit priority stop → trail → max-hold → signal.
    expect(signalExit(g.edge, path.slice(0, stop!.tick + 1))).toBe(true);
  });

  it("conviction 0.02 arms the trail; the falling leg banks the run at peak×(1−fear)", async () => {
    // B2b trailing take-profit on the NVDA fixture (rises ticks 4–14, falls 15–19): entry
    // on the rising leg, armed at +2% (conviction), and the falling leg gives back 2%
    // (fear) from the peak — the trail banks the winner instead of taking a fixed target.
    const g = variant("t-trail", { universe: ["NVDA"], conviction: 0.02, fear: 0.02 });
    const rs = await runTicks(g, 40);
    const ts = tradesOf(rs);
    expect(ts.filter((t) => t.side === "buy").length).toBeGreaterThanOrEqual(1); // non-vacuous

    const trail = ts.find((t) => t.reason === "trail");
    expect(trail).toBeDefined();
    expect(trail!.side).toBe("sell");
    expect(trail!.tick).toBeGreaterThanOrEqual(15); // the falling leg, after the run
    expect(trail!.tick).toBeLessThanOrEqual(19);
    expect(trail!.pnlPct).toBeGreaterThan(0); // the trail banks a winner, not a fixed target
  });

  it("maxHoldHrs=1 at cadence 20 force-exits every position exactly 3 ticks after entry", async () => {
    // minHold 120 > 60 blocks signal-exits; fear .25 / conviction .5 are unreachable in 3
    // gentle ticks — "max-hold" is the only exit that can fire, at 3 × 20min = 60min held.
    const g = variant("t-maxhold", {
      universe: ["NVDA"],
      fear: 0.25,
      conviction: 0.5,
      patience: { minHoldMin: 120, maxHoldHrs: 1 },
    });
    const rs = await runTicks(g, 40);
    const ts = tradesOf(rs);
    const sells = ts.filter((t) => t.side === "sell");
    expect(sells.length).toBeGreaterThanOrEqual(2);
    for (const [i, t] of ts.entries()) {
      if (t.side !== "sell") continue;
      expect(t.reason).toBe("max-hold");
      const entry = ts[i - 1]; // single-symbol universe → strict buy/sell alternation
      expect(entry?.side).toBe("buy");
      expect(t.tick - entry!.tick).toBe(3);
    }
  });

  it("signal-exits never fire before minHoldMin has elapsed", async () => {
    // fear .25 / conviction .5 / maxHold 168h make "signal" the only reason that can apply.
    // With minHold 720 (36 ticks at cadence 20) the TSLA position opened on the rising leg
    // must sit through the whole 17–24 falling leg untouched…
    const blocked = variant("t-minhold-block", {
      universe: ["TSLA"],
      fear: 0.25,
      conviction: 0.5,
      patience: { minHoldMin: 720, maxHoldHrs: 168 },
    });
    const rs = await runTicks(blocked, 40);
    const ts = tradesOf(rs);
    const buys = ts.filter((t) => t.side === "buy");
    expect(buys).toHaveLength(1);
    expect(ts.filter((t) => t.side === "sell")).toHaveLength(0);

    // …even though the momentum exit condition provably held on ticks it was holding:
    const buyTick = buys[0]!.tick;
    const exitableTicks: number[] = [];
    for (let t = buyTick + 1; t < 40; t++) {
      if (signalExit(blocked.edge, midSeries("TSLA", t))) exitableTicks.push(t);
    }
    expect(exitableTicks.length).toBeGreaterThan(0);
    // premise check: no held tick ever reached the 720-min floor — minHold was the ONLY blocker
    expect((39 - buyTick) * blocked.edge.cadenceMin).toBeLessThan(720);

    // contrast: with the floor at 5 min the same genes DO signal-exit, past the floor
    resetQuantSessions();
    const free = variant("t-minhold-free", {
      universe: ["TSLA"],
      fear: 0.25,
      conviction: 0.5,
      patience: { minHoldMin: 5, maxHoldHrs: 168 },
    });
    const rs2 = await runTicks(free, 40);
    const ts2 = tradesOf(rs2);
    const signalSells = ts2.filter((t) => t.side === "sell" && t.reason === "signal");
    expect(signalSells.length).toBeGreaterThan(0);
    for (const s of signalSells) {
      const entriesBefore = ts2.filter((t) => t.side === "buy" && t.tick < s.tick);
      const entry = entriesBefore[entriesBefore.length - 1];
      expect(entry).toBeDefined();
      expect((s.tick - entry!.tick) * free.edge.cadenceMin).toBeGreaterThanOrEqual(free.edge.patience.minHoldMin);
    }
  });
});

describe("decision theses (A4): every decision is broadcast with its voiced reasoning", () => {
  it("every trade — entry and exit — carries a non-empty voiced thesis", async () => {
    const rs = await runTicks(kelly(), 40);
    const ts = tradesOf(rs);
    expect(ts.length).toBeGreaterThanOrEqual(3);
    for (const t of ts) {
      expect(t.thesis, `trade ${t.side} ${t.symbol} @tick ${t.tick} missing its thesis`).toBeDefined();
      expect(t.thesis!.length).toBeGreaterThan(20);
    }
    expect(ts.some((t) => t.side === "buy")).toBe(true); // entry theses exercised
    expect(ts.some((t) => t.side === "sell")).toBe(true); // exit theses exercised
  });

  it("a stop exit's thesis names the fear line it crossed, with the gene's own number", async () => {
    // the same injected plunge as the stop test above — the thesis must disclose the gene
    const g = variant("t-stop-thesis", {
      universe: ["NVDA"], fear: 0.01, conviction: 0.5,
      patience: { minHoldMin: 720, maxHoldHrs: 168 },
    });
    const path = [100, 100, 100, 100, 101.3, 102.6, 103.9, 100.5, 99.2, 98.1];
    const rs = await runPath(g, path);
    const stop = tradesOf(rs).find((t) => t.reason === "stop");
    expect(stop).toBeDefined();
    expect(stop!.thesis).toContain("fear line");
    expect(stop!.thesis).toContain("-1%"); // fear 0.01 → the disclosed gene value
  });

  it("a gated-off setup is broadcast as a veto with its voiced reasoning", async () => {
    // darkHours 0 → any off-hours signal is scaled to strength 0 and the gate vetoes it.
    // The injected series is a clean rising leg that WOULD enter in daylight — the veto is
    // purely the dark-hours gene talking, exactly the reasoning the feed must show.
    const g = variant("t-veto", { universe: ["NVDA"], darkHours: 0 });
    const nightMs = FIXTURE_EPOCH_MS - 4 * 3_600_000; // 05:30 — off-hours
    const prices: PriceView = {
      quoteFor: (symbol, tick) => quoteAt(symbol, tick),
      seriesFor: () => [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122],
    };
    const r = await runQuantOnce({ genome: g, mode: "paper", tick: 0, nowMs: nightMs, prices });
    expect(r.trade).toBeUndefined();
    expect(r.veto).toBeDefined();
    expect(r.veto!.symbol).toBe("NVDA");
    expect(r.veto!.thesis).toContain("too weak vs costs");
  });
});

describe("tweet budget and cadence", () => {
  it("postsPerDay=1 caps the whole 40-tick window (one sim-day) at one tweet", async () => {
    // ticks 0..39 at cadence 20 span 780 sim-minutes < 1440 — a single dayIndex.
    const rs = await runTicks(variant("t-budget", {}, { postsPerDay: 1 }), 40);
    // premise: the halt override (the only thing allowed past the budget) never fires here
    expect(rs.every((r) => !r.halted)).toBe(true);
    const tw = tweetsOf(rs);
    expect(tw).toHaveLength(1);
    expect(tw[0]!.rejected).toBe(false);
    expect(tw[0]!.kind).not.toBe("halt");
  });

  it("idle posts appear only on tick % 5 === 2 (A4 cadence), and the daily budget is never exceeded", async () => {
    const g = kelly(); // postsPerDay 6
    const rs = await runTicks(g, 40);
    expect(rs.every((r) => !r.halted)).toBe(true);
    const tw = tweetsOf(rs);
    const idles = tw.filter((t) => t.kind === "idle");
    expect(idles.length).toBeGreaterThanOrEqual(1);
    for (const t of idles) expect(t.tick % 5).toBe(2);
    expect(tw.length).toBeLessThanOrEqual(g.voice.postsPerDay); // single sim-day, no halt override
  });
});

describe("guard wiring", () => {
  it("every returned tweet's rejected flag matches an independent guard re-check", async () => {
    const g = kelly();
    const rs = await runTicks(g, 40);
    const tw = tweetsOf(rs);
    expect(tw.length).toBeGreaterThanOrEqual(1);
    for (const t of tw) {
      expect(guardTweet(t.text, { ticker: g.meta.ticker }).ok).toBe(!t.rejected);
    }
    // composer templates must be guard-clean; any rejection here is composer/guard drift
    expect(tw.filter((t) => t.rejected)).toHaveLength(0);

    // the oracle must bite, or the loop above proves nothing: canned §5.3 violations…
    const ticker = { ticker: g.meta.ticker };
    expect(guardTweet("buy now before it pumps", ticker).ok).toBe(false); // buy urging
    expect(guardTweet("$KELLY chart looks ready", ticker).ok).toBe(false); // own-token price talk
    expect(guardTweet("hold this for guaranteed returns", ticker).ok).toBe(false); // return promise
    expect(guardTweet("nvda will 10x by friday", ticker).ok).toBe(false); // price prediction
    // …while factual P&L (a real exit-template shape) passes
    expect(guardTweet("closed nvda +5.4%. size was the strategy. it usually is.", ticker).ok).toBe(true);
  });
});

describe("mode gate", () => {
  it("rejects mode:'live' with the Phase-6 message and leaves no session behind", async () => {
    await expect(runQuantOnce({ genome: kelly(), mode: "live", tick: 0 } as never)).rejects.toThrow(
      /Phase 6 checklist/,
    );
    expect(inspectSession("g1-kelly")).toBeNull();
  });
});

describe("§5.4 memory (B2a): journal, counters, letters, persistence", () => {
  it("journals decisions and counts trades across ticks; survives serialize → restore", async () => {
    await runTicks(kelly(), 40);
    const mem = getSessionMemory("g1-kelly");
    expect(mem).toBeDefined();
    expect(mem!.counters.trades).toBeGreaterThanOrEqual(3);
    expect(mem!.journal.some((e) => e.kind === "trade")).toBe(true);
    expect(mem!.journal.some((e) => e.kind === "post")).toBe(true);
    expect(mem!.counters.posts).toBeGreaterThanOrEqual(1);

    const snap = serializeQuantSessions();
    resetQuantSessions();
    restoreQuantSession(kelly(), snap["g1-kelly"]!);
    const restored = getSessionMemory("g1-kelly")!;
    expect(restored.counters.trades).toBe(mem!.counters.trades);
    expect(restored.journal.length).toBe(mem!.journal.length);
  });

  it("a birth letter seeds the child's first self-model", async () => {
    await runQuantOnce({ genome: variant("t-letter", {}), mode: "paper", tick: 0, birthLetter: "dear child — momentum paid me." });
    const mem = getSessionMemory("t-letter")!;
    expect(mem.birthLetter).toBe("dear child — momentum paid me.");
    expect(mem.selfModel.text).toContain("momentum paid me");
  });

  it("pre-B2 restore without memory starts clean — cursors pinned, no backfill digests", async () => {
    await runTicks(variant("t-legacy", {}), 5);
    const snap = serializeQuantSessions();
    delete snap["t-legacy"]!.memory; // simulate a pre-B2 world row
    resetQuantSessions();
    restoreQuantSession(variant("t-legacy", {}), snap["t-legacy"]!, FIXTURE_EPOCH_MS + 5 * 20 * 60_000);
    const mem = getSessionMemory("t-legacy")!;
    expect(mem.journal).toHaveLength(0);
    expect(mem.selfModel.version).toBe(1);
    // next tick maintains from "now": at most one day closes, never a 90-day backfill
    await runQuantOnce({ genome: variant("t-legacy", {}), mode: "paper", tick: 5 });
    expect(getSessionMemory("t-legacy")!.digests.length).toBeLessThanOrEqual(1);
  });
});

describe("session persistence and seeding", () => {
  it("state persists across calls keyed by meta.id — a position opened one tick survives the next", async () => {
    // a FRESH genome object is passed on every call: continuity must come from the session
    // registry (meta.id), never from object identity.
    const mk = (): Genome => variant("t-persist", { universe: ["PLTR"] });

    for (let tick = 0; tick < 3; tick++) {
      const r = await runQuantOnce({ genome: mk(), mode: "paper", tick });
      expect(r.trade).toBeUndefined(); // momentum needs 4 points of history — no entry yet
    }
    expect(inspectSession("t-persist")).toEqual({ equityUsd: 1_000, positions: 0, fills: 0, guardRejections: 0 });

    const r3 = await runQuantOnce({ genome: mk(), mode: "paper", tick: 3 });
    expect(r3.trade?.side).toBe("buy");
    expect(r3.trade?.symbol).toBe("PLTR");
    expect(inspectSession("t-persist")).toMatchObject({ positions: 1, fills: 1 });

    const r4 = await runQuantOnce({ genome: mk(), mode: "paper", tick: 4 });
    expect(r4.trade).toBeUndefined(); // held symbol excluded; no exit can fire this early
    expect(inspectSession("t-persist")).toMatchObject({ positions: 1, fills: 1 });
  });

  it("the first call's seedUsd wins; later seeds are ignored", async () => {
    const r0 = await runQuantOnce({ genome: kelly(), mode: "paper", tick: 0, seedUsd: 5_000 });
    expect(r0.equityUsd).toBe(5_000);
    const r1 = await runQuantOnce({ genome: kelly(), mode: "paper", tick: 1, seedUsd: 111 });
    expect(r1.equityUsd).toBe(5_000); // cash-only equity: exact
    expect(inspectSession("g1-kelly")?.equityUsd).toBe(5_000);
  });
});
