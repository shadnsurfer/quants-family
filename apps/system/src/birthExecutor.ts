/**
 * Birth executor — the parent-instructed reproduction mechanic (PROJECT.md §4.4, 2026-08-02).
 *
 * An eligible quant reproduces ONE child per event, funded entirely from its own balance
 * (the funding cascade: endowment = 20% of the parent's current equity, covering the Pons
 * launch fee, remainder = trading seed ≥ $200). The child genome is the parent's design:
 * an exact copy pushed through the mutation engine. The system only runs the mechanics —
 * the decision, the design, and the money are the parent's.
 *
 * The lifetime allowance (OFFSPRING milestones) is re-verified here at execution — the
 * watcher gates upstream, but execution never trusts upstream. An aborted birth (allowance
 * exhausted, parent too poor) returns null WITHOUT burning the parent's cooldown.
 */
import {
  MONEY, childEndowmentCents, childSeedOk, designChildIdentity, genomeHash, mutate,
  offspringAllowance, selfGeneOrigins, spawnGenome, usdToCents,
  type Genome, type Rng,
} from "@quants/core";
import type { FlowLedger } from "./flows.js";
import type { PonsLike, QuantRecord, WalletProvider } from "./types.js";

export interface BirthResult {
  child: QuantRecord;
}

export interface BirthContext {
  quants: readonly QuantRecord[];
  ledger: FlowLedger;
  pons: PonsLike;
  rng: Rng;
  nowMs: number;
  ethUsdPrice: number;
  /** compute burn model, $/day as a function of decision cadence */
  burnForCadence: (cadenceMin: number) => number;
  /** starting fee inflow for a newborn's token, $/hour (live: 0 — fees are observed) */
  newbornFeeRate: (rng: Rng) => number;
  /** issues the child's own EVM wallet at birth (creator-fee wallet from day one) */
  walletFor: WalletProvider;
  /** the parent's current equity — the source of the funding cascade */
  parentEquityUsd: number;
  /**
   * Move USD out of a quant's real balance (sim: engine cash + equity map; live: an on-chain
   * wallet→wallet transfer). Returns the amount actually moved.
   */
  debitEquity: (quantId: string, usd: number) => number;
}

/** Execute one birth for `parent`. Mutates the parent's cooldown/childrenCount and the ledger. */
export async function executeBirth(parent: QuantRecord, ctx: BirthContext): Promise<BirthResult | null> {
  // the lifetime allowance, re-verified at execution (never trust upstream)
  if (!(parent.childrenCount < offspringAllowance(parent.generatedPeakUsd))) return null;

  const launchFeeCents = usdToCents(MONEY.launchFeeEth * ctx.ethUsdPrice);
  const endowmentCents = childEndowmentCents(usdToCents(ctx.parentEquityUsd));
  // parent too poor for a viable child (seed ≥ $200 after the launch fee) — no cooldown burned
  if (!childSeedOk(endowmentCents, launchFeeCents)) return null;

  const gen = parent.generation + 1;

  // the parent's design: clone, mutate, THEN name — sports get freak names on purpose
  // (attention is a selection factor; unconventional names are welcome)
  const draft = spawnGenome(parent.genome, { name: "unnamed", ticker: "QNT", id: `g${gen}-unnamed` });
  const { genome: mutated, log: mutationLog } = mutate(draft, ctx.rng);
  const sport = mutationLog.some((l) => l.startsWith("SPORT"));
  const { name, ticker, id, xHandle } = designChildIdentity({
    parent: parent.genome,
    rng: ctx.rng,
    gen,
    sport,
    takenNames: new Set(ctx.quants.map((q) => q.name)),
    takenIds: new Set(ctx.quants.map((q) => q.id)),
    takenTickers: new Set(ctx.quants.map((q) => q.ticker)),
  });
  const designed: Genome = { ...mutated, meta: { ...mutated.meta, id, name, ticker } };
  const hash = genomeHash(designed);

  // the child's own wallet is born first — it becomes the immutable creator-fee wallet
  const walletAddr = await ctx.walletFor(id);
  const launch = await ctx.pons.launch({ name, ticker }, walletAddr, 0); // dev-buy 0 — airdrops are gone

  // ── the funding cascade: debit the parent's own wallet for the child's endowment ──
  const moved = ctx.debitEquity(parent.id, endowmentCents / 100);
  const movedCents = usdToCents(moved);
  const seedCents = movedCents - launchFeeCents;
  ctx.ledger.record("birth-funding", movedCents, { fromId: parent.id, toId: id, atMs: ctx.nowMs });
  ctx.ledger.record("launch-fee", launchFeeCents, { fromId: id, toId: "$sink", atMs: ctx.nowMs, note: "pons launch" });

  const genome: Genome = {
    ...designed,
    meta: { ...designed.meta, birthTx: launch.tx, genomeHash: hash },
  };
  const origins = selfGeneOrigins(parent.genome, genome);

  const child: QuantRecord = {
    id,
    name,
    ticker,
    xHandle,
    generation: gen,
    parents: [parent.id],
    genome,
    genomeHash: hash,
    status: "alive",
    bornAtMs: ctx.nowMs,
    diedAtMs: null,
    causeOfDeath: null,
    finalWords: null,
    seedUsd: seedCents / 100,
    processRunning: true,
    lastBroodAtMs: null,
    peakEquityUsd: seedCents / 100,
    feeRatePerHourUsd: ctx.newbornFeeRate(ctx.rng),
    dailyBurnUsd: ctx.burnForCadence(genome.edge.cadenceMin),
    computeReserveUsd: 0,
    unclaimedFeesUsd: 0,
    walletAddr,
    tokenAddr: launch.tokenAddr,
    poolAddr: launch.poolAddr,
    birthTx: launch.tx,
    geneOrigins: origins,
    endowment: {
      fromQuantId: parent.id,
      totalUsd: movedCents / 100,
      launchFeeUsd: launchFeeCents / 100,
      tradingSeedUsd: seedCents / 100,
    },
    claimedTotalUsd: 0,
    rewardPaidTotalUsd: 0,
    rewardOwedUsd: 0,
    generatedPeakUsd: 0,
    childrenCount: 0,
    birthLetter: null, // the orchestrator assigns the parent's letter after a successful birth
    sealedMemory: null,
  };

  parent.lastBroodAtMs = ctx.nowMs;
  parent.childrenCount += 1;
  return { child };
}
