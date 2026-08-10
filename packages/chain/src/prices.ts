/**
 * Chainlink + Uniswap v3 read helpers (PROJECT.md §7). The pure math (answer decoding,
 * spread estimation) is exported separately from the network calls so tests pin it exactly.
 */
import type { Address, PublicClient } from "viem";

/** Chainlink aggregator: decode latestRoundData's int answer at the feed's decimals. */
export function decodeChainlinkAnswer(answer: bigint, decimals: number): number {
  if (decimals < 0 || decimals > 30 || !Number.isInteger(decimals)) {
    throw new RangeError(`chainlink decimals out of range: ${decimals}`);
  }
  return Number(answer) / 10 ** decimals;
}

const AGGREGATOR_ABI = [
  {
    type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export async function readChainlinkPrice(client: PublicClient, feed: Address): Promise<number> {
  const [round, decimals] = await Promise.all([
    client.readContract({ address: feed, abi: AGGREGATOR_ABI, functionName: "latestRoundData" }),
    client.readContract({ address: feed, abi: AGGREGATOR_ABI, functionName: "decimals" }),
  ]);
  return decodeChainlinkAnswer(round[1], decimals);
}

/**
 * Effective half-spread estimate for a v3 pool, in bps: how far a trade of `notionalUsd`
 * moves price against you given active liquidity. Simplified constant-liquidity model —
 * honest about being an estimate; the paper engine uses the same convention.
 */
export function estimateSpreadBps(notionalUsd: number, activeLiquidityUsd: number, feeTierBps: number): number {
  if (notionalUsd <= 0) return feeTierBps;
  if (activeLiquidityUsd <= 0) return 10_000; // no liquidity: effectively untradeable
  const impact = (notionalUsd / activeLiquidityUsd) * 10_000;
  return feeTierBps + impact;
}

const V3_POOL_ABI = [
  {
    type: "function", name: "slot0", stateMutability: "view", inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
] as const;

export interface V3PoolState {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

export async function readPoolState(client: PublicClient, pool: Address): Promise<V3PoolState> {
  const [slot0, liquidity] = await Promise.all([
    client.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "liquidity" }),
  ]);
  return { sqrtPriceX96: slot0[0], tick: slot0[1], liquidity };
}

/** price of token0 in token1 from sqrtPriceX96 (both 18-decimals convention). */
export function priceFromSqrtX96(sqrtPriceX96: bigint): number {
  const q = Number(sqrtPriceX96) / 2 ** 96;
  return q * q;
}
