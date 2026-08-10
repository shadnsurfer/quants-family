/** Market + fill types for the paper engine. Units: *Usd dollars, *Bps basis points, fractions elsewhere. */

export interface Quote {
  symbol: string;
  /** Chainlink-style mid price */
  mid: number;
  /** full quoted spread in basis points */
  spreadBps: number;
}

export interface Position {
  symbol: string;
  qty: number;
  /** average fill price actually paid (mid + slippage) */
  entryPrice: number;
  /** dollars spent to open (incl. slippage) — P&L is measured against this */
  entryNotionalUsd: number;
  openedMs: number;
  openedTick: number;
}

export type TradeSide = "buy" | "sell";

export type ExitReason = "stop" | "trail" | "max-hold" | "signal" | "manual" | "death-sweep";

export interface Fill {
  side: TradeSide;
  symbol: string;
  qty: number;
  /** executed price after spread + size slippage */
  price: number;
  notionalUsd: number;
  /** total execution penalty vs mid, in bps */
  slippageBps: number;
  tick: number;
  /** thin-liquidity rule halved the requested size */
  thinned: boolean;
  /** exits only */
  reason?: ExitReason;
  pnlUsd?: number;
  pnlPct?: number;
}

export type RejectReason =
  | "not-whitelisted"
  | "slippage-cap"
  | "insufficient-cash"
  | "zero-size"
  | "no-position";

export type TradeResult = { ok: true; fill: Fill } | { ok: false; reason: RejectReason };

export interface MarkResult {
  equityUsd: number;
  /** P&L fraction vs the current day's starting equity (negative = loss) — gate context */
  dayPnlPct: number;
}
