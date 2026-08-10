/**
 * LivePrices — read-only USD quotes for the paper engine, straight from Uniswap v3 pool state
 * on Robinhood Chain (season-0 daemon; PROJECT.md §5.2 "fills at mid ± modeled spread").
 *
 * Per symbol: prefer the stock/USDG pool (direct USD, 6→18 decimal adjust ×1e12), fall back to
 * stock/WETH × the live WETH/USDG rate. Samples land on a 5-minute grid; each quant's signal
 * series is the sample history downsampled to ITS cadence spacing, so a 5-min scalper and a
 * 4-hour swing trader see the same market at their own bar sizes — exactly like the fixture.
 *
 * Everything here is eth_call reads. No wallet, no gate, no spend.
 */
import type { Address, PublicClient } from "viem";
import { getAddress } from "viem";
import { estimateSpreadBps, readPoolState } from "./prices.js";
import { RWA_INFRA, STOCK_TOKENS, findDeepestPool, midPriceFromPool, type PoolInfo } from "./rwa.js";

/** Structurally identical to @quants/paper's Quote (chain must not depend on paper). */
export interface LiveQuote {
  symbol: string;
  mid: number;
  spreadBps: number;
}

export interface PricePoint {
  atMs: number;
  mid: number;
  spreadBps: number;
}

/** sampling grid (minutes) — the finest quant cadence GENE_RANGES allows */
export const SAMPLE_MINUTES = 5;
/** keep 14 days of 5-minute samples per symbol */
const MAX_POINTS = (14 * 24 * 60) / SAMPLE_MINUTES;
/** re-discover a symbol's deepest pool daily (liquidity migrates) */
const POOL_TTL_MS = 24 * 3_600_000;
/** refresh the ETH/USD rate at most hourly */
const ETH_USD_TTL_MS = 3_600_000;
/** USDG has 6 decimals vs 18 → raw both-18 pool math is off by exactly this */
export const USDG_DECIMAL_ADJUST = 1e12;
/** notional hint for the spread model — dust-season position sizes are $2–15 */
const NOTIONAL_HINT_USD = 15;

type QuoteSide = "USDG" | "WETH";

interface CachedPool {
  info: PoolInfo;
  side: QuoteSide;
  discoveredAtMs: number;
}

/** Pure: USD mid for `token` given its pool, quote side, and the live ETH/USD rate. */
export function poolMidUsd(info: PoolInfo, token: Address, side: QuoteSide, ethUsd: number): number {
  if (side === "USDG") {
    return midPriceFromPool(info, token) * USDG_DECIMAL_ADJUST;
  }
  const tokensPerWeth = midPriceFromPool(info, RWA_INFRA.weth);
  return tokensPerWeth > 0 ? ethUsd / tokensPerWeth : 0;
}

/**
 * Pure: downsample a 5-minute sample history to one quant's cadence, newest-aligned —
 * the last element is always the latest sample; earlier bars step back `cadenceMin` apart.
 */
export function downsampleMids(points: readonly PricePoint[], cadenceMin: number, maxBars = 64): number[] {
  if (points.length === 0) return [];
  const step = Math.max(1, Math.round(cadenceMin / SAMPLE_MINUTES));
  const mids: number[] = [];
  for (let i = points.length - 1; i >= 0 && mids.length < maxBars; i -= step) {
    mids.push(points[i]!.mid);
  }
  return mids.reverse();
}

export interface LivePricesState {
  ethUsd: number;
  ethUsdAtMs: number;
  history: Record<string, PricePoint[]>;
}

export class LivePrices {
  private readonly client: PublicClient;
  private readonly pools = new Map<string, CachedPool | null>();
  private readonly history = new Map<string, PricePoint[]>();
  ethUsd = 0;
  private ethUsdAtMs = 0;

  constructor(client: PublicClient) {
    this.client = client;
  }

  /** WETH/USDG deepest pool → live ETH/USD. Throws when the pool is unreadable AND no prior rate exists. */
  async refreshEthUsd(nowMs: number): Promise<number> {
    if (this.ethUsd > 0 && nowMs - this.ethUsdAtMs < ETH_USD_TTL_MS) return this.ethUsd;
    const pool = await findDeepestPool(this.client, RWA_INFRA.weth, RWA_INFRA.usdg);
    if (pool) {
      const usd = midPriceFromPool(pool, RWA_INFRA.weth) * USDG_DECIMAL_ADJUST;
      if (usd > 100 && usd < 1_000_000) {
        this.ethUsd = usd;
        this.ethUsdAtMs = nowMs;
        return usd;
      }
    }
    if (this.ethUsd > 0) return this.ethUsd; // stale beats nothing
    throw new Error("LivePrices: cannot establish ETH/USD from the WETH/USDG pool");
  }

  private async poolFor(symbol: string, nowMs: number): Promise<CachedPool | null> {
    const cached = this.pools.get(symbol);
    if (cached !== undefined && (cached === null || nowMs - cached.discoveredAtMs < POOL_TTL_MS)) {
      return cached;
    }
    const token = STOCK_TOKENS[symbol as keyof typeof STOCK_TOKENS];
    if (!token) {
      this.pools.set(symbol, null);
      return null;
    }
    const usdgPool = await findDeepestPool(this.client, token, RWA_INFRA.usdg);
    const entry: CachedPool | null = usdgPool
      ? { info: usdgPool, side: "USDG", discoveredAtMs: nowMs }
      : await findDeepestPool(this.client, token, RWA_INFRA.weth).then((p) =>
          p ? { info: p, side: "WETH" as QuoteSide, discoveredAtMs: nowMs } : null,
        );
    this.pools.set(symbol, entry);
    return entry;
  }

  /**
   * Sample current pool state for `symbols` onto the history grid. Symbols with no live pool
   * record nothing (their quotes stay at the last known point, or dead if never seen).
   */
  async sample(symbols: readonly string[], nowMs: number): Promise<void> {
    await this.refreshEthUsd(nowMs);
    for (const symbol of symbols) {
      try {
        const cached = await this.poolFor(symbol, nowMs);
        if (!cached) continue;
        const state = await readPoolState(this.client, cached.info.pool);
        const info: PoolInfo = { ...cached.info, sqrtPriceX96: state.sqrtPriceX96, liquidity: state.liquidity };
        const token = STOCK_TOKENS[symbol as keyof typeof STOCK_TOKENS]!;
        const mid = poolMidUsd(info, token, cached.side, this.ethUsd);
        if (!(mid > 0) || !Number.isFinite(mid)) continue;
        // liquidity → USD proxy: L scales ~sqrt(raw0·raw1) → 1e18 for 18/18 pairs, 1e12 for 18/6
        const liqUsd = cached.side === "USDG"
          ? Number(info.liquidity) / 1e12
          : (Number(info.liquidity) / 1e18) * this.ethUsd;
        const spreadBps = Math.min(10_000, Math.round(estimateSpreadBps(NOTIONAL_HINT_USD, Math.max(1, liqUsd), info.feeBps)));
        const points = this.history.get(symbol) ?? [];
        points.push({ atMs: nowMs, mid, spreadBps });
        if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
        this.history.set(symbol, points);
      } catch {
        // one bad symbol never blocks the sweep; its quote simply stays stale this round
      }
    }
  }

  latest(symbol: string): PricePoint | null {
    const points = this.history.get(symbol);
    return points && points.length > 0 ? points[points.length - 1]! : null;
  }

  /** Latest USD quote; symbols never successfully sampled read as untradeable (engine rejects on slippage). */
  quoteFor(symbol: string): LiveQuote {
    const point = this.latest(symbol);
    if (!point) return { symbol, mid: 0, spreadBps: 10_000 };
    return { symbol, mid: point.mid, spreadBps: point.spreadBps };
  }

  /** Signal series for one quant: sample history at its cadence spacing, newest-aligned. */
  seriesFor(symbol: string, cadenceMin: number): number[] {
    return downsampleMids(this.history.get(symbol) ?? [], cadenceMin);
  }

  serialize(): LivePricesState {
    return {
      ethUsd: this.ethUsd,
      ethUsdAtMs: this.ethUsdAtMs,
      history: Object.fromEntries(this.history),
    };
  }

  restore(state: LivePricesState): void {
    this.ethUsd = state.ethUsd;
    this.ethUsdAtMs = state.ethUsdAtMs;
    this.history.clear();
    for (const [symbol, points] of Object.entries(state.history)) {
      this.history.set(symbol, [...points]);
    }
  }
}

/** Address of a registry symbol (season0 fee reads need each quant token's own pool too). */
export function stockTokenAddr(symbol: string): Address | null {
  const addr = STOCK_TOKENS[symbol as keyof typeof STOCK_TOKENS];
  return addr ? getAddress(addr) : null;
}
