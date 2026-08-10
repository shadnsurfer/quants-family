/**
 * Deterministic signal layer (PROJECT.md §5.1 step 2) — pure functions on hand-crafted
 * series. Every expected number is derived by hand in a comment next to its assertion;
 * if one fails, the signal math changed, not the fixture.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNAL_GENES, type Genome, type SignalGenes } from "@quants/core";
import {
  SIM_CLOSE_MIN,
  SIM_OPEN_MIN,
  computeEntrySignal,
  isDark,
  signalExit,
  type SignalContext,
} from "../src/index.js";

/**
 * Default signal genes reproduce the pre-genome hardcoded constants, so every hand-derived
 * number in this file still holds; the last describe drives NON-default genes to prove the
 * thresholds actually come from the genome, not from leftover constants.
 */
function edge(over: Partial<Genome["edge"]> = {}): Genome["edge"] {
  return {
    archetype: "momentum",
    universe: ["NVDA"],
    aggression: 0.85,
    patience: { minHoldMin: 30, maxHoldHrs: 48 },
    fear: 0.05,
    conviction: 0.12,
    cadenceMin: 20,
    darkHours: 0.5,
    entryThesisStyle: "test",
    signal: { ...DEFAULT_SIGNAL_GENES },
    ...over,
  };
}

/** edge with targeted signal-gene overrides on top of the defaults. */
function edgeWithSignal(archetype: Genome["edge"]["archetype"], over: Partial<SignalGenes>): Genome["edge"] {
  return edge({ archetype, signal: { ...DEFAULT_SIGNAL_GENES, ...over } });
}

/** Regular-hours Monday context unless overridden — darkHours scaling stays off by default. */
function ctx(
  series: Record<string, readonly number[]>,
  over: { held?: readonly string[]; minutesOfDay?: number; dayOfWeek?: number } = {},
): SignalContext {
  return {
    series: new Map(Object.entries(series)),
    heldSymbols: new Set(over.held ?? []),
    minutesOfDay: over.minutesOfDay ?? 600,
    dayOfWeek: over.dayOfWeek ?? 1,
  };
}

describe("momentum (trailing 3-tick return breakout)", () => {
  it("enters at ret3 = 2% with strength ret3/4% = 0.5", () => {
    const sig = computeEntrySignal(edge(), ctx({ NVDA: [100, 100, 100, 102] }));
    expect(sig.action).toBe("enter");
    expect(sig.symbol).toBe("NVDA");
    expect(sig.strength).toBeCloseTo(0.5, 9);
  });

  it("holds at ret3 = 1.4%, below the 1.5% threshold", () => {
    const sig = computeEntrySignal(edge(), ctx({ NVDA: [100, 100, 100, 101.4] }));
    expect(sig.action).toBe("hold");
    expect(sig.strength).toBe(0);
  });

  it("enters at 1.6%, just past the threshold", () => {
    // note: a mathematically-exact 1.5% input (101.5/100 − 1) evaluates to
    // 0.014999999999999999 in IEEE754 — a hair BELOW the ≥0.015 gate — so the
    // boundary is pinned by bracketing it (1.4% holds above, 1.6% enters here).
    const sig = computeEntrySignal(edge(), ctx({ NVDA: [100, 100, 100, 101.6] }));
    expect(sig.action).toBe("enter");
    expect(sig.strength).toBeCloseTo(0.4, 9); // 1.6% / 4%
  });

  it("picks the strongest qualifying symbol across the universe", () => {
    const sig = computeEntrySignal(
      edge({ universe: ["NVDA", "TSLA"] }),
      ctx({ NVDA: [100, 100, 100, 102], TSLA: [100, 100, 100, 103] }),
    );
    expect(sig.action).toBe("enter");
    expect(sig.symbol).toBe("TSLA"); // 3% beats 2%
    expect(sig.strength).toBeCloseTo(0.75, 9); // 3% / 4%
  });

  it("excludes held symbols — the weaker free candidate wins", () => {
    const sig = computeEntrySignal(
      edge({ universe: ["NVDA", "TSLA"] }),
      ctx({ NVDA: [100, 100, 100, 102], TSLA: [100, 100, 100, 103] }, { held: ["TSLA"] }),
    );
    expect(sig.action).toBe("enter");
    expect(sig.symbol).toBe("NVDA");
    expect(sig.strength).toBeCloseTo(0.5, 9);
  });
});

describe("meanRevert (z-score vs 10-point rolling mean)", () => {
  // 11 points; the rolling window is the LAST 10 (indices 1..10), final mid included:
  // [99,101,99,101,99,101,99,101,99,97] → mean 99.6, var 1.64, sd ≈ 1.2806,
  // z = (97 − 99.6)/1.2806 ≈ −2.030 ≤ −1.5 → enter, strength 0.3 + (2.030 − 1.5)/1.5 ≈ 0.6535
  const dipped = [100, 99, 101, 99, 101, 99, 101, 99, 101, 99, 97];

  it("enters when the last point sits ≥1.5 sd below the rolling mean", () => {
    const sig = computeEntrySignal(edge({ archetype: "meanRevert" }), ctx({ NVDA: dipped }));
    expect(sig.action).toBe("enter");
    expect(sig.symbol).toBe("NVDA");
    expect(sig.strength).toBeCloseTo(0.6535, 4);
  });

  it("holds when z is just above −1.5", () => {
    // final 98.1 → mean 99.71, sd ≈ 1.0848, z ≈ −1.484 > −1.5
    const shallow = [100, 99, 101, 99, 101, 99, 101, 99, 101, 99, 98.1];
    const sig = computeEntrySignal(edge({ archetype: "meanRevert" }), ctx({ NVDA: shallow }));
    expect(sig.action).toBe("hold");
  });

  it("holds on a zero-variance series — no divide-by-zero", () => {
    const sig = computeEntrySignal(edge({ archetype: "meanRevert" }), ctx({ NVDA: Array(11).fill(100) as number[] }));
    expect(sig.action).toBe("hold");
    expect(Number.isNaN(sig.strength)).toBe(false);
  });
});

describe("breakout (12-tick range break with volatility expansion)", () => {
  // 13 flat-ish points wiggling 100↔100.1, then a pop to 100.5:
  // range high of the prior 12 = 100.1 < 100.5, and |1-tick ret| = 0.5% far exceeds
  // 1.3 × avg abs ret (~0.17%) → enter. strength = 0.4 + (100.5/100.1 − 1)/0.02 ≈ 0.5998
  const pop = [100, 100.1, 100, 100.1, 100, 100.1, 100, 100.1, 100, 100.1, 100, 100.1, 100, 100.5];

  it("enters on a range break with expansion", () => {
    const sig = computeEntrySignal(edge({ archetype: "breakout" }), ctx({ NVDA: pop }));
    expect(sig.action).toBe("enter");
    expect(sig.symbol).toBe("NVDA");
    expect(sig.strength).toBeCloseTo(0.5998, 4);
  });

  it("holds on a break WITHOUT expansion (steady climb: ret1 = 1× avg, needs >1.3×)", () => {
    const grind = Array.from({ length: 14 }, (_, i) => 100 * 1.005 ** i);
    const sig = computeEntrySignal(edge({ archetype: "breakout" }), ctx({ NVDA: grind }));
    expect(sig.action).toBe("hold");
  });

  it("holds with fewer than 14 points of history", () => {
    const sig = computeEntrySignal(edge({ archetype: "breakout" }), ctx({ NVDA: pop.slice(1) }));
    expect(sig.action).toBe("hold");
  });
});

describe("eventDriven (gaps into the open/close boundaries)", () => {
  const gap = [100, 100, 100, 101]; // 3-tick gap of 1% ≥ 0.8%

  it("enters on a ≥0.8% gap within cadenceMin of the open", () => {
    const sig = computeEntrySignal(
      edge({ archetype: "eventDriven" }),
      ctx({ NVDA: gap }, { minutesOfDay: SIM_OPEN_MIN + 20 }), // |590−570| = 20 ≤ cadence 20
    );
    expect(sig.action).toBe("enter");
    expect(sig.strength).toBeCloseTo(1 / 3, 9); // 1% / 3%
    expect(sig.reason).toMatch(/open/);
  });

  it("enters on the same gap near the close", () => {
    const sig = computeEntrySignal(
      edge({ archetype: "eventDriven" }),
      ctx({ NVDA: gap }, { minutesOfDay: SIM_CLOSE_MIN - 15 }),
    );
    expect(sig.action).toBe("enter");
    expect(sig.reason).toMatch(/close/);
  });

  it("holds one minute past the boundary window", () => {
    const sig = computeEntrySignal(
      edge({ archetype: "eventDriven" }),
      ctx({ NVDA: gap }, { minutesOfDay: SIM_OPEN_MIN + 21 }),
    );
    expect(sig.action).toBe("hold");
  });

  it("holds on the same gap far from both boundaries", () => {
    const sig = computeEntrySignal(edge({ archetype: "eventDriven" }), ctx({ NVDA: gap }, { minutesOfDay: 700 }));
    expect(sig.action).toBe("hold");
  });
});

describe("darkHours", () => {
  it("isDark boundaries: 569 dark, 570 light, 959 light, 960 dark (weekday)", () => {
    expect(isDark(569, 1)).toBe(true);
    expect(isDark(570, 1)).toBe(false);
    expect(isDark(959, 1)).toBe(false);
    expect(isDark(960, 1)).toBe(true);
    expect(isDark(0, 3)).toBe(true); // weekday midnight
  });

  it("weekends are dark at any hour", () => {
    expect(isDark(600, 6)).toBe(true); // Saturday, mid-session time
    expect(isDark(600, 0)).toBe(true); // Sunday
  });

  it("scales entry strength by exactly edge.darkHours when dark", () => {
    const series = { NVDA: [100, 100, 100, 102] }; // raw momentum strength 0.5
    const saturday = { dayOfWeek: 6 };
    const half = computeEntrySignal(edge({ darkHours: 0.5 }), ctx(series, saturday));
    expect(half.action).toBe("enter");
    expect(half.strength).toBeCloseTo(0.25, 9); // 0.5 × 0.5

    const full = computeEntrySignal(edge({ darkHours: 1 }), ctx(series, saturday));
    expect(full.strength).toBeCloseTo(0.5, 9); // ×1: multiply, not a fixed halving

    const none = computeEntrySignal(edge({ darkHours: 0 }), ctx(series, saturday));
    expect(none.strength).toBe(0); // ×0: appetite fully killed off-hours
  });
});

describe("signalExit (archetype-specific 'the setup is gone')", () => {
  it("momentum: exits when ret3 < −1%, not at −0.9%", () => {
    expect(signalExit(edge(), [100, 100, 100, 98.9])).toBe(true); // −1.1%
    expect(signalExit(edge(), [100, 100, 100, 99.1])).toBe(false); // −0.9%
  });

  it("meanRevert: exits once z ≥ 0, holds below the mean, no crash at zero variance", () => {
    // window [99,101,…,101]: mean 100, sd 1, mid 101 → z = +1
    expect(signalExit(edge({ archetype: "meanRevert" }), [100, 99, 101, 99, 101, 99, 101, 99, 101, 99, 101])).toBe(true);
    // final 99.5 → mean 99.85 → z < 0
    expect(signalExit(edge({ archetype: "meanRevert" }), [100, 99, 101, 99, 101, 99, 101, 99, 101, 99, 99.5])).toBe(false);
    expect(signalExit(edge({ archetype: "meanRevert" }), Array(11).fill(100) as number[])).toBe(false);
  });

  it("breakout: exits when mid < sma6", () => {
    expect(signalExit(edge({ archetype: "breakout" }), [105, 104, 103, 102, 101, 100])).toBe(true); // 100 < 102.5
    expect(signalExit(edge({ archetype: "breakout" }), [100, 101, 102, 103, 104, 105])).toBe(false);
  });

  it("eventDriven: never signal-exits, even into a crash (exits on time only)", () => {
    expect(signalExit(edge({ archetype: "eventDriven" }), [100, 90, 80, 70])).toBe(false);
  });

  it("returns false on a one-point series", () => {
    expect(signalExit(edge(), [100])).toBe(false);
  });
});

describe("signal genes drive the thresholds (non-default genes flip the defaults' verdicts)", () => {
  it("momentumEntryPct 0.02: the 1.6% move that enters at the default 1.5% now holds; 3% enters at 3%/(2%·8/3)", () => {
    const g = edgeWithSignal("momentum", { momentumEntryPct: 0.02 });
    expect(computeEntrySignal(g, ctx({ NVDA: [100, 100, 100, 101.6] })).action).toBe("hold");

    const sig = computeEntrySignal(g, ctx({ NVDA: [100, 100, 100, 103] }));
    expect(sig.action).toBe("enter");
    expect(sig.strength).toBeCloseTo(0.5625, 9); // 0.03 / (0.02 × 8/3)
  });

  it("momentumLookback 5 needs 6 points of history where the default 3 already enters on 5", () => {
    const five = [100, 100, 100, 100, 102]; // ret3 = 2% from the tail
    expect(computeEntrySignal(edge(), ctx({ NVDA: five })).action).toBe("enter"); // premise: default fires
    expect(computeEntrySignal(edgeWithSignal("momentum", { momentumLookback: 5 }), ctx({ NVDA: five })).action).toBe("hold");

    const six = [100, 100, 100, 100, 100, 102]; // ret5 = 2% ≥ 1.5%
    const sig = computeEntrySignal(edgeWithSignal("momentum", { momentumLookback: 5 }), ctx({ NVDA: six }));
    expect(sig.action).toBe("enter");
    expect(sig.reason).toContain("5-tick");
  });

  it("meanRevertEntryZ 2.5: the z ≈ −2.03 dip that enters at the default 1.5 now holds", () => {
    const dipped = [100, 99, 101, 99, 101, 99, 101, 99, 101, 99, 97];
    expect(computeEntrySignal(edge({ archetype: "meanRevert" }), ctx({ NVDA: dipped })).action).toBe("enter"); // premise
    expect(computeEntrySignal(edgeWithSignal("meanRevert", { meanRevertEntryZ: 2.5 }), ctx({ NVDA: dipped })).action).toBe("hold");
  });

  it("breakoutExpansion 2.5 rejects a pop the default 1.3 accepts (ret1 0.5% vs avg ≈ 0.225%)", () => {
    // wiggle 100↔100.2 then pop to 100.5: avgAbs ≈ 0.002248 → 1.3× ≈ 0.29% < 0.5% < 2.5× ≈ 0.56%
    const pop = [100, 100.2, 100, 100.2, 100, 100.2, 100, 100.2, 100, 100.2, 100, 100.2, 100, 100.5];
    expect(computeEntrySignal(edge({ archetype: "breakout" }), ctx({ NVDA: pop })).action).toBe("enter"); // premise
    expect(computeEntrySignal(edgeWithSignal("breakout", { breakoutExpansion: 2.5 }), ctx({ NVDA: pop })).action).toBe("hold");
  });

  it("breakoutRange 6 fires on a 9-point series the default 12-tick window cannot even evaluate", () => {
    const short = [100, 100.1, 100, 100.1, 100, 100.1, 100, 100.1, 100.6];
    expect(computeEntrySignal(edge({ archetype: "breakout" }), ctx({ NVDA: short })).action).toBe("hold"); // premise: < 14 points
    const sig = computeEntrySignal(edgeWithSignal("breakout", { breakoutRange: 6 }), ctx({ NVDA: short }));
    expect(sig.action).toBe("enter");
    expect(sig.reason).toContain("6-tick");
  });

  it("eventGapPct 0.03: the 1% open gap that enters at the default 0.8% now holds", () => {
    const gap = [100, 100, 100, 101];
    const at = { minutesOfDay: SIM_OPEN_MIN + 10 };
    expect(computeEntrySignal(edge({ archetype: "eventDriven" }), ctx({ NVDA: gap }, at)).action).toBe("enter"); // premise
    expect(computeEntrySignal(edgeWithSignal("eventDriven", { eventGapPct: 0.03 }), ctx({ NVDA: gap }, at)).action).toBe("hold");
  });

  it("eventWindowMult 2 doubles the boundary window: minute open+21 holds at the default, enters at ×2", () => {
    const gap = [100, 100, 100, 101];
    const at = { minutesOfDay: SIM_OPEN_MIN + 21 }; // 21 > cadence 20 → outside the default window
    expect(computeEntrySignal(edge({ archetype: "eventDriven" }), ctx({ NVDA: gap }, at)).action).toBe("hold"); // premise
    const sig = computeEntrySignal(edgeWithSignal("eventDriven", { eventWindowMult: 2 }), ctx({ NVDA: gap }, at));
    expect(sig.action).toBe("enter");
    expect(sig.strength).toBeCloseTo(1 / 3, 9); // 1% / (0.8% × 3.75)
  });

  it("signalExit follows the genes too: momentumLookback 5 sees no exit where the default 3 does", () => {
    // ret3 = 98.9/100.4 − 1 ≈ −1.49% (default exits at < −1%) but ret5 = 98.9/98 − 1 ≈ +0.92%
    const series = [98, 98.5, 100.4, 100, 99.6, 98.9];
    expect(signalExit(edge(), series)).toBe(true); // premise: default exits
    expect(signalExit(edgeWithSignal("momentum", { momentumLookback: 5 }), series)).toBe(false);
  });
});

describe("B2b confirmations (lone spikes, knives, marginal pokes, dead-cat gaps)", () => {
  it("momentum: a trailing return that ends on a downtick does NOT enter (no follow-through)", () => {
    // ret3 = 102/100 − 1 = +2% ≥ 1.5% default, but the last tick FELL (103→102) — a lone spike
    const sig = computeEntrySignal(edge(), ctx({ NVDA: [100, 100, 103, 102] }));
    expect(sig.action).toBe("hold");
  });

  it("meanRevert: z past −3× the entry z is a falling knife — same series, smaller entry z, no entry", () => {
    // window 10 on [100×9, 82]: mean 98.2; devs 1.8(×9) and −16.2 → var 29.16, sd 5.4;
    // z = (82 − 98.2)/5.4 = −3.0. entryZ 1.0: knife line −3.0, z ≥ −3.0 → enters (inclusive).
    const enters = computeEntrySignal(
      edgeWithSignal("meanRevert", { meanRevertWindow: 10, meanRevertEntryZ: 1.0 }),
      ctx({ NVDA: [100, 100, 100, 100, 100, 100, 100, 100, 100, 82] }),
    );
    expect(enters.action).toBe("enter");
    // entryZ 0.9: knife line −2.7 — z −3.0 is BEYOND it → the same dislocation is a knife
    const knife = computeEntrySignal(
      edgeWithSignal("meanRevert", { meanRevertWindow: 10, meanRevertEntryZ: 0.9 }),
      ctx({ NVDA: [100, 100, 100, 100, 100, 100, 100, 100, 100, 82] }),
    );
    expect(knife.action).toBe("hold");
  });

  it("breakout: clearing the high by less than the average tick move is a marginal poke", () => {
    // window abs moves ≈ (1.49+1.0+0.7+0.6+0.5+0.7+0.5+1.7)/8 ≈ 0.9% → margin = high×1.009
    // = 101×1.009 ≈ 101.9. mid 101.8 breaks the 101 high and beats the expansion check
    // (ret1 1.7% > 1.5×0.9%) but NOT the margin — a poke, not a breakout.
    const sig = computeEntrySignal(
      edgeWithSignal("breakout", { breakoutRange: 8, breakoutExpansion: 1.5 }),
      ctx({ NVDA: [100, 101, 99.5, 100.5, 99.8, 100.4, 99.9, 100.6, 100.1, 101.8] }),
    );
    expect(sig.action).toBe("hold");
  });

  it("eventDriven: a gap that closes below its own drift is a dead cat — no entry", () => {
    // gap3 = 102.2/100 − 1 = +2.2% ≥ 0.8% default, but drift sma4 = 102.25 > mid 102.2
    const sig = computeEntrySignal(
      edgeWithSignal("eventDriven", {}),
      ctx({ NVDA: [100, 104, 102.8, 102.2] }, { minutesOfDay: 578 }),
    );
    expect(sig.action).toBe("hold");
  });
});
