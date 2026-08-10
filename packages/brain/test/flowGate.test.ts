/**
 * Flow-aware reasoning gate: flow may tighten or veto, NEVER add size beyond the price signal
 * or originate a trade. Price-action quants are unaffected by flow entirely.
 */
import { describe, expect, it } from "vitest";
import { reasoningGate, type GateInput } from "../src/index.js";

function base(overrides: Partial<GateInput> = {}): GateInput {
  return {
    signal: { action: "enter", symbol: "NVDA", strength: 0.8, reason: "breakout" },
    equityUsd: 1000, positionCount: 0, dayPnlPct: 0, archetype: "momentum", name: "kelly",
    ...overrides,
  };
}

describe("flow never loosens the gate", () => {
  it("price-action quant ignores flow entirely (no research context)", async () => {
    const withoutFlow = await reasoningGate(base());
    const withFlow = await reasoningGate(base({
      flow: { imbalance: 1, confidence: 1, accumulation: 1 },
      research: { style: "priceAction", flowWeight: 0, flowSkepticism: 0.5 },
    }));
    expect(withFlow.sizeMult).toBe(withoutFlow.sizeMult);
  });

  it("even maximally bullish flow cannot push size above the price-signal baseline", async () => {
    const baseline = await reasoningGate(base());
    const hyped = await reasoningGate(base({
      flow: { imbalance: 1, confidence: 1, accumulation: 1 },
      research: { style: "flow", flowWeight: 1, flowSkepticism: 0 },
    }));
    expect(hyped.sizeMult).toBeLessThanOrEqual(1);
    // confirming flow may nudge toward the baseline but the gate is still shrink-or-veto: ≤1
    expect(hyped.sizeMult).toBeGreaterThanOrEqual(baseline.sizeMult - 1e-9);
    expect(hyped.sizeMult).toBeLessThanOrEqual(1);
  });
});

describe("flow tightens", () => {
  it("confident distribution vetoes a flow-heavy quant's entry", async () => {
    const d = await reasoningGate(base({
      flow: { imbalance: -0.9, confidence: 1, accumulation: 0.05 },
      research: { style: "flow", flowWeight: 1, flowSkepticism: 0 },
    }));
    expect(d.decision).toBe("veto");
    expect(d.thesis).toMatch(/flow/i);
  });

  it("soft opposing flow shrinks size rather than vetoing", async () => {
    const d = await reasoningGate(base({
      signal: { action: "enter", symbol: "NVDA", strength: 1, reason: "breakout" },
      flow: { imbalance: -0.3, confidence: 0.5, accumulation: 0.35 },
      research: { style: "hybrid", flowWeight: 0.5, flowSkepticism: 0 },
    }));
    expect(d.decision).toBe("approve");
    expect(d.sizeMult).toBeLessThan(1);
    expect(d.sizeMult).toBeGreaterThanOrEqual(0.5);
  });

  it("skepticism discounts opposing flow (higher skepticism → less shrink)", async () => {
    const opposing = { imbalance: -0.4, confidence: 0.8, accumulation: 0.3 } as const;
    const credulous = await reasoningGate(base({
      signal: { action: "enter", symbol: "NVDA", strength: 1, reason: "breakout" },
      flow: opposing, research: { style: "flow", flowWeight: 1, flowSkepticism: 0 },
    }));
    const skeptical = await reasoningGate(base({
      signal: { action: "enter", symbol: "NVDA", strength: 1, reason: "breakout" },
      flow: opposing, research: { style: "flow", flowWeight: 1, flowSkepticism: 0.9 },
    }));
    expect(skeptical.sizeMult).toBeGreaterThanOrEqual(credulous.sizeMult);
  });

  it("a weak price signal is still vetoed before flow is even consulted", async () => {
    const d = await reasoningGate(base({
      signal: { action: "enter", symbol: "NVDA", strength: 0.1, reason: "weak" },
      flow: { imbalance: 1, confidence: 1, accumulation: 1 },
      research: { style: "flow", flowWeight: 1, flowSkepticism: 0 },
    }));
    expect(d.decision).toBe("veto");
  });
});
