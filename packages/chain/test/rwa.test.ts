/**
 * RWA surface — pure parts: the verified registry's shape, mid-price math from pool state,
 * and the swap calldata builder (execution stays behind GO_LIVE_OK; no network here).
 */
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  buildExactInputSingle, midPriceFromPool, RWA_INFRA, STOCK_TOKENS, V3_FEE_TIERS,
  type PoolInfo,
} from "../src/index.js";

describe("verified registry", () => {
  it("covers the genome universes' symbols except HOOD (not tokenized by Robinhood)", () => {
    for (const sym of ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "AVGO", "AMD", "SPY"]) {
      expect(STOCK_TOKENS[sym], sym).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
    expect(STOCK_TOKENS["HOOD"]).toBeUndefined();
  });

  it("addresses are checksummed and distinct; infra is frozen", () => {
    const all = [...Object.values(STOCK_TOKENS), RWA_INFRA.weth, RWA_INFRA.usdg, RWA_INFRA.uniswapV3Factory];
    expect(new Set(all).size).toBe(all.length);
    for (const a of all) expect(a).toBe(getAddress(a));
    expect(Object.isFrozen(STOCK_TOKENS)).toBe(true);
    expect(Object.isFrozen(RWA_INFRA)).toBe(true);
  });
});

describe("midPriceFromPool", () => {
  const info: PoolInfo = {
    pool: "0xC0Be1cb0f674D9737C72B2A63fC542361185b807",
    feeBps: 30,
    liquidity: 437102165404453356083n,
    // sqrtPriceX96 for price(token0 in token1) = 9.0696 (the live NVDA/WETH reading)
    sqrtPriceX96: BigInt(Math.round(Math.sqrt(9.0696) * 2 ** 96)),
    token0: RWA_INFRA.weth,
  };

  it("orients by token0: WETH-in gives tokens-per-WETH, token-in gives the reciprocal", () => {
    expect(midPriceFromPool(info, RWA_INFRA.weth)).toBeCloseTo(9.0696, 3);
    expect(midPriceFromPool(info, STOCK_TOKENS["NVDA"]!)).toBeCloseTo(1 / 9.0696, 6);
  });
});

describe("buildExactInputSingle", () => {
  it("encodes the exactInputSingle selector with the right params", () => {
    const data = buildExactInputSingle({
      tokenIn: RWA_INFRA.weth,
      tokenOut: STOCK_TOKENS["NVDA"]!,
      feeTier: 3000,
      recipient: "0x000000000000000000000000000000000000dEaD",
      amountInWei: 10n ** 15n,
      minAmountOutWei: 8n * 10n ** 15n,
    });
    // selector for exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
    expect(data.startsWith("0x04e45aaf")).toBe(true);
    expect(data.length).toBe(2 + 8 + 7 * 64); // selector + 7 static words
    const body = data.slice(10);
    expect(body).toContain(RWA_INFRA.weth.slice(2).toLowerCase());
    expect(body).toContain(STOCK_TOKENS["NVDA"]!.slice(2).toLowerCase());
  });

  it("only standard fee tiers typecheck (compile-time) and encode (runtime)", () => {
    for (const feeTier of V3_FEE_TIERS) {
      expect(() =>
        buildExactInputSingle({
          tokenIn: RWA_INFRA.weth, tokenOut: STOCK_TOKENS["TSLA"]!, feeTier,
          recipient: RWA_INFRA.weth, amountInWei: 1n, minAmountOutWei: 0n,
        }),
      ).not.toThrow();
    }
  });
});
