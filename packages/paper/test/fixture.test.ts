/**
 * Recorded-price fixture (PROJECT.md §5.2, M2): pins the documented contract —
 * full determinism (same (symbol, tick) → same quote, forever, across resets and
 * access orders), the 20–45bps spread wobble with an exact 95bps spike every 13th
 * tick (above the §4.2 thin-liquidity threshold, so the guardrail gets exercised),
 * midSeries/quoteAt agreement, tick validation, and drift legs that actually trend.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { GUARDRAILS } from "@quants/core";
import { FIXTURE_EPOCH_MS, midSeries, quoteAt, resetFixture } from "../src/index.js";

beforeEach(() => resetFixture());

describe("determinism", () => {
  it("same (symbol, tick) yields an identical quote on every call", () => {
    const a = quoteAt("NVDA", 7);
    expect(quoteAt("NVDA", 7)).toEqual(a);
    expect(quoteAt("TSLA", 0)).toEqual(quoteAt("TSLA", 0));
    // distinct symbols do not share a series (cache is keyed per symbol)
    expect(quoteAt("NVDA", 5).mid).not.toBe(quoteAt("TSLA", 5).mid);
  });

  it("resetFixture() + out-of-order access reproduce the exact same series", () => {
    const sequential = Array.from({ length: 31 }, (_, t) => quoteAt("PLTR", t));
    resetFixture();
    // jump straight to the tail first — extension order must not change values
    expect(quoteAt("PLTR", 30)).toEqual(sequential[30]);
    for (let t = 0; t <= 30; t++) {
      expect(quoteAt("PLTR", t)).toEqual(sequential[t]);
    }
  });

  it("symbols without hand-shaped drift legs are still deterministic and positive", () => {
    const a = midSeries("MSFT", 25);
    resetFixture();
    expect(midSeries("MSFT", 25)).toEqual(a);
    for (const mid of a) expect(mid).toBeGreaterThan(0);
  });

  it("FIXTURE_EPOCH_MS is the documented sim t0: Monday 2026-01-05 09:30 (UTC-as-ET)", () => {
    const d = new Date(FIXTURE_EPOCH_MS);
    expect(d.toISOString()).toBe("2026-01-05T09:30:00.000Z");
    expect(d.getUTCDay()).toBe(1); // Monday
  });
});

describe("spreads", () => {
  it("spikes to exactly 95bps on every 13th tick (t > 0), for every symbol", () => {
    for (const sym of ["NVDA", "TSLA", "PLTR", "AAPL"]) {
      for (const t of [13, 26, 39]) {
        expect(quoteAt(sym, t).spreadBps).toBe(95);
      }
    }
    // the spike sits ABOVE the thin-liquidity threshold, so it exercises the size-halving guardrail
    expect(quoteAt("NVDA", 13).spreadBps).toBeGreaterThan(GUARDRAILS.thinLiquiditySpreadBps);
  });

  it("quotes an integer 20–45bps wobble on all non-spike ticks (tick 0 included — no spike at t=0)", () => {
    for (const sym of ["NVDA", "TSLA", "PLTR"]) {
      for (let t = 0; t <= 52; t++) {
        if (t > 0 && t % 13 === 0) continue;
        const { spreadBps } = quoteAt(sym, t);
        expect(spreadBps).toBeGreaterThanOrEqual(20);
        expect(spreadBps).toBeLessThanOrEqual(45);
        expect(Number.isInteger(spreadBps)).toBe(true);
      }
    }
  });
});

describe("midSeries", () => {
  it("has length t+1 and matches quoteAt mids point-for-point", () => {
    const t = 27;
    const series = midSeries("TSLA", t);
    expect(series).toHaveLength(t + 1);
    series.forEach((mid, i) => expect(mid).toBe(quoteAt("TSLA", i).mid));
  });

  it("returns a single point at tick 0", () => {
    expect(midSeries("NVDA", 0)).toHaveLength(1);
  });
});

describe("tick validation", () => {
  it("quoteAt rejects negative, fractional, and NaN ticks with RangeError", () => {
    expect(() => quoteAt("NVDA", -1)).toThrow(RangeError);
    expect(() => quoteAt("NVDA", 2.5)).toThrow(RangeError);
    expect(() => quoteAt("NVDA", Number.NaN)).toThrow(RangeError);
  });
});

describe("drift legs (the genesis-active symbols actually trend)", () => {
  // Per-tick move = drift ± 0.2% oscillation ± 0.15% noise, so a ±0.7%+ drift leg
  // dominates and the leg direction is guaranteed, not probabilistic.
  it("NVDA rises tick-over-tick through its +0.8%/tick leg [4..14]", () => {
    const mids = midSeries("NVDA", 14);
    expect(quoteAt("NVDA", 14).mid).toBeGreaterThan(quoteAt("NVDA", 4).mid);
    for (let t = 5; t <= 14; t++) {
      expect(mids[t]!).toBeGreaterThan(mids[t - 1]!);
    }
  });

  it("NVDA's pullback leg [15..19] actually pulls back", () => {
    expect(quoteAt("NVDA", 19).mid).toBeLessThan(quoteAt("NVDA", 15).mid);
  });

  it("TSLA trends up through [6..16] and PLTR through [19..31]", () => {
    expect(quoteAt("TSLA", 16).mid).toBeGreaterThan(quoteAt("TSLA", 6).mid);
    expect(quoteAt("PLTR", 31).mid).toBeGreaterThan(quoteAt("PLTR", 19).mid);
  });
});
