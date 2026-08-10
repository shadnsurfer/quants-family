/**
 * Paper-trading engine (PROJECT.md §5.2): fills at mid ± half-spread + size-based slippage,
 * tracks equity exactly like live would. The arena's three system rules are enforced HERE,
 * at execution:
 *   - venue whitelist            → reject
 *   - thin liquidity (>80bps)    → requested size halved
 *   - slippage cap (1.5%)        → reject
 * Everything else — position size, exposure breadth, stop-losses, daily-loss behavior — is
 * per-agent, from the genome (2026-08-02 amendment). Deterministic: the caller supplies
 * nowMs/tick; the engine never reads a wall clock.
 */
import { GUARDRAILS } from "@quants/core";
import type { Fill, MarkResult, Position, Quote, TradeResult, ExitReason } from "./types.js";

const DAY_MS = 86_400_000;
const EPS = 1e-9;

export interface PaperEngineOptions {
  seedUsd: number;
  startMs: number;
}

export class PaperEngine {
  readonly seedUsd: number;
  cashUsd: number;
  realizedPnlUsd = 0;
  readonly positions = new Map<string, Position>();
  readonly fills: Fill[] = [];

  private dayAnchorMs: number;
  private dayStartEquityUsd: number;
  private lastEquityUsd: number;

  constructor(opts: PaperEngineOptions) {
    this.seedUsd = opts.seedUsd;
    this.cashUsd = opts.seedUsd;
    this.dayAnchorMs = opts.startMs;
    this.dayStartEquityUsd = opts.seedUsd;
    this.lastEquityUsd = opts.seedUsd;
  }

  equityUsd(quotes: ReadonlyMap<string, Quote>): number {
    let equity = this.cashUsd;
    for (const pos of this.positions.values()) {
      const quote = quotes.get(pos.symbol);
      // no quote this tick → value at entry (stale but conservative)
      equity += pos.qty * (quote ? quote.mid : pos.entryPrice);
    }
    return equity;
  }

  /**
   * Mark to market: roll the daily anchor and report equity + the day's P&L fraction
   * (gate context). Call once per tick BEFORE trading — position sizing uses this equity.
   */
  markToMarket(quotes: ReadonlyMap<string, Quote>, nowMs: number): MarkResult {
    while (nowMs - this.dayAnchorMs >= DAY_MS) {
      this.dayAnchorMs += DAY_MS;
      this.dayStartEquityUsd = this.lastEquityUsd;
    }
    const equity = this.equityUsd(quotes);
    this.lastEquityUsd = equity;

    const dayPnlPct =
      this.dayStartEquityUsd > 0 ? (equity - this.dayStartEquityUsd) / this.dayStartEquityUsd : 0;
    return { equityUsd: equity, dayPnlPct };
  }

  /** Execution penalty vs mid: half the quoted spread + 2bps per $10k of notional. */
  private slipFraction(spreadBps: number, notionalUsd: number): number {
    const halfSpread = spreadBps / 2 / 10_000;
    const sizeSlip = (notionalUsd / 10_000) * 0.0002;
    return halfSpread + sizeSlip;
  }

  tryBuy(args: { symbol: string; notionalUsd: number; quote: Quote; nowMs: number; tick: number }): TradeResult {
    const { symbol, quote, nowMs, tick } = args;

    if (!(GUARDRAILS.venueWhitelist as readonly string[]).includes(symbol)) {
      return { ok: false, reason: "not-whitelisted" };
    }

    let notional = args.notionalUsd;
    let thinned = false;
    if (quote.spreadBps > GUARDRAILS.thinLiquiditySpreadBps) {
      notional *= GUARDRAILS.thinLiquiditySizeFactor;
      thinned = true;
    }

    // no species position cap and no open-position count limit (2026-08-02): sizing is the
    // agent's own genome upstream; here the only bounds are liquidity, slippage, and cash
    const existing = this.positions.get(symbol);

    notional = Math.min(notional, this.cashUsd);
    // cents quantization (2026-08-02): money moves in whole cents so the flow ledger and the
    // estate reconcile exactly — fills are the source of every downstream balance
    notional = Math.round(notional * 100) / 100;
    if (notional < 1) {
      return { ok: false, reason: this.cashUsd < 1 ? "insufficient-cash" : "zero-size" };
    }

    const slip = this.slipFraction(quote.spreadBps, notional);
    if (slip > GUARDRAILS.slippageCapPct + EPS) {
      return { ok: false, reason: "slippage-cap" };
    }

    const price = quote.mid * (1 + slip);
    const qty = notional / price;
    this.cashUsd -= notional;

    if (existing) {
      const totalQty = existing.qty + qty;
      const totalNotional = existing.entryNotionalUsd + notional;
      this.positions.set(symbol, {
        ...existing,
        qty: totalQty,
        entryPrice: totalNotional / totalQty,
        entryNotionalUsd: totalNotional,
      });
    } else {
      this.positions.set(symbol, {
        symbol, qty, entryPrice: price, entryNotionalUsd: notional, openedMs: nowMs, openedTick: tick,
      });
    }

    const fill: Fill = {
      side: "buy", symbol, qty, price, notionalUsd: notional,
      slippageBps: Math.round(slip * 10_000), tick, thinned,
    };
    this.fills.push(fill);
    return { ok: true, fill };
  }

  /** Close the FULL position. Allowed even while halted (risk-reducing). */
  trySell(args: { symbol: string; quote: Quote; nowMs: number; tick: number; reason: ExitReason }): TradeResult {
    const { symbol, quote, tick, reason } = args;
    const pos = this.positions.get(symbol);
    if (!pos) return { ok: false, reason: "no-position" };

    const grossNotional = pos.qty * quote.mid;
    const slip = this.slipFraction(quote.spreadBps, grossNotional);
    const price = quote.mid * (1 - slip);
    // cents-quantized: proceeds are a real money movement (see tryBuy)
    const proceeds = Math.round(pos.qty * price * 100) / 100;

    this.positions.delete(symbol);
    this.cashUsd += proceeds;

    const pnlUsd = proceeds - pos.entryNotionalUsd;
    const pnlPct = pos.entryNotionalUsd > 0 ? pnlUsd / pos.entryNotionalUsd : 0;
    this.realizedPnlUsd += pnlUsd;

    const fill: Fill = {
      side: "sell", symbol, qty: pos.qty, price, notionalUsd: proceeds,
      slippageBps: Math.round(slip * 10_000), tick, thinned: false, reason, pnlUsd, pnlPct,
    };
    this.fills.push(fill);
    return { ok: true, fill };
  }

  /**
   * External cash movement (compute-burn debits, the discretion share of fee claims, funding
   * debits, death sweeps, champion credits). Quantized to whole cents on entry — the flow
   * ledger reconciles against this. Never goes below zero — the caller sees the
   * actually-moved amount. Positive = deposit, negative = withdrawal.
   */
  adjustCash(deltaUsd: number): number {
    const delta = Math.round(deltaUsd * 100) / 100;
    const applied = delta < 0 ? -Math.min(-delta, this.cashUsd) : delta;
    this.cashUsd += applied;
    return applied;
  }

  /** Serializable snapshot for logs / the dashboard. */
  snapshot(): {
    seedUsd: number; cashUsd: number; realizedPnlUsd: number; lastEquityUsd: number;
    positions: Position[]; fillCount: number;
  } {
    return {
      seedUsd: this.seedUsd,
      cashUsd: this.cashUsd,
      realizedPnlUsd: this.realizedPnlUsd,
      lastEquityUsd: this.lastEquityUsd,
      positions: [...this.positions.values()],
      fillCount: this.fills.length,
    };
  }

  /** Full engine state for restart-safe persistence (season-0 daemon). */
  serialize(): PaperEngineState {
    return {
      seedUsd: this.seedUsd,
      cashUsd: this.cashUsd,
      realizedPnlUsd: this.realizedPnlUsd,
      positions: [...this.positions.values()],
      fills: [...this.fills],
      dayAnchorMs: this.dayAnchorMs,
      dayStartEquityUsd: this.dayStartEquityUsd,
      lastEquityUsd: this.lastEquityUsd,
    };
  }

  /** Rebuild an engine from serialize() output — exact state. */
  static restore(state: PaperEngineState): PaperEngine {
    const engine = new PaperEngine({ seedUsd: state.seedUsd, startMs: state.dayAnchorMs });
    engine.cashUsd = state.cashUsd;
    engine.realizedPnlUsd = state.realizedPnlUsd;
    for (const pos of state.positions) engine.positions.set(pos.symbol, { ...pos });
    engine.fills.push(...state.fills);
    engine.dayAnchorMs = state.dayAnchorMs;
    engine.dayStartEquityUsd = state.dayStartEquityUsd;
    engine.lastEquityUsd = state.lastEquityUsd;
    return engine;
  }
}

/** The exact wire shape of PaperEngine.serialize() / restore(). */
export interface PaperEngineState {
  seedUsd: number;
  cashUsd: number;
  realizedPnlUsd: number;
  positions: Position[];
  fills: Fill[];
  dayAnchorMs: number;
  dayStartEquityUsd: number;
  lastEquityUsd: number;
}
