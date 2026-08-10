/**
 * Reaper (PROJECT.md §4.5, §6): executes the death routine atomically — halt the process,
 * close every position, final words in the quant's own voice, then SWEEP THE ENTIRE WALLET
 * to the champion (the top-producing living agent by fitness; the operator treasury when
 * none survive), and mark the grave. The dead feed the champion. Never leaves a zombie:
 * after reap() the quant has no process, no positions, no money.
 */
import { seededRng, usdToCents, type DeathCause } from "@quants/core";
import { composeTweet, guardTweet } from "@quants/brain";
import type { PaperEngine, Quote } from "@quants/paper";
import type { FlowLedger } from "./flows.js";
import type { QuantRecord } from "./types.js";

const DEATH_THESIS: Record<DeathCause, string> = {
  ruin: "equity fell to the ruin line and the rules do not negotiate",
  starvation: "the fees stopped coming and existence has a price",
};

export interface ReapContext {
  engine: PaperEngine | null;
  quoteFor: (symbol: string) => Quote;
  ledger: FlowLedger;
  nowMs: number;
  tick: number;
  /** the champion receiving the sweep (top living by fitness), or null → $operator-treasury */
  championId: string | null;
  /** credit the champion's real balance (sim: engine cash + equity map; live: on-chain transfer) */
  creditEquity: (quantId: string, usd: number) => void;
  /** reconcile the dying quant's realized-P&L flows after positions close, before the sweep */
  syncRealized?: () => void;
}

export function reap(quant: QuantRecord, cause: DeathCause, ctx: ReapContext): { sweptUsd: number; finalWords: string } {
  // 1) halt the process — nothing trades for a dead quant
  quant.processRunning = false;

  // 2) close every open position at current quotes (risk-reducing, allowed even under halt)
  if (ctx.engine) {
    for (const pos of [...ctx.engine.positions.values()]) {
      ctx.engine.trySell({
        symbol: pos.symbol,
        quote: ctx.quoteFor(pos.symbol),
        nowMs: ctx.nowMs,
        tick: ctx.tick,
        reason: "death-sweep",
      });
    }
  }

  // 3) final words, in its own voice — up to three seeded variants before the guard's
  // last-stand fallback ("…"). A quant dies once; the words should be its own.
  let finalWords = "…";
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = composeTweet({
      kind: "death",
      name: quant.name,
      ticker: quant.ticker,
      voice: quant.genome.voice,
      rng: seededRng(`${quant.id}-death-${attempt}`),
      thesis: DEATH_THESIS[cause],
    });
    if (guardTweet(text, { ticker: quant.ticker }).ok) {
      finalWords = text;
      break;
    }
  }

  // 3b) reconcile realized P&L (the position closes above moved it) before draining the estate
  ctx.syncRealized?.();

  // 4) sweep everything — cash (positions already closed), compute reserve, unclaimed fees.
  // The reserve includes earmarked holder rewards: the debt dies with the agent — the
  // champion absorbs the earmark ("the dead feed the champion; nothing is wasted").
  const cashUsd = ctx.engine ? ctx.engine.adjustCash(-Number.MAX_SAFE_INTEGER) * -1 : 0;
  const totalUsd = cashUsd + quant.computeReserveUsd + quant.unclaimedFeesUsd;
  quant.computeReserveUsd = 0;
  quant.unclaimedFeesUsd = 0;
  quant.rewardOwedUsd = 0;
  const sweptCents = usdToCents(totalUsd);
  if (sweptCents > 0) {
    const toId = ctx.championId ?? "$operator-treasury";
    ctx.ledger.record("champion-sweep", sweptCents, { fromId: quant.id, toId, atMs: ctx.nowMs, note: cause });
    if (ctx.championId) ctx.creditEquity(ctx.championId, totalUsd);
  }

  // 5) the grave row
  quant.status = "dead";
  quant.diedAtMs = ctx.nowMs;
  quant.causeOfDeath = cause;
  quant.finalWords = finalWords;

  return { sweptUsd: totalUsd, finalWords };
}
