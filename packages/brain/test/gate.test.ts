/**
 * Reasoning gate: shrink-or-veto is a hard contract — no backend, however misbehaved,
 * may increase size beyond the deterministic signal.
 */
import { describe, expect, it } from "vitest";
import { clampDecision, reasoningGate, type GateInput } from "../src/index.js";

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    signal: { action: "enter", symbol: "NVDA", strength: 0.8, reason: "breakout" },
    equityUsd: 1000, positionCount: 0, dayPnlPct: 0, archetype: "momentum", name: "kelly",
    ...overrides,
  };
}

describe("clampDecision — the shrink-or-veto boundary", () => {
  it("caps sizeMult at 1 and floors at 0.5", () => {
    expect(clampDecision({ decision: "approve", sizeMult: 1.7, thesis: "x" }).sizeMult).toBe(1);
    expect(clampDecision({ decision: "approve", sizeMult: 0.1, thesis: "x" }).sizeMult).toBe(0.5);
  });
  it("anything not veto is approve; thesis truncated to 200", () => {
    expect(clampDecision({ decision: "yolo" as never, sizeMult: 1, thesis: "x" }).decision).toBe("approve");
    expect(clampDecision({ decision: "veto", sizeMult: 1, thesis: "y".repeat(500) }).thesis).toHaveLength(200);
  });
});

describe("offline gate", () => {
  it("approves a strong signal with a thesis, never exceeding 1×", async () => {
    const d = await reasoningGate(input());
    expect(d.decision).toBe("approve");
    expect(d.sizeMult).toBeLessThanOrEqual(1);
    expect(d.sizeMult).toBeGreaterThanOrEqual(0.5);
    expect(d.thesis).toBe("breakout");
  });

  it("vetoes weak signals and non-entries", async () => {
    expect((await reasoningGate(input({ signal: { action: "enter", symbol: "NVDA", strength: 0.1, reason: "meh" } }))).decision).toBe("veto");
    expect((await reasoningGate(input({ signal: { action: "hold", strength: 0.9, reason: "no setup" } }))).decision).toBe("veto");
  });

  it("shrinks when the day is already red", async () => {
    const calm = await reasoningGate(input());
    const bleeding = await reasoningGate(input({ dayPnlPct: -0.05 }));
    expect(bleeding.sizeMult).toBeLessThanOrEqual(calm.sizeMult);
  });

  it("drawdown control (B2b): ≥35% vetoes, ≥25% halves, ≥15% trims, bands are inclusive", async () => {
    // strength 0.8 → base sizeMult 0.9 (no flow input → no flow adjustment)
    const calm = await reasoningGate(input({ drawdownPct: 0.1 }));
    expect(calm.decision).toBe("approve");
    expect(calm.sizeMult).toBeCloseTo(0.9, 9);

    const trimmed = await reasoningGate(input({ drawdownPct: 0.15 }));
    expect(trimmed.decision).toBe("approve");
    expect(trimmed.sizeMult).toBeCloseTo(0.9 * 0.75, 9);
    expect(trimmed.thesis).toContain("drawdown -15%: trimmed");

    const halved = await reasoningGate(input({ drawdownPct: 0.25 }));
    expect(halved.decision).toBe("approve");
    expect(halved.sizeMult).toBeCloseTo(0.5, 9); // 0.9 × 0.5 = 0.45 → floored at 0.5
    expect(halved.thesis).toContain("drawdown -25%: half size");

    const protected_ = await reasoningGate(input({ drawdownPct: 0.35 }));
    expect(protected_.decision).toBe("veto");
    expect(protected_.thesis).toContain("protecting what's left");
  });

  it("a misbehaving backend is clamped, a vetoing backend is honored", async () => {
    const greedy = await reasoningGate(input(), {
      backend: async () => ({ decision: "approve", sizeMult: 5, thesis: "MAX LEVERAGE" }),
    });
    expect(greedy.sizeMult).toBe(1);
    const cautious = await reasoningGate(input(), {
      backend: async () => ({ decision: "veto", sizeMult: 0.5, thesis: "spread too wide" }),
    });
    expect(cautious.decision).toBe("veto");
  });
});
