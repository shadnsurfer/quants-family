/**
 * Deterministic entry/exit signals from edge genes (PROJECT.md §5.1 step 2).
 * Four archetypes, implemented simply and legibly:
 *   momentum    — trailing-return breakout
 *   meanRevert  — z-score vs rolling mean
 *   breakout    — range break with a volatility-expansion proxy for volume
 *   eventDriven — gap triggers around the (simulated) US market open/close
 * Long-only, spot only (season 0: no shorts, no leverage). All pure functions.
 */
import type { Genome } from "@quants/core";
import type { GateSignal } from "@quants/brain";

export const SIM_OPEN_MIN = 570;   // 09:30
export const SIM_CLOSE_MIN = 960;  // 16:00

/** float tolerance so exact-threshold inputs (e.g. ret3 of precisely 1.5%) trigger inclusively */
const EPS = 1e-12;

function trailingReturn(series: readonly number[], k: number): number | null {
  const t = series.length - 1;
  if (t < k) return null;
  const past = series[t - k]!;
  return past > 0 ? series[t]! / past - 1 : null;
}

function sma(series: readonly number[], k: number): number | null {
  if (series.length < k) return null;
  let sum = 0;
  for (let i = series.length - k; i < series.length; i++) sum += series[i]!;
  return sum / k;
}

function std(series: readonly number[], k: number): number | null {
  const mean = sma(series, k);
  if (mean === null) return null;
  let acc = 0;
  for (let i = series.length - k; i < series.length; i++) acc += (series[i]! - mean) ** 2;
  return Math.sqrt(acc / k);
}

function pctFmt(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** True when the sim clock is outside regular hours or on a weekend. */
export function isDark(minutesOfDay: number, dayOfWeek: number): boolean {
  const weekend = dayOfWeek === 0 || dayOfWeek === 6;
  return weekend || minutesOfDay < SIM_OPEN_MIN || minutesOfDay >= SIM_CLOSE_MIN;
}

export interface SignalContext {
  /** mid-price history [0..now] per symbol */
  series: ReadonlyMap<string, readonly number[]>;
  heldSymbols: ReadonlySet<string>;
  minutesOfDay: number;
  dayOfWeek: number;
}

/** Best long-entry candidate for this tick, or hold. darkHours scales conviction off-hours. */
export function computeEntrySignal(edge: Genome["edge"], ctx: SignalContext): GateSignal {
  const candidates = edge.universe.filter((s) => !ctx.heldSymbols.has(s));
  let best: { symbol: string; strength: number; reason: string } | null = null;

  for (const symbol of candidates) {
    const s = ctx.series.get(symbol);
    if (!s || s.length < 2) continue;
    const mid = s[s.length - 1]!;
    let found: { strength: number; reason: string } | null = null;

    const g = edge.signal;
    if (edge.archetype === "momentum") {
      const ret = trailingReturn(s, g.momentumLookback);
      const ret1 = trailingReturn(s, 1);
      // confirmation (B2b): follow-through required — a lone spike is not momentum
      if (ret !== null && ret1 !== null && ret >= g.momentumEntryPct - EPS && ret1 > 0) {
        found = { strength: Math.min(1, ret / (g.momentumEntryPct * 8 / 3)), reason: `trailing ${g.momentumLookback}-tick return ${pctFmt(ret)} breakout` };
      }
    } else if (edge.archetype === "meanRevert") {
      const mean = sma(s, g.meanRevertWindow);
      const sd = std(s, g.meanRevertWindow);
      if (mean !== null && sd !== null && sd > 0) {
        const z = (mid - mean) / sd;
        // confirmation (B2b): buy the dislocation, not the knife — past 3× the entry z it is falling, not mispriced
        if (z <= -g.meanRevertEntryZ + EPS && z >= -3 * g.meanRevertEntryZ - EPS) {
          found = { strength: Math.min(1, 0.3 + (-z - g.meanRevertEntryZ) / g.meanRevertEntryZ), reason: `z-score ${z.toFixed(2)} below the rolling mean` };
        }
      }
    } else if (edge.archetype === "breakout") {
      if (s.length >= g.breakoutRange + 2) {
        const window = s.slice(-(g.breakoutRange + 1), -1);
        const high = Math.max(...window);
        const ret1 = Math.abs(trailingReturn(s, 1) ?? 0);
        let avgAbs = 0;
        for (let i = s.length - g.breakoutRange; i < s.length; i++) avgAbs += Math.abs(s[i]! / s[i - 1]! - 1);
        avgAbs /= g.breakoutRange;
        // confirmation (B2b): the break must clear the range by more than the average tick
        // move — a marginal poke through the high is not a breakout
        if (mid > high * (1 + avgAbs) && ret1 > g.breakoutExpansion * avgAbs) {
          found = { strength: Math.min(1, 0.4 + (mid / high - 1) / 0.02), reason: `broke the ${g.breakoutRange}-tick range high on expansion` };
        }
      }
    } else {
      // eventDriven: gaps into the open/close boundaries (window scales with the gene)
      const windowMin = edge.cadenceMin * g.eventWindowMult;
      const nearOpen = Math.abs(ctx.minutesOfDay - SIM_OPEN_MIN) <= windowMin;
      const nearClose = Math.abs(ctx.minutesOfDay - SIM_CLOSE_MIN) <= windowMin;
      if (nearOpen || nearClose) {
        const gap = trailingReturn(s, 3);
        const drift = sma(s, Math.min(6, s.length));
        // confirmation (B2b): the gap must run WITH the session drift — no dead-cat gaps
        if (gap !== null && gap >= g.eventGapPct - EPS && drift !== null && mid > drift) {
          found = {
            strength: Math.min(1, gap / (g.eventGapPct * 3.75)),
            reason: `gap ${pctFmt(gap)} into the ${nearOpen ? "open" : "close"} boundary`,
          };
        }
      }
    }

    if (found && (!best || found.strength > best.strength)) {
      best = { symbol, ...found };
    }
  }

  if (!best) return { action: "hold", strength: 0, reason: "no setup" };

  // darkHours gene: appetite for nights/weekends scales conviction off-hours
  let strength = best.strength;
  if (isDark(ctx.minutesOfDay, ctx.dayOfWeek)) {
    strength *= edge.darkHours;
  }
  return { action: "enter", symbol: best.symbol, strength, reason: best.reason };
}

/** Archetype-specific "the setup is gone" exit (stops/takes/max-hold live in the runtime). */
export function signalExit(edge: Genome["edge"], series: readonly number[]): boolean {
  if (series.length < 2) return false;
  const mid = series[series.length - 1]!;
  if (edge.archetype === "momentum") {
    const ret = trailingReturn(series, edge.signal.momentumLookback);
    return ret !== null && ret < -0.01;
  }
  if (edge.archetype === "meanRevert") {
    const mean = sma(series, edge.signal.meanRevertWindow);
    const sd = std(series, edge.signal.meanRevertWindow);
    if (mean === null || sd === null || sd === 0) return false;
    return (mid - mean) / sd >= 0;
  }
  if (edge.archetype === "breakout") {
    const mean = sma(series, 6);
    return mean !== null && mid < mean;
  }
  return false; // eventDriven exits on time (patience/max-hold)
}
