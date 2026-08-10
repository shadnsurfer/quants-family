/**
 * One tick of one quant (PROJECT.md §5.1): mark → exits (stop/take/max-hold/signal) →
 * entry (signal → reasoning gate → guarded execution) → guarded tweet, budget permitting.
 *
 * Sessions persist across calls in-process (one process = one quant in production; the
 * smoke test and sims drive many ticks through this same entry point). Deterministic:
 * the sim clock derives from (tick, cadence) — no wall time, no unseeded randomness.
 */
import {
  aggressionToPositionPct, parseGenome, seededRng,
  type Genome, type GenomeInput,
} from "@quants/core";
import {
  FIXTURE_EPOCH_MS, PaperEngine, midSeries, quoteAt,
  type Fill, type PaperEngineState, type Quote,
} from "@quants/paper";
import { composeThesis, composeTweet, countTrade, createMemory, guardTweet, journal, maintainMemory, memoryContext, reasoningGate, recentPostTexts, sealMemory, birthLetter as writeBirthLetter, type MemoryState, type TweetKind } from "@quants/brain";
import { PaperFlowDesk, type FlowDesk } from "@quants/chain";
import { computeEntrySignal, isDark, signalExit } from "./signals.js";

// one deterministic paper flow desk for all sim quants (live path injects LiveFlowDesk)
const paperFlowDesk = new PaperFlowDesk();

/**
 * Injectable market view. Sims/tests default to the deterministic fixture; the season-0
 * daemon injects live pool quotes sampled on the quant's own cadence grid.
 */
export interface PriceView {
  quoteFor(symbol: string, tick: number): Quote;
  seriesFor(symbol: string, tick: number): readonly number[];
}

export interface RunOnceInput {
  genome: Genome | GenomeInput;
  mode: "paper";
  tick: number;
  /** paper seed capital, default $1,000 (first call wins per quant) */
  seedUsd?: number;
  /** market data source — omitted = deterministic fixture (every sim/test path) */
  prices?: PriceView;
  /** wall-clock override for live runs — omitted = sim clock derived from (tick, cadence) */
  nowMs?: number;
  /** flow research source — omitted = deterministic PaperFlowDesk */
  flowDesk?: FlowDesk;
  /** the parent's letter into this quant's initial self-model (used only at session creation) */
  birthLetter?: string | null;
  /**
   * Tweet content guard (B4): default ON. The live daemon flips it off via env
   * (QUANTS_TWEET_GUARD=0) — the 2026-08-02 amendment retires the guard; the flag keeps the
   * removal reversible. Sims/tests leave it on.
   */
  tweetGuard?: boolean;
}

export interface TweetOut {
  text: string;
  rejected: boolean;
  rule?: string;
  kind: TweetKind;
}

export interface TradeOut {
  side: "buy" | "sell";
  symbol: string;
  price: number;
  qty: number;
  notionalUsd: number;
  reason?: string;
  pnlUsd?: number;
  pnlPct?: number;
  /** the agent's reasoning for this decision, in its own voice (A4: decision + thesis broadcast together) */
  thesis?: string;
}

/** A setup the gate rejected — a decision not to trade, broadcast like any other decision. */
export interface VetoOut {
  symbol: string;
  /** the agent's reasoning for passing, in its own voice */
  thesis: string;
}

export interface RunOnceResult {
  trade?: TradeOut;
  veto?: VetoOut;
  tweet?: TweetOut;
  equityUsd: number;
  tick: number;
}

interface QuantSession {
  genome: Genome;
  engine: PaperEngine;
  postedByDay: Map<number, number>;
  guardRejections: number;
  /** the §5.4 memory stack: journal, digests, self-model — persists with the session */
  memory: MemoryState;
  /** per-symbol peak mid while held — the trailing take-profit's high-water mark (B2b) */
  peaks: Map<string, number>;
  /** session high-water equity — the drawdown throttle's baseline (B2b) */
  peakEquityUsd: number;
}

const sessions = new Map<string, QuantSession>();

/** Test/sim helper: forget all in-process quant state. */
export function resetQuantSessions(): void {
  sessions.clear();
}

function simNowMs(tick: number, cadenceMin: number): number {
  return FIXTURE_EPOCH_MS + tick * cadenceMin * 60_000;
}

function fillToTrade(fill: Fill): TradeOut {
  return {
    side: fill.side,
    symbol: fill.symbol,
    price: fill.price,
    qty: fill.qty,
    notionalUsd: fill.notionalUsd,
    ...(fill.reason !== undefined ? { reason: fill.reason } : {}),
    ...(fill.pnlUsd !== undefined ? { pnlUsd: fill.pnlUsd } : {}),
    ...(fill.pnlPct !== undefined ? { pnlPct: fill.pnlPct } : {}),
  };
}

/**
 * The neutral exit narrative: the actual numbers and genes that fired the exit, stated plainly.
 * composeThesis voices it; the feed broadcasts it alongside the trade (A4).
 */
function exitThesis(
  edge: Genome["edge"],
  reason: "stop" | "trail" | "max-hold" | "signal",
  pos: { entryPrice: number },
  exitPrice: number,
  heldMin: number,
  peak?: number,
): string {
  const pct = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const move = exitPrice / pos.entryPrice - 1;
  switch (reason) {
    case "stop":
      return `price ${pct(move)} crossed my -${(edge.fear * 100).toFixed(0)}% fear line — the risk gene fired`;
    case "trail": {
      const peakMove = peak !== undefined ? peak / pos.entryPrice - 1 : move;
      return `ran to ${pct(peakMove)}, gave back ${(edge.fear * 100).toFixed(0)}% from the peak — the trail banked ${pct(move)}`;
    }
    case "max-hold":
      return `${edge.patience.maxHoldHrs}h max hold reached (${Math.round(heldMin / 60)}h held) — the setup expired`;
    case "signal":
      switch (edge.archetype) {
        case "momentum": return `trailing momentum broke negative — the setup is gone`;
        case "meanRevert": return `price reverted through the rolling mean — the dislocation closed`;
        case "breakout": return `price fell back under the short mean — the breakout failed`;
        default: return `the event window closed — time-based exit`;
      }
  }
}

export async function runQuantOnce(input: RunOnceInput): Promise<RunOnceResult> {
  if (input.mode !== "paper") {
    throw new Error("only MODE=paper is implemented; live trading is gated behind the Phase 6 checklist");
  }
  const parsed = parseGenome(input.genome);
  const id = parsed.meta.id;

  let session = sessions.get(id);
  if (!session) {
    session = {
      genome: parsed,
      engine: new PaperEngine({
        seedUsd: input.seedUsd ?? 1_000,
        startMs: input.nowMs ?? simNowMs(0, parsed.edge.cadenceMin),
      }),
      postedByDay: new Map(),
      guardRejections: 0,
      memory: createMemory(input.birthLetter ?? null, input.nowMs ?? simNowMs(0, parsed.edge.cadenceMin)),
      peaks: new Map(),
      peakEquityUsd: input.seedUsd ?? 1_000,
    };
    sessions.set(id, session);
  }
  const { genome, engine } = session;
  const edge = genome.edge;
  const tick = input.tick;
  const nowMs = input.nowMs ?? simNowMs(tick, edge.cadenceMin);
  // §5.4 rolling maintenance: close finished days into digests, rewrite the self-model daily
  maintainMemory(session.memory, nowMs);
  const minutesOfDay = Math.floor(nowMs / 60_000) % 1440;
  const dayOfWeek = (Math.floor(nowMs / 86_400_000) + 4) % 7;
  const dayIndex = Math.floor((nowMs - FIXTURE_EPOCH_MS) / 86_400_000);

  const quotes = new Map<string, Quote>();
  const series = new Map<string, readonly number[]>();
  for (const symbol of edge.universe) {
    quotes.set(symbol, input.prices ? input.prices.quoteFor(symbol, tick) : quoteAt(symbol, tick));
    series.set(symbol, input.prices ? input.prices.seriesFor(symbol, tick) : midSeries(symbol, tick));
  }

  const mark = engine.markToMarket(quotes, nowMs);
  session.peakEquityUsd = Math.max(session.peakEquityUsd, mark.equityUsd);

  let trade: TradeOut | undefined;
  let veto: VetoOut | undefined;
  let tweetKind: TweetKind | undefined;
  let tweetSlots: { symbol?: string; pnlPct?: number; thesis?: string } = {};

  // 1) exits first: stop / trail / max-hold / signal (signal-exits respect minHold).
  // The take-profit TRAILS (B2b): once a position has run to +conviction at any tick, the
  // binary take is replaced by a peak-trailing exit at fear below the high — winners ride
  // until they give back a fear-sized slice of the run. An ARMED trend position (momentum /
  // breakout) is managed by price from then on: the setup-exit no longer fires on it — the
  // trail IS the discipline. meanRevert keeps its signal exit: there, reversion IS the win.
  for (const pos of [...engine.positions.values()]) {
    const quote = quotes.get(pos.symbol);
    const s = series.get(pos.symbol);
    if (!quote || !s) continue;
    const heldMin = (tick - pos.openedTick) * edge.cadenceMin;
    const peak = Math.max(session.peaks.get(pos.symbol) ?? pos.entryPrice, quote.mid);
    session.peaks.set(pos.symbol, peak);
    const trailArmed = peak >= pos.entryPrice * (1 + edge.conviction);
    const priceManaged = trailArmed && (edge.archetype === "momentum" || edge.archetype === "breakout");
    let reason: "stop" | "trail" | "max-hold" | "signal" | null = null;
    if (quote.mid <= pos.entryPrice * (1 - edge.fear)) reason = "stop";
    else if (trailArmed && quote.mid <= peak * (1 - edge.fear)) reason = "trail";
    else if (heldMin >= edge.patience.maxHoldHrs * 60) reason = "max-hold";
    else if (!priceManaged && heldMin >= edge.patience.minHoldMin && signalExit(edge, s)) reason = "signal";
    if (reason) {
      const res = engine.trySell({ symbol: pos.symbol, quote, nowMs, tick, reason });
      if (res.ok) {
        session.peaks.delete(pos.symbol);
        trade = {
          ...fillToTrade(res.fill),
          thesis: composeThesis({
            kind: "exit",
            thesis: exitThesis(edge, reason, pos, quote.mid, heldMin, peak),
            voice: genome.voice,
            rng: seededRng(`${id}-thesis-${tick}`),
          }),
        };
        countTrade(session.memory, { symbol: pos.symbol, ...(res.fill.pnlUsd !== undefined ? { pnlUsd: res.fill.pnlUsd } : {}), ...(res.fill.pnlPct !== undefined ? { pnlPct: res.fill.pnlPct } : {}) });
        journal(session.memory, {
          atMs: nowMs, kind: "trade",
          text: `sold ${pos.symbol} (${reason})${res.fill.pnlUsd !== undefined ? ` ${res.fill.pnlUsd >= 0 ? "+" : "-"}$${Math.abs(res.fill.pnlUsd).toFixed(2)}` : ""} — ${trade.thesis}`,
          data: { symbol: pos.symbol, pnlUsd: res.fill.pnlUsd ?? 0, pnlPct: res.fill.pnlPct ?? 0 },
        });
        tweetKind = "exit";
        tweetSlots = { symbol: pos.symbol, ...(res.fill.pnlPct !== undefined ? { pnlPct: res.fill.pnlPct } : {}) };
        break; // at most one trade per tick
      }
    }
  }

  // 2) entry: deterministic signal → reasoning gate (shrink-or-veto) → guarded execution
  if (!trade) {
    const signal = computeEntrySignal(edge, {
      series, heldSymbols: new Set(engine.positions.keys()), minutesOfDay, dayOfWeek,
    });
    if (signal.action === "enter" && signal.symbol) {
      // flow research: only fetched when the quant's genes actually weigh flow. A failing
      // desk (live RPC hiccup) must never kill the tick — fall back to price action.
      const wantsFlow = edge.researchStyle !== "priceAction" && edge.flowWeight > 0;
      const desk = input.flowDesk ?? paperFlowDesk;
      let flowSig: Awaited<ReturnType<FlowDesk["read"]>> | undefined;
      if (wantsFlow) {
        try {
          flowSig = await desk.read(signal.symbol, tick);
        } catch {
          flowSig = undefined;
        }
      }
      const gate = await reasoningGate({
        signal,
        equityUsd: mark.equityUsd,
        positionCount: engine.positions.size,
        dayPnlPct: mark.dayPnlPct,
        archetype: edge.archetype,
        name: genome.meta.name,
        // B2b drawdown control: how far underwater the session is vs its high-water equity
        drawdownPct: session.peakEquityUsd > 0 ? Math.max(0, (session.peakEquityUsd - mark.equityUsd) / session.peakEquityUsd) : 0,
        // §5.4: the gate call gets the small memory window (offline gate ignores it; the M6
        // Anthropic backend consumes it — same contract, shrink-or-veto only)
        memory: memoryContext(session.memory, "gate"),
        ...(flowSig
          ? {
              flow: {
                imbalance: flowSig.imbalance, confidence: flowSig.confidence, accumulation: flowSig.accumulation,
                newHolders: flowSig.window.newHolders, grossVolumeWeth: flowSig.window.grossVolumeWeth,
              },
              research: { style: edge.researchStyle, flowWeight: edge.flowWeight, flowSkepticism: edge.flowSkepticism },
            }
          : {}),
      });
      if (gate.decision === "approve") {
        const quote = quotes.get(signal.symbol)!;
        const notional = aggressionToPositionPct(edge.aggression) * mark.equityUsd * gate.sizeMult;
        const res = engine.tryBuy({ symbol: signal.symbol, notionalUsd: notional, quote, nowMs, tick });
        if (res.ok) {
          trade = {
            ...fillToTrade(res.fill),
            thesis: composeThesis({
              kind: "entry",
              thesis: gate.thesis,
              voice: genome.voice,
              rng: seededRng(`${id}-thesis-${tick}`),
            }),
          };
          countTrade(session.memory, { symbol: signal.symbol });
          journal(session.memory, {
            atMs: nowMs, kind: "trade",
            text: `bought ${signal.symbol} $${notional.toFixed(2)} — ${trade.thesis}`,
            data: { symbol: signal.symbol, notionalUsd: Number(notional.toFixed(2)) },
          });
          tweetKind = "entry";
          tweetSlots = { symbol: signal.symbol, thesis: gate.thesis };
        }
      } else {
        // a rejected setup is still a decision — the arena sees the reasoning (A4)
        session.memory.counters.vetoes += 1;
        veto = {
          symbol: signal.symbol,
          thesis: composeThesis({
            kind: "veto",
            thesis: gate.thesis,
            voice: genome.voice,
            rng: seededRng(`${id}-thesis-${tick}`),
          }),
        };
        journal(session.memory, { atMs: nowMs, kind: "veto", text: `passed on ${signal.symbol} — ${veto.thesis}`, data: { symbol: signal.symbol } });
      }
    }
  }

  // 3) occasional idle post keeps the voice alive between trades
  if (!tweetKind && tick % 5 === 2) {
    tweetKind = "idle";
    tweetSlots = { symbol: edge.universe[tick % edge.universe.length] ?? edge.universe[0]! };
  }

  // 4) compose within the postsPerDay budget — memory-fed anti-repeat — then ALWAYS run the guard
  let tweet: TweetOut | undefined;
  if (tweetKind) {
    const used = session.postedByDay.get(dayIndex) ?? 0;
    if (used < genome.voice.postsPerDay) {
      const text = composeTweet({
        kind: tweetKind,
        name: genome.meta.name,
        ticker: genome.meta.ticker,
        voice: genome.voice,
        rng: seededRng(`${id}-tweet-${tick}`),
        avoid: recentPostTexts(session.memory, 5),
        ...tweetSlots,
      });
      const verdict = (input.tweetGuard ?? true)
        ? guardTweet(text, { ticker: genome.meta.ticker })
        : { ok: true as const }; // B4 flag: guard retired for live posting (owner decision)
      tweet = verdict.ok
        ? { text, rejected: false, kind: tweetKind }
        : { text, rejected: true, ...(verdict.rule !== undefined ? { rule: verdict.rule } : {}), kind: tweetKind };
      if (!verdict.ok) session.guardRejections += 1;
      else {
        session.memory.counters.posts += 1;
        journal(session.memory, { atMs: nowMs, kind: "post", text });
      }
      session.postedByDay.set(dayIndex, used + 1);
    }
  }

  return {
    ...(trade !== undefined ? { trade } : {}),
    ...(veto !== undefined ? { veto } : {}),
    ...(tweet !== undefined ? { tweet } : {}),
    equityUsd: mark.equityUsd,
    tick,
  };
}

/**
 * Orchestrator accessor: the system debits compute burn, credits the discretion fee share, and
 * executes death sweeps through the SAME engine the quant trades on (production analog:
 * one wallet per quant). Never used by the trading path itself.
 */
export function getSessionEngine(id: string): PaperEngine | null {
  return sessions.get(id)?.engine ?? null;
}

/** Wire shape of one persisted quant session (season-0 daemon restarts). */
export interface QuantSessionState {
  engine: PaperEngineState;
  postedByDay: Array<[dayIndex: number, used: number]>;
  guardRejections: number;
  /** the §5.4 memory stack; absent in pre-B2 worlds — rebuilt empty on restore */
  memory?: MemoryState;
  /** B2b: trailing-exit peaks + drawdown baseline; absent in pre-B2b worlds (defaults apply) */
  peaks?: Array<[symbol: string, price: number]>;
  peakEquityUsd?: number;
}

/** Persist every in-process session (the daemon snapshots these each cycle). */
export function serializeQuantSessions(): Record<string, QuantSessionState> {
  const out: Record<string, QuantSessionState> = {};
  for (const [id, s] of sessions) {
    out[id] = {
      engine: s.engine.serialize(),
      postedByDay: [...s.postedByDay.entries()],
      guardRejections: s.guardRejections,
      memory: s.memory,
      peaks: [...s.peaks.entries()],
      peakEquityUsd: s.peakEquityUsd,
    };
  }
  return out;
}

/** Rebuild one session exactly as persisted — used on daemon restart, before any tick runs. */
export function restoreQuantSession(genome: Genome | GenomeInput, state: QuantSessionState, atMs?: number): void {
  const parsed = parseGenome(genome);
  sessions.set(parsed.meta.id, {
    genome: parsed,
    engine: PaperEngine.restore(state.engine),
    postedByDay: new Map(state.postedByDay),
    guardRejections: state.guardRejections,
    // pre-B2 worlds carry no memory: start one clean, cursors pinned to "now" so the rolling
    // schedule doesn't backfill a history that was never journaled
    memory: state.memory ?? createMemory(null, atMs ?? state.engine.dayAnchorMs ?? 0),
    // pre-B2b worlds carry no trail state: peaks rebuild from entries, the drawdown
    // baseline restarts at the seed (conservative: no phantom drawdown on day one)
    peaks: new Map(state.peaks ?? []),
    peakEquityUsd: state.peakEquityUsd ?? state.engine.seedUsd,
  });
}

/** Session introspection for sims/tests (never used by the trading path). */
export function inspectSession(id: string): { equityUsd: number; positions: number; fills: number; guardRejections: number } | null {
  const s = sessions.get(id);
  if (!s) return null;
  return {
    equityUsd: s.engine.snapshot().lastEquityUsd,
    positions: s.engine.positions.size,
    fills: s.engine.fills.length,
    guardRejections: s.guardRejections,
  };
}

/* ── §5.4 memory accessors for the orchestrator (the system sees memory through these only) ── */

/** Read a quant's memory (world rendering, tests). */
export function getSessionMemory(id: string): MemoryState | null {
  return sessions.get(id)?.memory ?? null;
}

/**
 * The parent's birth letter for its child, written from the parent's own memory at birth
 * time (§5.4): inherited wisdom without shared memory. Journals the birth into the parent.
 */
export function composeBirthLetter(parentId: string, parentName: string, childName: string, atMs: number): string | null {
  const mem = sessions.get(parentId)?.memory;
  if (!mem) return null;
  const letter = writeBirthLetter(mem, parentName, childName);
  mem.counters.childrenHad += 1;
  journal(mem, { atMs, kind: "birth", text: `my child ${childName} was born — my letter went with it` });
  return letter;
}

/** A fee claim landed in the quant's wallet — its own memory should know its income. */
export function noteFeeClaim(id: string, usd: number, atMs: number): void {
  const mem = sessions.get(id)?.memory;
  if (!mem) return;
  mem.counters.feesClaimedUsd += usd;
  journal(mem, { atMs, kind: "note", text: `claimed $${usd.toFixed(2)} creator fees` });
}

/** A post the orchestrator drove (X replies) — journal it into the agent's own memory. */
export function noteSocialPost(id: string, text: string, atMs: number): void {
  const mem = sessions.get(id)?.memory;
  if (!mem) return;
  mem.counters.posts += 1;
  journal(mem, { atMs, kind: "post", text });
}

/** A species event the quant witnessed (births/deaths of others) — journal-only. */
export function noteWitness(id: string, text: string, kind: "birth" | "death", atMs: number): void {
  const mem = sessions.get(id)?.memory;
  if (mem) journal(mem, { atMs, kind, text });
}

/** Death seals the memory: final entry + the sealed self-model published on the grave (§5.4). */
export function sealSessionMemory(
  id: string,
  opts: { name: string; cause: string; finalWords: string; bornAtMs: number; diedAtMs: number },
): string | null {
  const mem = sessions.get(id)?.memory;
  return mem ? sealMemory(mem, opts) : null;
}
