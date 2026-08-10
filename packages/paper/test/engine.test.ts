/**
 * PaperEngine (PROJECT.md §5.2): execution-level enforcement of every §4.2 guardrail,
 * exact fill math (mid ± half-spread + size slippage), cash/position accounting, the
 * daily-loss halt lifecycle, and full determinism under replay.
 *
 * Scenario inputs are DERIVED from GUARDRAILS so the tests exercise the engine's
 * coupling to the frozen constants; the "§4.2 pins" block hardcodes the spec values so
 * this suite ALSO fails loudly if anyone edits a guardrail. Never weaken either side.
 *
 * `cashUsd` is a public field (fee routing and death sweeps adjust it externally), so
 * tests poke it directly where an exact equity level is needed. No wall clock anywhere.
 */
import { describe, expect, it } from "vitest";
import { GUARDRAILS } from "@quants/core";
import {
  FIXTURE_EPOCH_MS,
  PaperEngine,
  quoteAt,
  resetFixture,
  type Fill,
  type Quote,
  type RejectReason,
  type TradeResult,
} from "../src/index.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const T0 = FIXTURE_EPOCH_MS;
const [NVDA, SPCX, TSLA, AAPL, GME] = GUARDRAILS.venueWhitelist;

function q(symbol: string, mid: number, spreadBps: number): Quote {
  return { symbol, mid, spreadBps };
}
function qmap(...quotes: Quote[]): Map<string, Quote> {
  return new Map(quotes.map((x) => [x.symbol, x]));
}
function fillOf(res: TradeResult): Fill {
  if (!res.ok) throw new Error(`expected a fill, got reject: ${res.reason}`);
  return res.fill;
}
function rejectOf(res: TradeResult): RejectReason {
  if (res.ok) throw new Error(`expected a reject, got a ${res.fill.side} fill`);
  return res.reason;
}
/** The documented execution-penalty model, re-derived independently of the engine. */
function expectedSlip(spreadBps: number, notionalUsd: number): number {
  return spreadBps / 2 / 10_000 + (notionalUsd / 10_000) * 0.0002;
}
function buy(
  eng: PaperEngine,
  symbol: string,
  notionalUsd: number,
  quote: Quote,
  nowMs: number,
  tick = 0,
): TradeResult {
  return eng.tryBuy({ symbol, notionalUsd, quote, nowMs, tick });
}
function sell(eng: PaperEngine, symbol: string, quote: Quote, nowMs: number, tick = 0): TradeResult {
  return eng.trySell({ symbol, quote, nowMs, tick, reason: "signal" });
}

describe("system-rule pins", () => {
  it("GUARDRAILS carry exactly the three frozen system rules (2026-08-02 model)", () => {
    expect(GUARDRAILS.slippageCapPct).toBe(0.015);
    expect(GUARDRAILS.thinLiquiditySpreadBps).toBe(80);
    expect(GUARDRAILS.thinLiquiditySizeFactor).toBe(0.5);
    // the species-level caps are gone — sizing, breadth, and daily-loss behavior are genes
    expect(GUARDRAILS).not.toHaveProperty("maxPositionPctEquity");
    expect(GUARDRAILS).not.toHaveProperty("maxOpenPositions");
    expect(GUARDRAILS).not.toHaveProperty("dailyLossHaltPct");
    expect(Object.isFrozen(GUARDRAILS)).toBe(true);
    expect(Object.isFrozen(GUARDRAILS.venueWhitelist)).toBe(true);
    expect([NVDA, SPCX, TSLA, AAPL, GME]).toEqual(["NVDA", "SPCX", "TSLA", "AAPL", "GME"]);
    expect(GUARDRAILS.venueWhitelist).not.toContain("HOOD"); // Robinhood does not tokenize itself
    expect(GUARDRAILS.venueWhitelist.length).toBe(94); // the canonical verified registry
    expect(GUARDRAILS.venueWhitelist).not.toContain("ENRN");
  });
});

describe("construction", () => {
  it("seed → cash = equity = seed, with a clean snapshot and a flat first mark", () => {
    const eng = new PaperEngine({ seedUsd: 1_000, startMs: T0 });
    expect(eng.cashUsd).toBe(1_000);
    expect(eng.equityUsd(new Map())).toBe(1_000);
    expect(eng.snapshot()).toEqual({
      seedUsd: 1_000,
      cashUsd: 1_000,
      realizedPnlUsd: 0,
      lastEquityUsd: 1_000,
      positions: [],
      fillCount: 0,
    });
    expect(eng.markToMarket(new Map(), T0)).toEqual({
      equityUsd: 1_000,
      dayPnlPct: 0,
    });
  });
});

describe("guardrail: venue whitelist", () => {
  it("rejects a non-whitelisted symbol outright, recording nothing", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    const res = buy(eng, "ENRN", 500, q("ENRN", 50, 20), T0, 0);
    expect(res).toEqual({ ok: false, reason: "not-whitelisted" });
    expect(eng.cashUsd).toBe(10_000);
    expect(eng.fills).toHaveLength(0);
    expect(eng.positions.size).toBe(0);
  });
});

describe("no species daily-loss halt (2026-08-02: per-agent limits are genes)", () => {
  it("entries are never halted by the engine; day P&L is still reported for the gate", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    eng.markToMarket(qmap(q(NVDA, 100, 20)), T0);
    fillOf(buy(eng, NVDA, 5_000, q(NVDA, 100, 20), T0, 0));

    // crash the only position → deep intraday loss: the engine still takes the next entry
    const tCrash = T0 + 2 * HOUR_MS;
    const m2 = eng.markToMarket(qmap(q(NVDA, 40, 20)), tCrash);
    expect(m2.dayPnlPct).toBeLessThan(-0.08);
    expect(buy(eng, TSLA, 500, q(TSLA, 100, 20), tCrash, 2).ok).toBe(true);
    // risk-reducing exits always work
    expect(eng.trySell({ symbol: NVDA, quote: q(NVDA, 40, 20), nowMs: tCrash, tick: 2, reason: "stop" }).ok).toBe(true);
  });
});

describe("no open-position cap (2026-08-02: breadth is the agent's own)", () => {
  it("five distinct symbols all fill; only cash binds", () => {
    const eng = new PaperEngine({ seedUsd: 100_000, startMs: T0 });
    for (const [i, sym] of [NVDA, SPCX, TSLA, AAPL, GME].entries()) {
      expect(buy(eng, sym, 1_000, q(sym, 100, 20), T0, i).ok).toBe(true);
    }
    expect(eng.positions.size).toBe(5);
    // adding to an existing symbol pools into the same position
    expect(buy(eng, NVDA, 1_000, q(NVDA, 100, 20), T0, 5).ok).toBe(true);
    expect(eng.positions.size).toBe(5);
  });
});

describe("guardrail: thin liquidity", () => {
  it("spread one bp above the threshold halves the requested size", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    const f = fillOf(buy(eng, NVDA, 1_000, q(NVDA, 100, GUARDRAILS.thinLiquiditySpreadBps + 1), T0, 0));
    expect(f.thinned).toBe(true);
    expect(f.notionalUsd).toBe(1_000 * GUARDRAILS.thinLiquiditySizeFactor);
  });

  it("spread exactly at the threshold is NOT thinned (strict >)", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    const f = fillOf(buy(eng, NVDA, 1_000, q(NVDA, 100, GUARDRAILS.thinLiquiditySpreadBps), T0, 0));
    expect(f.thinned).toBe(false);
    expect(f.notionalUsd).toBe(1_000);
  });

  it("the fixture's 13th-tick spread spike triggers thinning end-to-end", () => {
    resetFixture();
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    const f = fillOf(buy(eng, NVDA, 1_000, quoteAt(NVDA, 13), T0, 13)); // 95bps by construction
    expect(f.thinned).toBe(true);
    expect(f.notionalUsd).toBe(1_000 * GUARDRAILS.thinLiquiditySizeFactor);
  });
});

describe("no species position cap (2026-08-02: sizing is the agent's own genome)", () => {
  it("a 50%-of-equity request fills in full (cents-quantized)", () => {
    const seed = 10_000;
    const eng = new PaperEngine({ seedUsd: seed, startMs: T0 });
    const f = fillOf(buy(eng, NVDA, seed * 0.5, q(NVDA, 100, 20), T0, 0));
    expect(f.notionalUsd).toBe(5_000);
  });

  it("an 85%-of-equity request fills — the agent's aggression is the only cap; ruin is the arena's answer", () => {
    const seed = 10_000;
    const eng = new PaperEngine({ seedUsd: seed, startMs: T0 });
    const f = fillOf(buy(eng, NVDA, seed * 0.85, q(NVDA, 100, 20), T0, 0));
    expect(f.notionalUsd).toBe(8_500);
    expect(eng.cashUsd).toBe(1_500);
  });

  it("only cash binds: a request bigger than the book clamps to cash, not to any percentage", () => {
    const seed = 10_000;
    const eng = new PaperEngine({ seedUsd: seed, startMs: T0 });
    fillOf(buy(eng, NVDA, 6_000, q(NVDA, 100, 20), T0, 0));
    const f2 = fillOf(buy(eng, TSLA, 6_000, q(TSLA, 100, 20), T0, 1));
    expect(f2.notionalUsd).toBe(4_000);
  });
});

describe("guardrail: slippage cap", () => {
  // half-spread alone breaches/undershoots the 1.5% cap on either side of ~300bps
  const rejectSpreadBps = GUARDRAILS.slippageCapPct * 2 * 10_000 + 1; // 301
  const acceptSpreadBps = GUARDRAILS.slippageCapPct * 2 * 10_000 - 1; // 299

  it("rejects when half-spread + size slippage exceeds the cap", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    expect(rejectOf(buy(eng, NVDA, 100, q(NVDA, 100, rejectSpreadBps), T0, 0))).toBe("slippage-cap");
    expect(eng.fills).toHaveLength(0);
    expect(eng.cashUsd).toBe(10_000);
  });

  it("fills just under the cap and records the slippage honestly", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    const f = fillOf(buy(eng, NVDA, 100, q(NVDA, 100, acceptSpreadBps), T0, 0));
    // 299bps also trips the thin-liquidity rule, so the executed notional is halved
    expect(f.thinned).toBe(true);
    expect(f.notionalUsd).toBe(100 * GUARDRAILS.thinLiquiditySizeFactor);
    const slip = expectedSlip(acceptSpreadBps, f.notionalUsd);
    expect(slip).toBeLessThanOrEqual(GUARDRAILS.slippageCapPct);
    expect(f.slippageBps).toBe(Math.round(slip * 10_000));
  });

  it("rejects monster size even at a tight spread (size slippage alone breaches the cap)", () => {
    const eng = new PaperEngine({ seedUsd: 10_000_000, startMs: T0 });
    // sizeSlip = notional/1e4 * 0.0002 → >1.5% needs > $750k; the 15% cap here is $1.5M
    expect(rejectOf(buy(eng, NVDA, 1_000_000, q(NVDA, 100, 20), T0, 0))).toBe("slippage-cap");
  });
});

describe("cash constraints", () => {
  it("clamps notional to available cash when cash binds before the cap", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    eng.cashUsd = 100; // externally drained; cap is still 15% of $10k marked equity
    const f = fillOf(buy(eng, NVDA, 1_000, q(NVDA, 100, 20), T0, 0));
    expect(f.notionalUsd).toBe(100);
    expect(eng.cashUsd).toBe(0);
  });

  it("cash under $1 → insufficient-cash", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    eng.cashUsd = 0.75;
    expect(rejectOf(buy(eng, NVDA, 1_000, q(NVDA, 100, 20), T0, 0))).toBe("insufficient-cash");
  });
});

describe("fill math (hand-computed)", () => {
  it("buy executes at mid*(1+slip): slip = spread/2/1e4 + notional/1e4 * 0.0002", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    const f = fillOf(buy(eng, NVDA, 1_000, q(NVDA, 200, 40), T0, 3));
    // halfSpread = 40/2/1e4 = 0.002 ; sizeSlip = 1000/1e4*0.0002 = 0.00002 → slip = 0.00202
    const slip = expectedSlip(40, 1_000);
    expect(f.price).toBeCloseTo(200 * (1 + slip), 10);
    expect(f.price).toBeCloseTo(200.404, 10);
    expect(f.qty).toBeCloseTo(1_000 / 200.404, 10);
    expect(f.notionalUsd).toBe(1_000);
    expect(f.slippageBps).toBe(20); // round(0.00202 * 1e4) = round(20.2)
    expect(f.side).toBe("buy");
    expect(f.tick).toBe(3);
    expect(f.thinned).toBe(false);
  });

  it("sell executes at mid*(1-slip), slip sized on gross notional at mid", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    const bought = fillOf(buy(eng, NVDA, 1_000, q(NVDA, 200, 40), T0, 0));
    const f = fillOf(sell(eng, NVDA, q(NVDA, 210, 40), T0 + HOUR_MS, 9));
    const gross = bought.qty * 210;
    const slip = expectedSlip(40, gross);
    const price = 210 * (1 - slip);
    expect(f.price).toBeCloseTo(price, 10);
    expect(f.qty).toBeCloseTo(bought.qty, 12);
    expect(f.notionalUsd).toBe(Math.round(bought.qty * price * 100) / 100); // cents-quantized proceeds
    expect(f.slippageBps).toBe(Math.round(slip * 10_000));
    expect(f.side).toBe("sell");
    expect(f.tick).toBe(9);
    expect(f.reason).toBe("signal");
  });
});

describe("accounting", () => {
  it("buy moves exactly the executed notional from cash into the position", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    const cashBefore = eng.cashUsd;
    const f = fillOf(buy(eng, NVDA, 1_200, q(NVDA, 100, 30), T0 + 5_000, 7));
    expect(eng.cashUsd).toBe(cashBefore - f.notionalUsd);
    const pos = eng.positions.get(NVDA)!;
    expect(pos.entryNotionalUsd).toBe(f.notionalUsd);
    expect(pos.entryPrice).toBe(f.price);
    expect(pos.qty).toBe(f.qty);
    expect(pos.openedMs).toBe(T0 + 5_000);
    expect(pos.openedTick).toBe(7);
  });

  it("sell returns proceeds to cash, removes the position, and books P&L against entry notional", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    const bought = fillOf(buy(eng, NVDA, 1_000, q(NVDA, 100, 20), T0, 0));
    const cashBefore = eng.cashUsd;
    const f = fillOf(sell(eng, NVDA, q(NVDA, 110, 20), T0 + HOUR_MS, 1));
    expect(eng.cashUsd).toBe(cashBefore + f.notionalUsd);
    expect(eng.positions.has(NVDA)).toBe(false);
    expect(f.pnlUsd).toBeCloseTo(f.notionalUsd - bought.notionalUsd, 10);
    expect(f.pnlUsd!).toBeGreaterThan(0);
    expect(f.pnlPct).toBeCloseTo(f.pnlUsd! / bought.notionalUsd, 12);
    expect(eng.realizedPnlUsd).toBeCloseTo(f.pnlUsd!, 12);
  });

  it("realized P&L accumulates across wins and losses; cash reconciles to seed + realized", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    fillOf(buy(eng, NVDA, 1_000, q(NVDA, 200, 40), T0, 0));
    const win = fillOf(sell(eng, NVDA, q(NVDA, 210, 40), T0, 1));
    fillOf(buy(eng, TSLA, 800, q(TSLA, 100, 20), T0, 2));
    const loss = fillOf(sell(eng, TSLA, q(TSLA, 90, 20), T0, 3));
    expect(win.pnlUsd!).toBeGreaterThan(0);
    expect(loss.pnlUsd!).toBeLessThan(0);
    expect(loss.pnlPct!).toBeLessThan(0);
    expect(eng.realizedPnlUsd).toBeCloseTo(win.pnlUsd! + loss.pnlUsd!, 10);
    // conservation: flat book → every dollar is either seed or booked P&L
    expect(eng.cashUsd).toBeCloseTo(10_000 + eng.realizedPnlUsd, 8);
    expect(eng.snapshot().fillCount).toBe(4);
  });

  it("averaging: a second buy in the same symbol pools qty, notional, and entry price", () => {
    const eng = new PaperEngine({ seedUsd: 100_000, startMs: T0 });
    const f1 = fillOf(buy(eng, NVDA, 1_000, q(NVDA, 100, 20), T0, 1));
    const f2 = fillOf(buy(eng, NVDA, 2_000, q(NVDA, 110, 30), T0 + HOUR_MS, 2));
    const pos = eng.positions.get(NVDA)!;
    expect(pos.qty).toBeCloseTo(f1.qty + f2.qty, 12);
    expect(pos.entryNotionalUsd).toBeCloseTo(f1.notionalUsd + f2.notionalUsd, 12);
    expect(pos.entryPrice).toBeCloseTo(pos.entryNotionalUsd / pos.qty, 12);
    // the blended entry sits strictly between the two fill prices
    expect(pos.entryPrice).toBeGreaterThan(f1.price);
    expect(pos.entryPrice).toBeLessThan(f2.price);
    // provenance of the FIRST entry is preserved
    expect(pos.openedTick).toBe(1);
    expect(pos.openedMs).toBe(T0);
    expect(eng.positions.size).toBe(1);
  });

  it("selling with no position (wrong symbol, or already closed) rejects with no-position", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    expect(rejectOf(sell(eng, NVDA, q(NVDA, 100, 20), T0, 0))).toBe("no-position");
    fillOf(buy(eng, NVDA, 500, q(NVDA, 100, 20), T0, 1));
    expect(rejectOf(sell(eng, TSLA, q(TSLA, 100, 20), T0, 2))).toBe("no-position");
    expect(sell(eng, NVDA, q(NVDA, 100, 20), T0, 3).ok).toBe(true);
    expect(rejectOf(sell(eng, NVDA, q(NVDA, 100, 20), T0, 4))).toBe("no-position");
  });
});

describe("markToMarket", () => {
  it("reports signed day P&L against the day's starting equity", () => {
    const eng = new PaperEngine({ seedUsd: 1_000, startMs: T0 });
    eng.cashUsd = 1_070;
    expect(eng.markToMarket(new Map(), T0 + HOUR_MS).dayPnlPct).toBeCloseTo(0.07, 12);
    eng.cashUsd = 950;
    const m = eng.markToMarket(new Map(), T0 + 2 * HOUR_MS);
    expect(m.dayPnlPct).toBeCloseTo(-0.05, 12);

  });

  it("day rollover re-anchors dayStartEquity to the LAST marked equity, not the current one", () => {
    const eng = new PaperEngine({ seedUsd: 1_000, startMs: T0 });
    eng.cashUsd = 1_100;
    expect(eng.markToMarket(new Map(), T0 + 2 * HOUR_MS).dayPnlPct).toBeCloseTo(0.1, 12);
    // equity moves overnight, BETWEEN yesterday's last mark and today's first mark:
    // the new baseline must be yesterday's last MARK (1100), not today's first equity (1200)
    eng.cashUsd = 1_200;
    expect(eng.markToMarket(new Map(), T0 + DAY_MS + 2 * HOUR_MS).dayPnlPct).toBeCloseTo(
      (1_200 - 1_100) / 1_100,
      12,
    );
    // ...and that baseline holds for the rest of the day
    eng.cashUsd = 1_050;
    expect(eng.markToMarket(new Map(), T0 + DAY_MS + 3 * HOUR_MS).dayPnlPct).toBeCloseTo(
      (1_050 - 1_100) / 1_100,
      12,
    );
  });

  it("skipping several days rolls the anchor forward, still baselining on the last mark", () => {
    const eng = new PaperEngine({ seedUsd: 1_000, startMs: T0 });
    eng.cashUsd = 1_040;
    eng.markToMarket(new Map(), T0 + HOUR_MS);
    eng.cashUsd = 1_080; // moves while unmarked for 5 days
    const m = eng.markToMarket(new Map(), T0 + 5 * DAY_MS + HOUR_MS);
    expect(m.dayPnlPct).toBeCloseTo((1_080 - 1_040) / 1_040, 12);

  });

  it("values a position with a missing quote at its entry price (stale-but-conservative)", () => {
    const eng = new PaperEngine({ seedUsd: 10_000, startMs: T0 });
    const f = fillOf(buy(eng, NVDA, 1_000, q(NVDA, 100, 20), T0, 0));
    // no NVDA quote this tick → the position is carried at entry, so equity ≈ seed
    expect(eng.equityUsd(new Map())).toBeCloseTo(10_000, 8);
    const m = eng.markToMarket(new Map(), T0 + HOUR_MS);
    expect(m.equityUsd).toBeCloseTo(10_000, 8);

    // with a quote present, equity marks the position to mid
    expect(eng.equityUsd(qmap(q(NVDA, 120, 20)))).toBeCloseTo(eng.cashUsd + f.qty * 120, 10);
    expect(eng.equityUsd(qmap(q(NVDA, 120, 20)))).toBeGreaterThan(10_000);
  });
});

describe("determinism", () => {
  /** Fixed scripted session over fixture quotes: entries, add-ons, exits, and a spike-tick thinned fill. */
  function runScript(): PaperEngine {
    resetFixture();
    const eng = new PaperEngine({ seedUsd: 5_000, startMs: T0 });
    const CADENCE_MS = 20 * 60_000;
    for (let tick = 0; tick <= 30; tick++) {
      const now = T0 + tick * CADENCE_MS;
      eng.markToMarket(qmap(quoteAt(NVDA, tick), quoteAt(TSLA, tick)), now);
      if (tick % 5 === 1) buy(eng, NVDA, 150, quoteAt(NVDA, tick), now, tick);
      if (tick % 7 === 2) buy(eng, TSLA, 120, quoteAt(TSLA, tick), now, tick);
      if (tick % 11 === 4 && eng.positions.has(NVDA)) {
        sell(eng, NVDA, quoteAt(NVDA, tick), now, tick);
      }
    }
    return eng;
  }

  it("an identical scripted session replayed on two fresh engines produces identical fills", () => {
    const a = runScript();
    const b = runScript();
    expect(b.fills).toEqual(a.fills);
    expect(b.snapshot()).toEqual(a.snapshot());
    // the script is non-trivial: entries, exits, and a thinned fill at spike tick 26
    expect(a.fills.length).toBeGreaterThanOrEqual(5);
    expect(a.fills.some((f) => f.side === "sell")).toBe(true);
    expect(a.fills.some((f) => f.thinned)).toBe(true);
  });
});
