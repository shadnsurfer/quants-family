/**
 * runEvolution (M3 referee entry): a deterministic, time-accelerated run of the whole species
 * in paper mode — REAL machinery end to end (quant runtime ticks, core eligibility/mutation/
 * death math, double-entry flow ledger, birth executor, reaper). No wall clock, no network.
 *
 * 2026-08-02 model: no pool, no tithe, no airdrops. Genesis seeds come from "$operator"; every
 * later birth is funded by the parent's own balance. Fee claims split 10% compute reserve /
 * r% holder rewards (econ gene) / remainder discretion. Death sweeps go to the champion.
 * Reproduction is allowance-gated (OFFSPRING milestones on lifetime generated capital).
 *
 * Bootstrap: eve (gen 0) is resumed 90h old with two pre-spawned gen-1 children (the real spawn
 * machinery, seeded rng). eve's allowance (2 children at >$2k generated) is already spent, so
 * the in-window birth must come from child1 (allowance 1 at >$1k) — which also exercises the
 * allowance gate on eve. child2 is resumed a whisper above the ruin line with collapsed fees;
 * burn debits push it under §4.5 mid-sim on the referee's seed (tape-dependent: a lucky trading
 * run can rescue it under other seeds).
 *
 * Time model: `accel × minutes` minutes of simulated time, stepped 20 sim-minutes at a time,
 * executed as fast as the machine allows. Each quant trades on its own cadence grid.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  childName, genomeHash, hashSeed, mutate, OFFSPRING, offspringAllowance, parseGenome, seededRng,
  selfGeneOrigins, spawnGenome, splitFeeClaimCents, usdToCents, xHandleOf,
  type FitnessRow, type Genome,
} from "@quants/core";
import { FIXTURE_EPOCH_MS, quoteAt } from "@quants/paper";
import {
  composeBirthLetter, getSessionEngine, getSessionMemory, noteFeeClaim, noteWitness,
  resetQuantSessions, runQuantOnce, sealSessionMemory,
} from "@quants/quant";
import { FlowLedger } from "./flows.js";
import { PaperPons } from "./paperPons.js";
import { executeBirth } from "./birthExecutor.js";
import { reap } from "./reaper.js";
import { buildFitnessTable, evaluateBreeding, evaluateDeaths, pickChampion } from "./watcher.js";
import type { EvolutionEvent, QuantRecord, WalletProvider } from "./types.js";

/**
 * Deterministic paper wallet addresses (hash-derived, clearly not custodial) so sim runs stay
 * byte-identical. Live births swap in @quants/chain birthWallet via the same WalletProvider.
 */
export function paperWalletProvider(quantId: string): string {
  const h1 = hashSeed(`wallet:${quantId}`).toString(16).padStart(8, "0");
  const h2 = hashSeed(`${quantId}:wallet`).toString(16).padStart(8, "0");
  return `0x${(h1 + h2).repeat(3).slice(0, 40)}`;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const HOUR_MS = 3_600_000;
const STEP_MIN = 20;

export interface EvolutionConfig {
  seed: number;
  accel: number;
  minutes: number;
  mode: "paper";
}

export interface EvolutionQuantOut {
  id: string; name: string; ticker: string;
  /** the agent's X handle (sanitized ≤ 15 chars) */
  xHandle: string;
  status: "alive" | "dead";
  processRunning: boolean;
  openPositions: number;
  generation: number;
  parents: string[];
  equityUsd: number;
  seedUsd: number;
  fitness: number | null;
  archetype: string;
  voice: string;
  causeOfDeath: string | null;
  finalWords: string | null;
  bornAtMs: number;
  diedAtMs: number | null;
  walletAddr: string;
  tokenAddr: string;
  genomeHash: string;
  /** the mutation log written at birth design time ("path: old→new", SPORT-prefixed for flips) */
  mutations: string[];
  /** per-gene provenance for bred quants: parent | mutated */
  geneOrigins: Record<string, import("@quants/core").GeneOrigin> | null;
  /** the full genome — public by design; the agent prompt derives from it */
  genome: Genome;
  /** how this quant was funded from its parent's balance (null for bootstrap agents) */
  endowment: { fromQuantId: string; totalUsd: number; launchFeeUsd: number; tradingSeedUsd: number } | null;
  /** econ gene: share of claimed fees routed to holders, weekly */
  holderRewardPct: number;
  /** cumulative fees claimed / rewards paid, USD */
  claimedTotalUsd: number;
  rewardPaidTotalUsd: number;
  /** holder rewards earmarked in the compute reserve, awaiting the weekly distribution */
  rewardOwedUsd: number;
  /** reproduction governor: peak generated capital, allowance, children born */
  generatedPeakUsd: number;
  allowance: number;
  childrenCount: number;
  /** ledger reconciliation: estate (cash + positions-at-cost + reserve + unclaimed) vs ledger view */
  estateUsd: number;
  ledgerBalanceUsd: number;
  /** §5.4: the living agent's current self-model; the dead agent's sealed grave memory */
  selfModel: string | null;
}

export interface EvolutionResult {
  config: EvolutionConfig;
  simStartMs: number;
  simEndMs: number;
  births: number;
  deaths: number;
  quants: EvolutionQuantOut[];
  flows: ReturnType<FlowLedger["toJSON"]>;
  events: EvolutionEvent[];
}

/** compute burn scales with decision cadence: base VPS share + per-LLM-call cost */
export function burnForCadence(cadenceMin: number): number {
  return 0.3 + 0.005 * (1440 / cadenceMin);
}

/**
 * Orphan-fee claims (B6): a dead agent's token keeps trading and its pool keeps accruing
 * creator fees. The system claims them on the normal claim cadence once they clear this
 * threshold (gas discipline live; parity in sim) and sweeps them to the reigning champion —
 * the dead feed the champion, on-chain too.
 */
export const ORPHAN_CLAIM_MIN_USD = 5;

const PROGENITOR = "quants";

/**
 * hand-shaped resume state: [equity ×seed, feeRate $/h, generatedPeak $, childrenCount],
 * indexed [quants, child1, child2]. quants' allowance (2) is spent on the two pre-spawned children;
 * child1 (allowance 1) leads fitness and births gen 2 in-window; child2 sits just above the
 * ruin line with collapsed fees — burn debits push it under §4.5 mid-sim on the referee seed (42).
 */
const BOOTSTRAP: readonly (readonly [equityMult: number, feeRatePerHour: number, generatedPeakUsd: number, childrenCount: number])[] = [
  [1.31, 0.5, 2100, 2],
  [1.45, 0.8, 1200, 0],
  [0.50002, 0, 0, 0],
];

const GENESIS_SEED_USD = 1_500;
const ETH_USD = 3_000;

function loadGenesisGenome(name: string): Genome {
  const raw = JSON.parse(readFileSync(resolve(ROOT, "data/genesis", `${name}.json`), "utf8"));
  return parseGenome(raw);
}

/**
 * The reconciled estate: cash + open positions AT COST + compute reserve + unclaimed fees.
 * Buys move cash→positions within the estate; sells realize P&L (a market-pnl flow); unrealized
 * drift touches neither. This is exactly what the flow ledger's per-agent view must match.
 */
export function estateUsdOf(q: QuantRecord): number {
  const engine = getSessionEngine(q.id);
  if (!engine) return q.status === "dead" ? 0 : q.seedUsd;
  let positionsCost = 0;
  for (const pos of engine.positions.values()) positionsCost += pos.entryNotionalUsd;
  return engine.cashUsd + positionsCost + q.computeReserveUsd + q.unclaimedFeesUsd;
}

export async function runEvolution(cfg: EvolutionConfig): Promise<EvolutionResult> {
  if (cfg.mode !== "paper") {
    throw new Error("runEvolution refuses non-paper mode: live capital is gated behind the Phase 6 checklist");
  }
  resetQuantSessions();

  const simStartMs = FIXTURE_EPOCH_MS;
  const totalSimMin = Math.floor(cfg.accel * cfg.minutes);
  const rngBreed = seededRng(`evolution-${cfg.seed}-breed`);
  const pons = new PaperPons();
  const ledger = new FlowLedger();
  const events: EvolutionEvent[] = [];
  const quants: QuantRecord[] = [];
  const bootEquity = new Map<string, number>();

  // ── bootstrap the resumed lineage: eve (gen 0) + two pre-spawned gen-1 children,
  //    built through the REAL spawn machinery (clone + mutate, seeded) so genomes/origins
  //    are exactly what production births produce.
  const rngBoot = seededRng(`evolution-${cfg.seed}-bootstrap`);
  const eveGenome = loadGenesisGenome(PROGENITOR);
  const bootRecords: Array<{ genome: Genome; bornAgoH: number; parents: string[]; origins: ReturnType<typeof selfGeneOrigins> | null }> = [
    { genome: eveGenome, bornAgoH: 90, parents: [], origins: null },
  ];
  const takenNames = new Set<string>([PROGENITOR]);
  for (let i = 0; i < 2; i++) {
    const named = childName(rngBoot, takenNames, 1);
    takenNames.add(named.name);
    const id = `g1-${named.name}`;
    const cloned = spawnGenome(eveGenome, { ...named, id });
    const { genome: mutated } = mutate(cloned, rngBoot);
    bootRecords.push({ genome: mutated, bornAgoH: 80, parents: [eveGenome.meta.id], origins: selfGeneOrigins(eveGenome, mutated) });
  }

  bootRecords.forEach(({ genome, bornAgoH, parents, origins }, i) => {
    const [equityMult, feeRate, generatedPeak, childrenCount] = BOOTSTRAP[i]!;
    const launch = pons.launch({ name: genome.meta.name, ticker: genome.meta.ticker }, `wallet-${genome.meta.name}`, 0);
    const seedCents = usdToCents(GENESIS_SEED_USD);
    // resume bootstrap: genesis seeds are the ONLY operator-funded flows. Historical realized
    // P&L is reconciled as market-pnl so the ledger view matches the resumed estate exactly.
    ledger.record("bootstrap", seedCents, { fromId: "$operator", toId: genome.meta.id, atMs: simStartMs, note: "resume bootstrap" });
    const equity = GENESIS_SEED_USD * equityMult;
    bootEquity.set(genome.meta.id, equity);
    const pnlCents = usdToCents(equity) - seedCents;
    if (pnlCents > 0) {
      ledger.record("market-pnl", pnlCents, { fromId: "$market", toId: genome.meta.id, atMs: simStartMs, note: "resumed history" });
    } else if (pnlCents < 0) {
      ledger.record("market-pnl", -pnlCents, { fromId: genome.meta.id, toId: "$market", atMs: simStartMs, note: "resumed history" });
    }
    quants.push({
      id: genome.meta.id,
      name: genome.meta.name,
      ticker: genome.meta.ticker,
      xHandle: xHandleOf(genome.meta.name),
      generation: genome.meta.generation,
      parents,
      genome,
      genomeHash: genomeHash(genome),
      status: "alive",
      bornAtMs: simStartMs - bornAgoH * HOUR_MS, // resumed mid-life (pre-sim history)
      diedAtMs: null,
      causeOfDeath: null,
      finalWords: null,
      seedUsd: GENESIS_SEED_USD,
      processRunning: true,
      lastBroodAtMs: null,
      peakEquityUsd: Math.max(equity, GENESIS_SEED_USD),
      feeRatePerHourUsd: feeRate,
      dailyBurnUsd: burnForCadence(genome.edge.cadenceMin),
      computeReserveUsd: 0,
      unclaimedFeesUsd: 0,
      walletAddr: paperWalletProvider(genome.meta.id),
      tokenAddr: launch.tokenAddr,
      poolAddr: launch.poolAddr,
      birthTx: launch.tx,
      geneOrigins: origins,
      claimedTotalUsd: 0,
      rewardPaidTotalUsd: 0,
      rewardOwedUsd: 0,
      generatedPeakUsd: generatedPeak,
      childrenCount,
    });
  });

  let births = 0;
  let deaths = 0;
  let lastFitness: FitnessRow[] = [];
  /** milestone cursors (A4): last announced allowance per quant + the reigning champion */
  const allowanceSeen = new Map<string, number>();
  let championId: string | undefined;
  const equityById = new Map<string, number>(bootEquity);
  const realizedSynced = new Map<string, number>(quants.map((q) => [q.id, 0]));

  const tickOf = (q: QuantRecord, simMin: number): number => Math.floor(simMin / q.genome.edge.cadenceMin);

  // sim clock shared with syncMarketPnl (set each loop iteration before use)
  let lastNowMs = simStartMs;

  /** record the realized-P&L delta since the last sync as a market-pnl flow, and lift the peak */
  const syncMarketPnl = (q: QuantRecord) => {
    const engine = getSessionEngine(q.id);
    if (!engine) return;
    const realized = engine.realizedPnlUsd;
    const prev = realizedSynced.get(q.id) ?? 0;
    const deltaCents = usdToCents(realized) - usdToCents(prev);
    if (deltaCents > 0) {
      ledger.record("market-pnl", deltaCents, { fromId: "$market", toId: q.id, atMs: lastNowMs, note: "realized" });
    } else if (deltaCents < 0) {
      ledger.record("market-pnl", -deltaCents, { fromId: q.id, toId: "$market", atMs: lastNowMs, note: "realized" });
    }
    if (deltaCents !== 0) realizedSynced.set(q.id, realized);
    const generated = realized + q.claimedTotalUsd;
    if (generated > q.generatedPeakUsd) q.generatedPeakUsd = generated;
  };

  for (let simMin = 0; simMin <= totalSimMin; simMin += STEP_MIN) {
    const nowMs = simStartMs + simMin * 60_000;
    lastNowMs = nowMs;

    // ── trading: each living quant ticks on its own cadence grid
    for (const q of quants) {
      if (q.status !== "alive" || simMin % q.genome.edge.cadenceMin !== 0) continue;
      const res = await runQuantOnce({
        genome: q.genome,
        mode: "paper",
        tick: simMin / q.genome.edge.cadenceMin,
        seedUsd: bootEquity.get(q.id) ?? q.seedUsd,
        birthLetter: q.birthLetter ?? null,
      });
      equityById.set(q.id, res.equityUsd);
      if (res.trade) {
        events.push({
          atMs: nowMs, kind: "trade", quantId: q.id,
          detail: `${res.trade.side} ${res.trade.symbol} $${res.trade.notionalUsd.toFixed(2)}${res.trade.reason ? ` (${res.trade.reason})` : ""}`,
          ...(res.trade.thesis !== undefined ? { thesis: res.trade.thesis } : {}),
        });
      }
      if (res.veto) {
        events.push({ atMs: nowMs, kind: "veto", quantId: q.id, detail: `passed on ${res.veto.symbol}`, thesis: res.veto.thesis });
      }
      if (res.tweet && !res.tweet.rejected) {
        events.push({ atMs: nowMs, kind: "tweet", quantId: q.id, detail: res.tweet.text });
      }
    }

    // ── hourly bookkeeping: fees accrue, burn debits, market-pnl sync, deaths, births
    if (simMin % 60 === 0 && simMin > 0) {
      for (const q of quants) {
        if (q.status !== "alive") {
          // orphan tokens keep trading in-world: fees accrue for the system's orphan-claim pass
          q.unclaimedFeesUsd += q.feeRatePerHourUsd;
          continue;
        }
        q.unclaimedFeesUsd += q.feeRatePerHourUsd;
        const engine = getSessionEngine(q.id);
        if (engine) {
          // burn debits real cash; the applied (negative) amount adjusts the equity estimate
          const applied = engine.adjustCash(-q.dailyBurnUsd / 24);
          equityById.set(q.id, Math.max(0, (equityById.get(q.id) ?? q.seedUsd) + applied));
          const burnCents = usdToCents(-applied);
          if (burnCents > 0) {
            ledger.record("compute-burn", burnCents, { fromId: q.id, toId: "$sink", atMs: nowMs, note: "vps+llm" });
          }
        }
        syncMarketPnl(q);
        const eqNow = equityById.get(q.id) ?? q.seedUsd;
        if (eqNow > q.peakEquityUsd) q.peakEquityUsd = eqNow;
      }

      // fee claims every 4 hours: 10% compute reserve / r% holder rewards (earmarked in the
      // reserve until the weekly distribution — same model as the live runtime) / rest discretion
      if (simMin % 240 === 0) {
        for (const q of quants) {
          if (q.status !== "alive" || q.unclaimedFeesUsd <= 0) continue;
          const claimCents = usdToCents(q.unclaimedFeesUsd);
          if (claimCents <= 0) continue;
          const r = q.genome.econ.holderRewardPct;
          const split = splitFeeClaimCents(claimCents, r);
          ledger.record("fee-claim", claimCents, { fromId: "$protocol", toId: q.id, atMs: nowMs, note: "creator fees" });
          const credited = getSessionEngine(q.id)?.adjustCash(split.discretionCents / 100) ?? 0;
          if (credited > 0) equityById.set(q.id, (equityById.get(q.id) ?? q.seedUsd) + credited);
          // the holder-reward share is earmarked in the compute reserve (untouchable by
          // trading) until the weekly distributor pays it out
          q.computeReserveUsd += (split.computeReserveCents + split.holderRewardCents) / 100;
          q.rewardOwedUsd += split.holderRewardCents / 100;
          q.claimedTotalUsd += claimCents / 100;
          noteFeeClaim(q.id, claimCents / 100, nowMs); // the agent's own memory knows its income
          const generated = (getSessionEngine(q.id)?.realizedPnlUsd ?? 0) + q.claimedTotalUsd;
          if (generated > q.generatedPeakUsd) q.generatedPeakUsd = generated;
          events.push({ atMs: nowMs, kind: "fee-claim", quantId: q.id, detail: `claimed $${(claimCents / 100).toFixed(2)} → 10% compute · ${(r * 100).toFixed(0)}% holders earmarked · rest discretion` });
          // keep the sub-cent remainder — the estate and the ledger must agree to the cent
          q.unclaimedFeesUsd -= claimCents / 100;
        }

        // orphan-fee claims (B6): dead agents' pools keep accruing; the system claims and
        // sweeps to the reigning champion. Two flows (claim in, sweep out) keep the dead
        // agent's ledger at zero — the fees were never its generation.
        for (const q of quants) {
          if (q.status !== "dead" || q.unclaimedFeesUsd < ORPHAN_CLAIM_MIN_USD) continue;
          const claimCents = usdToCents(q.unclaimedFeesUsd);
          if (claimCents <= 0) continue;
          const fit = buildFitnessTable(quants, equityById);
          const champ = pickChampion(quants, fit, q.id);
          ledger.record("fee-claim", claimCents, { fromId: "$protocol", toId: q.id, atMs: nowMs, note: "orphan fees" });
          ledger.record("champion-sweep", claimCents, { fromId: q.id, toId: champ ?? "$operator-treasury", atMs: nowMs, note: "orphan fees" });
          if (champ) {
            getSessionEngine(champ)?.adjustCash(claimCents / 100);
            equityById.set(champ, (equityById.get(champ) ?? 0) + claimCents / 100);
          }
          q.claimedTotalUsd += claimCents / 100;
          q.unclaimedFeesUsd -= claimCents / 100;
          events.push({ atMs: nowMs, kind: "sweep", quantId: q.id, detail: `orphan fees $${(claimCents / 100).toFixed(2)} → ${champ ?? "operator treasury"}` });
        }
      }

      // weekly holder-rewards distribution (B6 parity with the live runtime): pay out each
      // living agent's earmarked rewards from its compute reserve
      if (simMin % (7 * 24 * 60) === 0) {
        for (const q of quants) {
          if (q.status !== "alive") continue;
          const owedCents = usdToCents(Math.min(q.rewardOwedUsd, q.computeReserveUsd));
          if (owedCents <= 0) continue;
          ledger.record("holder-reward", owedCents, { fromId: q.id, toId: "$holders", atMs: nowMs, note: "weekly distribution" });
          q.computeReserveUsd -= owedCents / 100;
          q.rewardOwedUsd = 0;
          q.rewardPaidTotalUsd += owedCents / 100;
          events.push({ atMs: nowMs, kind: "reward", quantId: q.id, detail: `holder rewards $${(owedCents / 100).toFixed(2)} distributed (${(q.genome.econ.holderRewardPct * 100).toFixed(0)}% of fees)` });
        }
      }

      // deaths (§4.5) — instant, atomic, zombie-free; the dead feed the champion
      for (const { id, cause } of evaluateDeaths(quants, equityById)) {
        const q = quants.find((x) => x.id === id)!;
        lastFitness = buildFitnessTable(quants, equityById);
        const championId = pickChampion(quants, lastFitness, q.id);
        const creditEquity = (cid: string, usd: number) => {
          equityById.set(cid, (equityById.get(cid) ?? 0) + usd);
          getSessionEngine(cid)?.adjustCash(usd);
        };
        // final claim (B6 parity): pending fees become a real claim before the sweep, so the
        // estate the champion inherits is fully ledger-backed (live: the daemon claims on-chain)
        const pendingCents = usdToCents(q.unclaimedFeesUsd);
        if (pendingCents > 0) {
          const r = q.genome.econ.holderRewardPct;
          const split = splitFeeClaimCents(pendingCents, r);
          ledger.record("fee-claim", pendingCents, { fromId: "$protocol", toId: q.id, atMs: nowMs, note: "final claim" });
          const credited = getSessionEngine(q.id)?.adjustCash(split.discretionCents / 100) ?? 0;
          if (credited > 0) equityById.set(q.id, (equityById.get(q.id) ?? 0) + credited);
          q.computeReserveUsd += (split.computeReserveCents + split.holderRewardCents) / 100;
          q.rewardOwedUsd += split.holderRewardCents / 100;
          q.claimedTotalUsd += pendingCents / 100;
          noteFeeClaim(q.id, pendingCents / 100, nowMs);
          q.unclaimedFeesUsd -= pendingCents / 100;
        }
        const { finalWords, sweptUsd } = reap(q, cause, {
          engine: getSessionEngine(q.id),
          quoteFor: (symbol) => quoteAt(symbol, tickOf(q, simMin)),
          ledger,
          nowMs,
          tick: tickOf(q, simMin),
          championId,
          creditEquity,
          syncRealized: () => syncMarketPnl(q),
        });
        equityById.set(q.id, 0);
        deaths += 1;
        // §5.4: the memory seals at death and publishes on the grave; the living witness it
        q.sealedMemory = sealSessionMemory(q.id, { name: q.name, cause, finalWords, bornAtMs: q.bornAtMs, diedAtMs: nowMs });
        for (const other of quants) {
          if (other.id !== q.id && other.status === "alive") {
            noteWitness(other.id, `witnessed a death: ${q.name} (${cause})`, "death", nowMs);
          }
        }
        events.push({ atMs: nowMs, kind: "death", quantId: q.id, detail: `${cause} — "${finalWords}"` });
        if (sweptUsd > 0) {
          events.push({ atMs: nowMs, kind: "sweep", quantId: q.id, detail: `estate $${sweptUsd.toFixed(2)} → ${championId ?? "operator treasury"}` });
        }
      }

      // ── milestones (A4): reproduction rights earned + champion takeovers. Runs BEFORE the
      // birth section so the feed reads cause-then-effect: the right is announced before
      // the child it enables.
      for (const q of quants) {
        if (q.status !== "alive") continue;
        const seen = allowanceSeen.get(q.id);
        const allowance = offspringAllowance(q.generatedPeakUsd);
        if (seen === undefined) {
          allowanceSeen.set(q.id, allowance); // quiet init — resumed history is not news
          continue;
        }
        if (allowance > seen) {
          allowanceSeen.set(q.id, allowance);
          const milestone = OFFSPRING.allowanceMilestonesUsd[allowance - 1]!;
          events.push({ atMs: nowMs, kind: "milestone", quantId: q.id, detail: `crossed $${milestone.toLocaleString("en-US")} lifetime generated — reproduction right #${allowance} earned` });
        }
      }
      const livingCount = quants.filter((q) => q.status === "alive").length;
      if (livingCount >= 2) {
        lastFitness = buildFitnessTable(quants, equityById);
        const champ = pickChampion(quants, lastFitness, "");
        if (champ && championId === undefined) {
          championId = champ; // quiet init — the first leader is a baseline, not a takeover
        } else if (champ && champ !== championId) {
          championId = champ;
          const f = lastFitness.find((r) => r.id === champ)?.fitness ?? 0;
          events.push({ atMs: nowMs, kind: "milestone", quantId: champ, detail: `crowned champion — fitness ${f.toFixed(3)} leads the arena` });
        }
      }

      // births (§4.4) — at most one per hour keeps the tape readable; allowance-gated
      lastFitness = buildFitnessTable(quants, equityById);
      const eligible = evaluateBreeding(quants, lastFitness, equityById, nowMs);
      for (const parent of eligible) {
        const debitEquity = (quantId: string, usd: number): number => {
          const before = equityById.get(quantId) ?? 0;
          const moved = Math.min(usd, Math.max(0, before));
          equityById.set(quantId, before - moved);
          getSessionEngine(quantId)?.adjustCash(-moved);
          return moved;
        };
        const result = await executeBirth(parent, {
          quants, ledger, pons, rng: rngBreed, nowMs,
          ethUsdPrice: ETH_USD,
          burnForCadence,
          newbornFeeRate: (r) => 0.3 + r() * 0.3,
          walletFor: paperWalletProvider,
          parentEquityUsd: equityById.get(parent.id) ?? parent.seedUsd,
          debitEquity,
        });
        if (!result) continue;
        const child = result.child;
        // §5.4: the parent's letter, written from its own memory, addressed to the child's
        // real name — assigned after a successful birth, before the child's first tick
        child.birthLetter = composeBirthLetter(parent.id, parent.name, child.name, nowMs);
        quants.push(child);
        equityById.set(child.id, child.seedUsd);
        realizedSynced.set(child.id, 0);
        births += 1;
        const endow = child.endowment;
        events.push({ atMs: nowMs, kind: "birth", quantId: child.id, detail: `self-spawned by ${parent.id}, funded $${(endow?.totalUsd ?? 0).toFixed(2)} from ${parent.name} (seed $${child.seedUsd.toFixed(2)}), ${child.genome.meta.mutations.length} mutations, holder rewards ${(child.genome.econ.holderRewardPct * 100).toFixed(0)}%` });
        // §5.4: the living witness the birth (the parent already journaled it via the letter)
        for (const other of quants) {
          if (other.id !== child.id && other.id !== parent.id && other.status === "alive") {
            noteWitness(other.id, `witnessed a birth: ${child.name} (gen ${child.generation}, parent ${parent.name})`, "birth", nowMs);
          }
        }
        break;
      }
    }
  }

  lastFitness = buildFitnessTable(quants, equityById);
  const fitnessById = new Map(lastFitness.map((r) => [r.id, r.fitness]));

  const outQuants: EvolutionQuantOut[] = quants.map((q) => {
    const engine = getSessionEngine(q.id);
    const estate = q.status === "dead" ? 0 : estateUsdOf(q);
    return {
      id: q.id, name: q.name, ticker: q.ticker,
      xHandle: q.xHandle,
      status: q.status,
      processRunning: q.processRunning,
      openPositions: engine?.positions.size ?? 0,
      generation: q.generation,
      parents: q.parents,
      equityUsd: q.status === "dead" ? 0 : Number((equityById.get(q.id) ?? q.seedUsd).toFixed(2)),
      seedUsd: q.seedUsd,
      fitness: fitnessById.get(q.id) ?? null,
      archetype: q.genome.edge.archetype,
      voice: q.genome.voice.archetype,
      causeOfDeath: q.causeOfDeath,
      finalWords: q.finalWords,
      bornAtMs: q.bornAtMs,
      diedAtMs: q.diedAtMs,
      walletAddr: q.walletAddr,
      tokenAddr: q.tokenAddr,
      genomeHash: q.genomeHash,
      mutations: q.genome.meta.mutations,
      geneOrigins: q.geneOrigins ?? null,
      genome: q.genome,
      endowment: q.endowment ?? null,
      holderRewardPct: q.genome.econ.holderRewardPct,
      claimedTotalUsd: q.claimedTotalUsd,
      rewardPaidTotalUsd: q.rewardPaidTotalUsd,
      rewardOwedUsd: q.rewardOwedUsd,
      generatedPeakUsd: q.generatedPeakUsd,
      allowance: offspringAllowance(q.generatedPeakUsd),
      childrenCount: q.childrenCount,
      estateUsd: Number(estate.toFixed(2)),
      ledgerBalanceUsd: ledger.balanceOf(q.id) / 100,
      // §5.4: the living publish their running self-model; the dead publish the sealed one
      selfModel: q.status === "dead" ? (q.sealedMemory ?? null) : (getSessionMemory(q.id)?.selfModel.text ?? null),
    };
  });

  // ── reconciliation, to the cent: every agent's estate matches its ledger view
  for (const q of outQuants) {
    const drift = Math.abs(q.estateUsd - q.ledgerBalanceUsd);
    if (drift > 0.01) {
      throw new Error(`flow reconciliation broken for ${q.id}: estate ${q.estateUsd} vs ledger ${q.ledgerBalanceUsd} (drift ${drift})`);
    }
  }
  const conservation = ledger.conservationCheck();
  if (!conservation.ok) {
    throw new Error(`flow conservation broken in-sim: sum ${conservation.sumCents}c, negative agents ${conservation.negativeAgents.join(",")}`);
  }

  return {
    config: cfg,
    simStartMs,
    simEndMs: simStartMs + totalSimMin * 60_000,
    births,
    deaths,
    quants: outQuants,
    flows: ledger.toJSON(),
    events,
  };
}
