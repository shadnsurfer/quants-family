/**
 * Deterministic "recorded prices" fixture (PROJECT.md §5.2, M2 smoke).
 *
 * Synthetic but market-shaped series per whitelisted symbol: piecewise drift regimes
 * (trend legs + pullbacks), a slow oscillation for the mean-reverters, and small seeded
 * noise. Fully deterministic: same (symbol, tick) → same quote, forever. No wall clock.
 *
 * Spreads breathe with a seeded wobble and spike above the 80bps thin-liquidity threshold
 * on a fixed cadence (every 13th tick) so the size-halving guardrail gets exercised.
 */
import { seededRng } from "@quants/core";
import type { Quote } from "./types.js";

/** simulated t0 for all fixture-driven runs: Monday 2026-01-05, 09:30 sim-ET (UTC-as-ET convention) */
export const FIXTURE_EPOCH_MS = 1767605400000;

const BASE_PRICE: Readonly<Record<string, number>> = {
  NVDA: 190, TSLA: 250, PLTR: 120, AAPL: 230, MSFT: 420,
  AMZN: 210, GOOGL: 180, META: 560, AVGO: 170, AMD: 160,
  COIN: 165, MSTR: 95, SPY: 745, QQQ: 690,
};

/** hand-shaped drift schedules (fraction per tick) for the genesis-active symbols */
const DRIFT_LEGS: Readonly<Record<string, ReadonlyArray<readonly [start: number, end: number, drift: number]>>> = {
  NVDA: [[0, 3, 0], [4, 14, 0.008], [15, 19, -0.007], [20, 30, 0.009], [31, 60, 0.001]],
  TSLA: [[0, 5, -0.003], [6, 16, 0.007], [17, 24, -0.008], [25, 36, 0.006], [37, 60, 0]],
  PLTR: [[0, 9, 0.005], [10, 18, -0.005], [19, 31, 0.007], [32, 60, -0.002]],
};

function driftAt(symbol: string, tick: number, rng: () => number): number {
  const legs = DRIFT_LEGS[symbol];
  if (legs) {
    for (const [start, end, drift] of legs) {
      if (tick >= start && tick <= end) return drift;
    }
    return 0;
  }
  // generic symbols: gentle seeded regime changes every 10 ticks
  const regime = Math.floor(tick / 10);
  const r = seededRng(`${symbol}-regime-${regime}`)();
  return (r - 0.5) * 0.006;
}

interface SeriesPoint { mid: number; spreadBps: number }

const seriesCache = new Map<string, SeriesPoint[]>();

function extendSeries(symbol: string, upToTick: number): SeriesPoint[] {
  let series = seriesCache.get(symbol);
  if (!series) {
    series = [];
    seriesCache.set(symbol, series);
  }
  const base = BASE_PRICE[symbol] ?? 100;
  while (series.length <= upToTick) {
    const t = series.length;
    const noiseRng = seededRng(`${symbol}-noise-${t}`);
    const prev = t === 0 ? base : series[t - 1]!.mid;
    const drift = driftAt(symbol, t, noiseRng);
    const oscillation = 0.002 * Math.sin(t / 3);
    const noise = (noiseRng() - 0.5) * 0.003;
    const mid = t === 0 ? base : prev * (1 + drift + oscillation + noise);

    // spreads: 20–45bps wobble, deterministic 95bps spike every 13th tick (t = 13, 26, …)
    const spreadRng = seededRng(`${symbol}-spread-${t}`);
    const spreadBps = t > 0 && t % 13 === 0 ? 95 : 20 + Math.round(spreadRng() * 25);

    series.push({ mid, spreadBps });
  }
  return series;
}

/** Deterministic quote for (symbol, tick). */
export function quoteAt(symbol: string, tick: number): Quote {
  if (tick < 0 || !Number.isInteger(tick)) throw new RangeError(`quoteAt: bad tick ${tick}`);
  const point = extendSeries(symbol, tick)[tick]!;
  return { symbol, mid: point.mid, spreadBps: point.spreadBps };
}

/** Mid-price history [0..tick] for signal math. */
export function midSeries(symbol: string, tick: number): number[] {
  extendSeries(symbol, tick);
  return seriesCache.get(symbol)!.slice(0, tick + 1).map((p) => p.mid);
}

/** Test helper: drop all cached series. */
export function resetFixture(): void {
  seriesCache.clear();
}
