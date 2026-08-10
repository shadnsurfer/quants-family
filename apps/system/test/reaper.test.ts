/**
 * Reaper (PROJECT.md §4.5, §6): the death routine must be atomic and zombie-free — process
 * halted, every position force-closed on a REAL PaperEngine, realized P&L reconciled, then the
 * ENTIRE estate (cash + compute reserve + unclaimed fees) swept to the champion in one
 * cents-exact "champion-sweep" flow entry (the operator treasury when no champion survives),
 * the champion's real balance credited, grave fields written, and final words that still pass
 * the tweet guard.
 *
 * The dead quant's ledger account is pre-funded to its exact estate (as the sim's continuous
 * reconciliation would leave it) — the flow ledger's solvency gate otherwise refuses the sweep.
 * Expected sweep amounts come from a twin engine driven through the identical fill sequence —
 * no re-implementation of slippage math in the test.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNAL_GENES, usdToCents, type DeathCause } from "@quants/core";
import { FIXTURE_EPOCH_MS, PaperEngine, type Quote } from "@quants/paper";
import { guardTweet } from "@quants/brain";
import { FlowLedger, reap, type QuantRecord, type ReapContext } from "../src/index.js";

const HOUR_MS = 3_600_000;
const NOW_MS = FIXTURE_EPOCH_MS + 7 * HOUR_MS;
const CHAMPION = "g1-sigma";

const q = (symbol: string, mid: number, spreadBps = 20): Quote => ({ symbol, mid, spreadBps });

function makeQuant(over: Partial<QuantRecord> = {}): QuantRecord {
  return {
    id: "g1-kelly", name: "kelly", ticker: "KELLY", generation: 1, parents: [],
    genome: {
      meta: { id: "g1-kelly", name: "kelly", ticker: "KELLY", generation: 1, parents: [], mutations: [], birthTx: null, genomeHash: null },
      edge: {
        archetype: "momentum", universe: ["NVDA", "TSLA"], aggression: 0.85,
        patience: { minHoldMin: 30, maxHoldHrs: 48 }, fear: 0.05, conviction: 0.12,
        cadenceMin: 20, darkHours: 0.5, entryThesisStyle: "strict-confluence",
        signal: { ...DEFAULT_SIGNAL_GENES },
        researchStyle: "priceAction", flowWeight: 0, flowSkepticism: 0.5,
      },
      econ: { holderRewardPct: 0.2 },
      voice: {
        archetype: "cocky", postsPerDay: 6, flexStyle: "receipts-only",
        beefiness: 0.3, lowercase: true, emojiPolicy: "none",
      },
    },
    genomeHash: "0xfixture", status: "alive",
    bornAtMs: FIXTURE_EPOCH_MS, diedAtMs: null, causeOfDeath: null, finalWords: null,
    seedUsd: 500, processRunning: true, lastBroodAtMs: null,
    peakEquityUsd: 500, feeRatePerHourUsd: 0.5, dailyBurnUsd: 0.7,
    computeReserveUsd: 12.34, unclaimedFeesUsd: 5.66,
    walletAddr: "0xwallet-g1-kelly", tokenAddr: "0xtok", poolAddr: "0xpool", birthTx: "tx",
    claimedTotalUsd: 0, rewardPaidTotalUsd: 0, rewardOwedUsd: 0,
    generatedPeakUsd: 0, childrenCount: 0,
    ...over,
  };
}

/** Fresh engine with two open positions (NVDA long $60 @ ~100, TSLA long $30 @ ~200). */
function engineWithPositions(): PaperEngine {
  const engine = new PaperEngine({ seedUsd: 500, startMs: FIXTURE_EPOCH_MS });
  const quotes = new Map([["NVDA", q("NVDA", 100)], ["TSLA", q("TSLA", 200)]]);
  engine.markToMarket(quotes, FIXTURE_EPOCH_MS);
  expect(engine.tryBuy({ symbol: "NVDA", notionalUsd: 60, quote: q("NVDA", 100), nowMs: FIXTURE_EPOCH_MS, tick: 0 }).ok).toBe(true);
  expect(engine.tryBuy({ symbol: "TSLA", notionalUsd: 30, quote: q("TSLA", 200), nowMs: FIXTURE_EPOCH_MS, tick: 0 }).ok).toBe(true);
  expect(engine.positions.size).toBe(2);
  return engine;
}

/** Exit quotes for the death sweep: NVDA closed at a loss, TSLA at a gain. */
const EXIT_QUOTES: ReadonlyMap<string, Quote> = new Map([
  ["NVDA", q("NVDA", 90)],
  ["TSLA", q("TSLA", 210)],
]);
const quoteFor = (symbol: string): Quote => EXIT_QUOTES.get(symbol)!;

/** What the cash MUST be after both sweep-sells, per an identical twin engine. */
function expectedCashAfterSweep(): number {
  const twin = engineWithPositions();
  for (const symbol of ["NVDA", "TSLA"]) {
    const res = twin.trySell({ symbol, quote: quoteFor(symbol), nowMs: NOW_MS, tick: 5, reason: "death-sweep" });
    expect(res.ok).toBe(true);
  }
  return twin.cashUsd;
}

interface ReapRig {
  quant: QuantRecord;
  engine: PaperEngine | null;
  ledger: FlowLedger;
  credits: Array<{ quantId: string; usd: number }>;
  syncCalls: Array<{ openPositions: number; cashUsd: number; reserveUsd: number }>;
  result: { sweptUsd: number; finalWords: string };
}

/**
 * Run the full death routine. The ledger is pre-funded so the dead quant's account holds
 * exactly `fundUsd` (its reconciled estate) — pass the twin-computed total for an exact drain.
 */
function runReap(
  cause: DeathCause,
  opts: {
    engine?: PaperEngine | null;
    fundUsd: number;
    championId?: string | null;
    withSync?: boolean;
    quant?: QuantRecord;
  },
): ReapRig {
  const quant = opts.quant ?? makeQuant();
  const engine = opts.engine === undefined ? engineWithPositions() : opts.engine;
  const ledger = new FlowLedger();
  if (opts.fundUsd > 0) {
    ledger.record("market-pnl", usdToCents(opts.fundUsd), { fromId: "$market", toId: quant.id, atMs: NOW_MS - 1 });
  }
  const credits: ReapRig["credits"] = [];
  const syncCalls: ReapRig["syncCalls"] = [];
  const ctx: ReapContext = {
    engine,
    quoteFor: engine ? quoteFor : () => q("NVDA", 100),
    ledger,
    nowMs: NOW_MS,
    tick: 5,
    championId: opts.championId === undefined ? CHAMPION : opts.championId,
    creditEquity: (quantId, usd) => credits.push({ quantId, usd }),
    ...(opts.withSync
      ? {
          syncRealized: () => syncCalls.push({
            openPositions: engine?.positions.size ?? 0,
            cashUsd: engine?.cashUsd ?? 0,
            reserveUsd: quant.computeReserveUsd,
          }),
        }
      : {}),
  };
  const result = reap(quant, cause, ctx);
  return { quant, engine, ledger, credits, syncCalls, result };
}

describe("reap with a live engine and open positions", () => {
  const expectedTotal = () => expectedCashAfterSweep() + 12.34 + 5.66;

  it("halts the process and closes every position — no zombie trades after death", () => {
    const { quant, engine } = runReap("ruin", { fundUsd: expectedTotal() });
    expect(quant.processRunning).toBe(false);
    expect(quant.status).toBe("dead");
    expect(engine!.positions.size).toBe(0);
    const sweepFills = engine!.fills.filter((f) => f.reason === "death-sweep");
    expect(sweepFills).toHaveLength(2);
    for (const f of sweepFills) expect(f.side).toBe("sell");
  });

  it("sweeps the entire estate to the CHAMPION in ONE cents-exact flow entry, and credits its balance", () => {
    const total = expectedTotal();
    const { quant, engine, ledger, credits, result } = runReap("ruin", { fundUsd: total });

    expect(result.sweptUsd).toBeCloseTo(total, 9);
    // the estate is drained to zero — engine, reserve, fees, and the ledger view all agree
    expect(engine!.snapshot().cashUsd).toBe(0);
    expect(quant.computeReserveUsd).toBe(0);
    expect(quant.unclaimedFeesUsd).toBe(0);
    expect(ledger.balanceOf(quant.id)).toBe(0);

    const sweeps = ledger.entries.filter((e) => e.type === "champion-sweep");
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]).toEqual({
      type: "champion-sweep",
      amountCents: usdToCents(total),
      fromId: "g1-kelly",
      toId: CHAMPION,
      atMs: NOW_MS,
      note: "ruin",
    });
    expect(ledger.balanceOf(CHAMPION)).toBe(usdToCents(total));
    expect(credits).toHaveLength(1);
    expect(credits[0]!.quantId).toBe(CHAMPION);
    expect(credits[0]!.usd).toBeCloseTo(total, 9); // the champion's REAL balance is credited
    expect(ledger.conservationCheck().ok).toBe(true);
  });

  it("no living champion → the sweep falls to $operator-treasury and NO quant is credited", () => {
    const total = expectedTotal();
    const { ledger, credits, result } = runReap("ruin", { fundUsd: total, championId: null });
    expect(result.sweptUsd).toBeCloseTo(total, 9);
    const sweeps = ledger.entries.filter((e) => e.type === "champion-sweep");
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]!.toId).toBe("$operator-treasury");
    expect(ledger.balanceOf("$operator-treasury")).toBe(usdToCents(total));
    expect(credits).toHaveLength(0); // the treasury is external — nothing to credit
    expect(ledger.conservationCheck().ok).toBe(true);
  });

  it("invokes syncRealized after the positions close but BEFORE the estate drains", () => {
    const total = expectedTotal();
    const { syncCalls, result } = runReap("ruin", { fundUsd: total, withSync: true });
    expect(result.sweptUsd).toBeCloseTo(total, 9);
    expect(syncCalls).toHaveLength(1);
    // at hook time: positions already closed (0 open), cash still in the engine,
    // compute reserve not yet zeroed — the drain happens after reconciliation
    expect(syncCalls[0]!.openPositions).toBe(0);
    expect(syncCalls[0]!.cashUsd).toBeGreaterThan(0);
    expect(syncCalls[0]!.reserveUsd).toBe(12.34);
  });

  it("writes the grave row: cause, time of death, final words", () => {
    const { quant, result } = runReap("ruin", { fundUsd: expectedTotal() });
    expect(quant.causeOfDeath).toBe("ruin");
    expect(quant.diedAtMs).toBe(NOW_MS);
    expect(quant.finalWords).toBe(result.finalWords);
    expect(result.finalWords.length).toBeGreaterThan(0);
  });

  it("final words pass the tweet guard, in the quant's own ticker context", () => {
    const { quant } = runReap("ruin", { fundUsd: expectedTotal() });
    expect(guardTweet(quant.finalWords!, { ticker: quant.ticker }).ok).toBe(true);
  });

  it("records starvation as its own cause on the grave and the flow note", () => {
    const { quant, ledger } = runReap("starvation", { fundUsd: expectedTotal() });
    expect(quant.causeOfDeath).toBe("starvation");
    expect(ledger.entries.find((e) => e.type === "champion-sweep")!.note).toBe("starvation");
  });

  it("final words are deterministic: the same quant dies with the same words every time", () => {
    const a = runReap("ruin", { fundUsd: expectedTotal() });
    const b = runReap("ruin", { fundUsd: expectedTotal() });
    expect(a.result.finalWords).toBe(b.result.finalWords);
  });

  it("a reconciled estate the ledger cannot cover would throw — the solvency gate backs the sweep", () => {
    // funded $1 short of the true estate: the sweep entry must be refused by the ledger
    const total = expectedTotal();
    expect(() => runReap("ruin", { fundUsd: total - 0.01 })).toThrow(/insolvent/);
  });
});

describe("reap without an engine (process died before it ever traded)", () => {
  it("sweeps compute reserve + unclaimed fees only, to the champion", () => {
    const quant = makeQuant({ computeReserveUsd: 3.33, unclaimedFeesUsd: 0.01 });
    const { ledger, credits, result } = runReap("starvation", { engine: null, fundUsd: 3.34, quant });
    expect(result.sweptUsd).toBeCloseTo(3.34, 9);
    const sweeps = ledger.entries.filter((e) => e.type === "champion-sweep");
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]!.amountCents).toBe(334);
    expect(sweeps[0]!.toId).toBe(CHAMPION);
    expect(ledger.balanceOf(quant.id)).toBe(0);
    expect(credits).toHaveLength(1);
    expect(credits[0]!.usd).toBeCloseTo(3.34, 9);
    expect(quant.status).toBe("dead");
    expect(quant.processRunning).toBe(false);
  });

  it("a penniless death sweeps nothing and records NO flow entry — but still buries the quant", () => {
    const quant = makeQuant({ computeReserveUsd: 0, unclaimedFeesUsd: 0 });
    const { ledger, credits, result } = runReap("ruin", { engine: null, fundUsd: 0, quant });
    expect(result.sweptUsd).toBe(0);
    expect(ledger.entries).toHaveLength(0);
    expect(credits).toHaveLength(0);
    expect(quant.status).toBe("dead");
    expect(quant.finalWords).not.toBeNull();
    expect(quant.finalWords!.length).toBeGreaterThan(0);
    expect(ledger.conservationCheck().ok).toBe(true);
  });
});

describe("reap with positions open deep in the red (exits always allowed)", () => {
  it("closes positions and sweeps regardless of how hard the day is going", () => {
    const engine = new PaperEngine({ seedUsd: 500, startMs: FIXTURE_EPOCH_MS });
    engine.markToMarket(new Map([["NVDA", q("NVDA", 100)]]), FIXTURE_EPOCH_MS);
    expect(engine.tryBuy({ symbol: "NVDA", notionalUsd: 74, quote: q("NVDA", 100), nowMs: FIXTURE_EPOCH_MS, tick: 0 }).ok).toBe(true);
    // NVDA collapses to 40 → day loss ≈ −8.9%; there is no halt anymore — the reaper just closes
    const mark = engine.markToMarket(new Map([["NVDA", q("NVDA", 40)]]), FIXTURE_EPOCH_MS + HOUR_MS);
    expect(mark.dayPnlPct).toBeLessThan(-0.08);

    const quant = makeQuant();
    const { ledger, result } = runReap("ruin", { engine, fundUsd: 600, quant });
    expect(result.sweptUsd).toBeGreaterThan(0);
    expect(engine.positions.size).toBe(0);
    expect(engine.snapshot().cashUsd).toBe(0);
    expect(quant.status).toBe("dead");
    expect(ledger.entries.filter((e) => e.type === "champion-sweep")).toHaveLength(1);
    expect(ledger.balanceOf(quant.id)).toBe(usdToCents(600) - usdToCents(result.sweptUsd));
    expect(ledger.conservationCheck().ok).toBe(true);
  });
});

describe("the guard the final words must pass is a real guard", () => {
  it("rejects buy urging, price prediction, and return promises; accepts factual P&L", () => {
    expect(guardTweet("buy now before the next leg", {}).ok).toBe(false);
    expect(guardTweet("$KELLY is going to pump, price target $5", { ticker: "KELLY" }).ok).toBe(false);
    expect(guardTweet("staking soon: guaranteed returns and passive income", {}).ok).toBe(false);
    expect(guardTweet("closed nvda +2.1%. process held.", { ticker: "KELLY" }).ok).toBe(true);
  });
});
