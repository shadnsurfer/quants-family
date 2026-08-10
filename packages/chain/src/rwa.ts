/**
 * RWA (tokenized stock) trading surface on Robinhood Chain (PROJECT.md §7).
 *
 * Registry verified on-chain 2026-07-22: official "• Robinhood Token" stock tokens (symbol()
 * and decimals()==18 confirmed live), canonical WETH/USDG from docs.robinhood.com/chain, and
 * the Uniswap v3 factory discovered from a real Pons launch's positionManager.factory().
 * NOTE: HOOD itself is NOT tokenized on Robinhood Chain (no official token exists).
 *
 * Reads are live; swap EXECUTION is calldata-only here — sending it requires MODE=live,
 * which stays behind the GO_LIVE_OK human gate. The paper engine handles all trading until then.
 */
import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { estimateSpreadBps } from "./prices.js";
import { STOCK_TOKENS } from "./stockTokens.js";

export { STOCK_TOKENS };

/**
 * Canonical quote/infra addresses (docs.robinhood.com/chain + on-chain discovery, verified
 * 2026-07-23). The swap router's factory() returns uniswapV3Factory exactly — confirmed
 * on-chain — and it carries the chain's swap volume (9.6M+ txns), i.e. the real SwapRouter02.
 */
export const RWA_INFRA = Object.freeze({
  weth: getAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
  usdg: getAddress("0x5fc5360d0400a0fd4f2af552add042d716f1d168"),
  uniswapV3Factory: getAddress("0x1f7d7550b1b028f7571e69a784071f0205fd2efa"),
  swapRouter: getAddress("0xcaf681a66d020601342297493863e78c959e5cb2"),
} as const);

// STOCK_TOKENS registry lives in ./stockTokens.ts (generated + on-chain verified, 94 assets).

export const V3_FEE_TIERS = [100, 500, 3000, 10000] as const;

const FACTORY_ABI = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
]);

export interface PoolInfo {
  pool: Address;
  feeBps: number;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  token0: Address;
}

/** Deepest live pool for a pair across the standard fee tiers. Null when nothing has liquidity. */
export async function findDeepestPool(
  client: PublicClient,
  tokenA: Address,
  tokenB: Address,
): Promise<PoolInfo | null> {
  let best: PoolInfo | null = null;
  for (const fee of V3_FEE_TIERS) {
    const pool = await client.readContract({
      address: RWA_INFRA.uniswapV3Factory, abi: FACTORY_ABI, functionName: "getPool", args: [tokenA, tokenB, fee],
    });
    if (pool === "0x0000000000000000000000000000000000000000") continue;
    const [slot0, liquidity, token0] = await Promise.all([
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "slot0" }),
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "liquidity" }),
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "token0" }),
    ]);
    if (liquidity === 0n) continue;
    if (!best || liquidity > best.liquidity) {
      best = { pool, feeBps: fee / 100, liquidity, sqrtPriceX96: slot0[0], token0 };
    }
  }
  return best;
}

/** mid price of `base` denominated in `quote` from pool state (both sides 18 decimals). */
export function midPriceFromPool(info: PoolInfo, base: Address): number {
  const q = Number(info.sqrtPriceX96) / 2 ** 96;
  const priceT0inT1 = q * q;
  return getAddress(base) === getAddress(info.token0) ? priceT0inT1 : 1 / priceT0inT1;
}

export interface RwaQuote {
  symbol: string;
  pool: Address;
  feeBps: number;
  /** stock-token units per 1 WETH */
  midPerWeth: number;
  amountInWeth: number;
  /** indicative out after pool fee + modeled impact */
  amountOutTokens: number;
  effectiveSpreadBps: number;
  liquidity: bigint;
}

/**
 * Indicative quote for buying a stock token with WETH: mid from slot0, minus the pool fee and
 * a size-impact estimate. Honest about being indicative — exact-out needs tick-walking, which
 * live mode gets from the router's revert-quote at execution time.
 */
export async function quoteStockBuy(
  client: PublicClient,
  symbol: keyof typeof STOCK_TOKENS | string,
  amountInWeth: number,
  ethUsdHint = 1900,
): Promise<RwaQuote | null> {
  const token = STOCK_TOKENS[symbol as keyof typeof STOCK_TOKENS];
  if (!token) return null;
  const info = await findDeepestPool(client, token, RWA_INFRA.weth);
  if (!info) return null;
  const midPerWeth = midPriceFromPool(info, RWA_INFRA.weth);
  const notionalUsd = amountInWeth * ethUsdHint;
  const liquidityUsdProxy = (Number(info.liquidity) / 1e18) * ethUsdHint;
  const spreadBps = estimateSpreadBps(notionalUsd, Math.max(1, liquidityUsdProxy), info.feeBps);
  const effective = Math.min(spreadBps, 10_000);
  const amountOutTokens = amountInWeth * midPerWeth * (1 - effective / 10_000);
  return {
    symbol: String(symbol), pool: info.pool, feeBps: info.feeBps,
    midPerWeth, amountInWeth, amountOutTokens, effectiveSpreadBps: effective, liquidity: info.liquidity,
  };
}

const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
]);

/**
 * Calldata for a SwapRouter02-style exactInputSingle. Pure builder — EXECUTION of this
 * calldata is a real trade and stays behind MODE=live + GO_LIVE_OK. The router address is
 * env config (SWAP_ROUTER_ADDR) to be pinned during the Phase-6 checklist.
 */
export function buildExactInputSingle(params: {
  tokenIn: Address;
  tokenOut: Address;
  feeTier: (typeof V3_FEE_TIERS)[number];
  recipient: Address;
  amountInWei: bigint;
  minAmountOutWei: bigint;
}): Hex {
  return encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: params.feeTier,
      recipient: params.recipient,
      amountIn: params.amountInWei,
      amountOutMinimum: params.minAmountOutWei,
      sqrtPriceLimitX96: 0n,
    }],
  });
}
