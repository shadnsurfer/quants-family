/**
 * Flow desk — the on-chain research surface. Pins the pure flow math (imbalance, confidence,
 * accumulation), the deterministic paper desk, and the analyzeFlow edge cases. No network.
 */
import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { LiveFlowDesk, PaperFlowDesk, analyzeFlow, type FlowWindow } from "../src/index.js";

const win = (o: Partial<FlowWindow> = {}): FlowWindow => ({
  netFlowWeth: 0, grossVolumeWeth: 0, newHolders: 0, feeVelocityWethPerHour: 0, ...o,
});

describe("analyzeFlow — pure flow math", () => {
  it("imbalance is net/gross, clamped to [-1,1]", () => {
    expect(analyzeFlow("NVDA", win({ netFlowWeth: 3, grossVolumeWeth: 10 })).imbalance).toBeCloseTo(0.3, 9);
    expect(analyzeFlow("NVDA", win({ netFlowWeth: -6, grossVolumeWeth: 10 })).imbalance).toBeCloseTo(-0.6, 9);
    // net can't exceed gross in reality, but the clamp guards bad inputs
    expect(analyzeFlow("NVDA", win({ netFlowWeth: 50, grossVolumeWeth: 10 })).imbalance).toBe(1);
  });

  it("no volume → zero imbalance, zero confidence, zero accumulation (never NaN)", () => {
    const f = analyzeFlow("NVDA", win());
    expect(f.imbalance).toBe(0);
    expect(f.confidence).toBe(0);
    expect(f.accumulation).toBe(0);
  });

  it("confidence scales volume against the reference and caps at 1", () => {
    expect(analyzeFlow("NVDA", win({ grossVolumeWeth: 2.5 }), 5).confidence).toBeCloseTo(0.5, 9);
    expect(analyzeFlow("NVDA", win({ grossVolumeWeth: 20 }), 5).confidence).toBe(1);
  });

  it("strong confident buy flow → high accumulation; strong sell flow → low", () => {
    const buy = analyzeFlow("NVDA", win({ netFlowWeth: 9, grossVolumeWeth: 10, newHolders: 30, feeVelocityWethPerHour: 0.05 }), 5);
    const sell = analyzeFlow("NVDA", win({ netFlowWeth: -9, grossVolumeWeth: 10 }), 5);
    expect(buy.accumulation).toBeGreaterThan(0.8);
    expect(sell.accumulation).toBeLessThan(0.15);
  });

  it("holder/fee bonuses only apply to net-buy flow", () => {
    const sellWithHolders = analyzeFlow("NVDA", win({ netFlowWeth: -5, grossVolumeWeth: 10, newHolders: 50, feeVelocityWethPerHour: 0.05 }), 5);
    // bonuses must not rescue a distribution reading
    expect(sellWithHolders.accumulation).toBeLessThan(0.5);
  });
});

describe("PaperFlowDesk — deterministic", () => {
  it("same (symbol, tick-window) → identical signal", () => {
    const a = new PaperFlowDesk().read("NVDA", 5);
    const b = new PaperFlowDesk().read("NVDA", 5);
    expect(a).toEqual(b);
  });

  it("different symbols diverge; every read is a valid signal", () => {
    const desk = new PaperFlowDesk();
    const nvda = desk.read("NVDA", 0);
    const tsla = desk.read("TSLA", 0);
    expect(nvda).not.toEqual(tsla);
    for (const f of [nvda, tsla]) {
      expect(f.imbalance).toBeGreaterThanOrEqual(-1);
      expect(f.imbalance).toBeLessThanOrEqual(1);
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.accumulation).toBeGreaterThanOrEqual(0);
      expect(f.accumulation).toBeLessThanOrEqual(1);
    }
  });
});

/** a minimal viem-shaped log for the mocked client */
function swapLog(amount0: bigint, amount1: bigint) {
  return { args: { amount0, amount1 } };
}
function transferLog(to: string) {
  return { args: { to } };
}

/** PublicClient mock: fixed head, canned logs per address. */
function mockClient(head: bigint, logsByAddress: Record<string, unknown[]>): PublicClient {
  return {
    getBlockNumber: async () => head,
    getLogs: async ({ address }: { address: string }) => logsByAddress[address.toLowerCase()] ?? [],
  } as unknown as PublicClient;
}

describe("LiveFlowDesk — log reconstruction (mocked client, no network)", () => {
  const POOL = "0x" + "aa".repeat(20);
  const TOKEN = "0x" + "bb".repeat(20);
  const poolOf = () => ({ pool: POOL, token: TOKEN, tokenIsToken0: true as const });

  it("token0 pools: a positive quote leg (amount1) is a BUY; gross sums both sides", async () => {
    const client = mockClient(1000n, {
      [POOL]: [swapLog(-5n * 10n ** 17n, 2n * 10n ** 18n), swapLog(3n * 10n ** 17n, -5n * 10n ** 17n)],
      [TOKEN]: [transferLog("0x1"), transferLog("0x2"), transferLog("0x2")],
    });
    const desk = new LiveFlowDesk(client, poolOf, 300n);
    const sig = await desk.read("NVDA", 0);
    expect(sig.window.grossVolumeWeth).toBeCloseTo(2 + 0.5, 9);
    expect(sig.window.netFlowWeth).toBeCloseTo(2 - 0.5, 9); // buy then sell → net long buy
    expect(sig.imbalance).toBeCloseTo(1.5 / 2.5, 9);
    expect(sig.window.newHolders).toBe(2); // distinct recipients
  });

  it("token1 pools: the quote leg flips to amount0", async () => {
    const client = mockClient(1000n, {
      [POOL]: [swapLog(1n * 10n ** 18n, -4n * 10n ** 17n)], // +1 WETH in → buy
      [TOKEN]: [],
    });
    const desk = new LiveFlowDesk(client, () => ({ pool: POOL, token: TOKEN, tokenIsToken0: false }), 300n);
    const sig = await desk.read("NVDA", 0);
    expect(sig.window.netFlowWeth).toBeCloseTo(1, 9);
    expect(sig.window.grossVolumeWeth).toBeCloseTo(1, 9);
  });

  it("unmapped symbols read as zero-confidence, never throw", async () => {
    const client = mockClient(1000n, {});
    const desk = new LiveFlowDesk(client, () => null, 300n);
    const sig = await desk.read("DOGE", 0);
    expect(sig.confidence).toBe(0);
    expect(sig.imbalance).toBe(0);
  });

  it("fromBlock clamps at 0 near genesis; fee velocity scales to a real per-hour rate", async () => {
    const client = mockClient(100n, {
      [POOL]: [swapLog(-1n * 10n ** 17n, 3n * 10n ** 18n)], // gross 3 WETH
      [TOKEN]: [],
    });
    // window 300 > head 100 → fromBlock 0; 300-block window, 1800 blocks/hour → ×6
    const desk = new LiveFlowDesk(client, poolOf, 300n);
    const sig = await desk.read("NVDA", 0);
    expect(sig.window.feeVelocityWethPerHour).toBeCloseTo(3 * 0.01 * 6, 9);
  });
});
