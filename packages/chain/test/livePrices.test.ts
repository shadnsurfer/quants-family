/**
 * LivePrices pure math: USD mids from pool state (USDG 6-decimals adjust, WETH cross rate)
 * and the cadence downsampler that feeds each quant's signal series.
 */
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  SAMPLE_MINUTES, USDG_DECIMAL_ADJUST, downsampleMids, poolMidUsd, type PricePoint,
} from "../src/livePrices.js";
import { RWA_INFRA, type PoolInfo } from "../src/rwa.js";

const TOKEN = getAddress("0x00000000000000000000000000000000000000aa");
const Q96 = 2 ** 96;

function poolWithPrice(t0inT1: number, token0: `0x${string}`): PoolInfo {
  return {
    pool: getAddress("0x00000000000000000000000000000000000000bb"),
    feeBps: 30,
    liquidity: 1n,
    sqrtPriceX96: BigInt(Math.round(Math.sqrt(t0inT1) * Q96)),
    token0: getAddress(token0),
  };
}

describe("poolMidUsd", () => {
  it("USDG pool: raw both-18 price × 1e12 = the USD price (AAPL at $230)", () => {
    // token is token0; raw USDG-per-token in both-18 convention = 230e6/1e18
    const info = poolWithPrice(230e-12, TOKEN);
    expect(poolMidUsd(info, TOKEN, "USDG", 0)).toBeCloseTo(230, 6);
    expect(USDG_DECIMAL_ADJUST).toBe(1e12);
  });

  it("WETH pool: tokens-per-WETH crossed with ETH/USD (20 NVDA per WETH @ $4000 → $200)", () => {
    // WETH is token0 → priceT0inT1 = tokens per WETH = 20
    const info = poolWithPrice(20, RWA_INFRA.weth);
    expect(poolMidUsd(info, TOKEN, "WETH", 4_000)).toBeCloseTo(200, 6);
  });

  it("WETH pool with zero cross-rate never divides by zero", () => {
    const info = poolWithPrice(0, RWA_INFRA.weth);
    expect(poolMidUsd(info, TOKEN, "WETH", 4_000)).toBe(0);
  });
});

describe("downsampleMids", () => {
  const points: PricePoint[] = Array.from({ length: 40 }, (_, i) => ({
    atMs: i * SAMPLE_MINUTES * 60_000,
    mid: 100 + i,
    spreadBps: 30,
  }));

  it("empty history → empty series", () => {
    expect(downsampleMids([], 5)).toEqual([]);
  });

  it("cadence == sample grid keeps every point, newest last", () => {
    const mids = downsampleMids(points, SAMPLE_MINUTES);
    expect(mids[mids.length - 1]).toBe(139);
    expect(mids).toHaveLength(40);
    expect(mids[0]).toBe(100);
  });

  it("a 20-minute quant sees every 4th sample, still ending on the latest", () => {
    const mids = downsampleMids(points, 20);
    expect(mids[mids.length - 1]).toBe(139);
    expect(mids[mids.length - 2]).toBe(135);
    expect(mids).toHaveLength(10);
  });

  it("caps at maxBars from the newest side", () => {
    const mids = downsampleMids(points, SAMPLE_MINUTES, 8);
    expect(mids).toHaveLength(8);
    expect(mids[mids.length - 1]).toBe(139);
    expect(mids[0]).toBe(132);
  });

  it("rounds cadence to the nearest whole step (7min → step 1, 12min → step 2)", () => {
    expect(downsampleMids(points, 7)).toHaveLength(40);
    expect(downsampleMids(points, 12)).toHaveLength(20);
  });
});
