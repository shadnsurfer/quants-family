/**
 * Season 0 runtime — the REAL gen-0 run at dust scale (Charles directive 2026-07-23,
 * re-based 2026-08-02 to the no-pool model: double-entry flow ledger, allowance-gated
 * parent-funded births, champion sweeps, holder rewards accrued to the compute reserve
 * and distributed weekly).
 *
 * Same machinery as the sim (runQuantOnce ticks, watcher rules, birth executor, reaper,
 * flow ledger) driven by the WALL CLOCK against LIVE pool prices, with REAL Pons dust launches:
 *   - trading: paper fills at live on-chain quotes (real trading stays behind GO_LIVE_OK)
 *   - births:  real dust launches, each child's own keystore wallet as the fee wallet
 *   - fees:    observed on-chain (eth_call collectFees simulation), claimed when worth gas
 *   - time:    true gen 0 — bornAt = launch time, no synthetic history, §4.4 gates run real
 *
 * The runtime is deliberately dependency-injected (Season0Deps) so this file stays pure
 * TypeScript logic; the daemon script wires the chain adapters and the loop around it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  genomeHash, OFFSPRING, offspringAllowance, seededRng, splitFeeClaimCents, usdToCents, xHandleOf,
  type FitnessRow, type Genome,
} from "@quants/core";
import {
  composeBirthLetter, getSessionEngine, getSessionMemory, noteFeeClaim, noteSocialPost, noteWitness,
  restoreQuantSession, runQuantOnce, sealSessionMemory, serializeQuantSessions,
  type PriceView, type QuantSessionState, type RunOnceInput,
} from "@quants/quant";
import type { Quote } from "@quants/paper";
import { FlowLedger, type FlowEntry } from "./flows.js";
import { executeBirth } from "./birthExecutor.js";
import { reap } from "./reaper.js";
import { buildFitnessTable, evaluateBreeding, evaluateDeaths, pickChampion } from "./watcher.js";
import { burnForCadence, estateUsdOf, ORPHAN_CLAIM_MIN_USD, type EvolutionQuantOut } from "./simEvolution.js";
import type { EvolutionEvent, LaunchResult, QuantRecord, WalletProvider } from "./types.js";
import { composeTweet, guardTweet, recentPostTexts } from "@quants/brain";
import { frameSocialText, sanitizeSocialText, type XClient, type XMention } from "@quants/social";

const HOUR_MS = 3_600_000;
const SAMPLE_MS = 5 * 60_000;
const CLAIM_INTERVAL_MS = 4 * HOUR_MS;
/** below this, a pending fee claim is not worth its gas */
const CLAIM_MIN_USD = 1;
/** holder rewards are distributed weekly */
const REWARD_INTERVAL_MS = 7 * 24 * HOUR_MS;
/** the social pass (B4): mentions are read and answered at most this often */
const SOCIAL_INTERVAL_MS = 30 * 60_000;
/** trailing window for the observed fee-inflow rate (matches FITNESS.charismaTrailingHours) */
const FEE_RATE_WINDOW_H = 72;

export interface Season0Quant extends QuantRecord {
  /** last cadence tick actually executed (missed ticks are skipped, never replayed) */
  lastTickIndex: number;
  /** cumulative observed creator fees over time: pending + claimed, USD */
  feeObs: Array<{ atMs: number; cumUsd: number }>;
}

export interface Season0State {
  version: 1;
  real: true;
  seed: number;
  startedAtMs: number;
  lastSampleMs: number;
  lastHourlyMs: number;
  lastClaimMs: number;
  lastRewardMs: number;
  births: number;
  deaths: number;
  breedCounter: number;
  quants: Season0Quant[];
  sessions: Record<string, QuantSessionState>;
  equityById: Record<string, number>;
  realizedSyncedById: Record<string, number>;
  flowEntries: FlowEntry[];
  events: EvolutionEvent[];
  /** LivePrices.serialize() blob — restored by the daemon, opaque here */
  prices: unknown;
  agentZero: { tokenAddr: string; poolAddr: string; tx: string; walletAddr: string } | null;
  /** non-null = automatic births are paused, with the human-readable reason */
  birthsPaused: string | null;
  /** who signs fee claims, decided by the on-chain custody probe at genesis */
  custody: "dust-key-claims" | "quant-key-claims" | "unknown";
  /** milestone cursors (A4): last announced reproduction allowance per quant */
  allowanceSeenById: Record<string, number>;
  /** milestone cursor (A4): the reigning champion; null until the arena has ≥ 2 living agents */
  championId: string | null;
  /** B4 social pass: last run, per-handle mention cursors, and the reply budget ledger */
  lastSocialMs: number;
  lastMentionIdByHandle: Record<string, string>;
  socialReplies: { dayIndex: number; byQuant: Record<string, number> };
}

/** What the daemon must wire in from @quants/chain + the dust wallet. */
export interface Season0Deps {
  prices: {
    sample(symbols: readonly string[], nowMs: number): Promise<void>;
    quoteFor(symbol: string): Quote;
    seriesFor(symbol: string, cadenceMin: number): number[];
    refreshEthUsd(nowMs: number): Promise<number>;
    readonly ethUsd: number;
    serialize(): unknown;
  };
  /** real Pons launcher for children (throws on tx failure → births pause) */
  birthPons: { launch(meta: { name: string; ticker: string }, feeWallet: string, devBuyEth: number): Promise<LaunchResult> };
  /** current pending creator fees for one quant token, in USD */
  readFeesUsd(q: { tokenAddr: string; poolAddr: string; walletAddr: string }): Promise<number>;
  /** execute a real fee claim; returns the tx and the claimed USD value */
  claimFees(q: { id: string; tokenAddr: string; poolAddr: string; walletAddr: string }): Promise<{ tx: string; claimedUsd: number }>;
  /** dust wallet balance (launch budget), ETH */
  dustBalanceEth(): Promise<number>;
  /** issues a REAL keystore wallet for a newborn (birthWallet) */
  walletFor: WalletProvider;
  flowDesk?: NonNullable<RunOnceInput["flowDesk"]>;
  /** births pause when the dust wallet would drop below this */
  reserveEth: number;
  /**
   * B4: the X layer. Absent → the social pipeline stays dark (tweets only reach the feed).
   * xAccounts tells which handles actually have accounts (dry-run: all of them).
   * tweetGuard=false retires the content guard for live posting (owner decision 2026-08-02).
   */
  x?: XClient;
  xAccounts?: (handle: string) => boolean;
  tweetGuard?: boolean;
  log(line: string): void;
}

/**
 * Genesis config, lineage model: ONE progenitor (agent zero) starts the species. Its wallet is a
 * pre-generated keystore address; every later wallet is minted at birth by the daemon.
 */
export interface GenesisConfig {
  genome: Genome;
  walletAddr: string;
  seedUsd: number;
  nowMs: number;
  seed: number;
}

function toOut(q: Season0Quant, equity: number, fitness: number | null, ledger: FlowLedger): EvolutionQuantOut {
  const engine = getSessionEngine(q.id);
  return {
    id: q.id, name: q.name, ticker: q.ticker,
    xHandle: q.xHandle,
    status: q.status,
    processRunning: q.processRunning,
    openPositions: engine?.positions.size ?? 0,
    generation: q.generation,
    parents: q.parents,
    equityUsd: q.status === "dead" ? 0 : Number(equity.toFixed(2)),
    seedUsd: q.seedUsd,
    fitness,
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
    estateUsd: q.status === "dead" ? 0 : Number(estateUsdOf(q).toFixed(2)),
    ledgerBalanceUsd: ledger.balanceOf(q.id) / 100,
    // §5.4: the living publish their running self-model; the dead publish the sealed one
    selfModel: q.status === "dead" ? (q.sealedMemory ?? null) : (getSessionMemory(q.id)?.selfModel.text ?? null),
  };
}

export class Season0Runtime {
  readonly state: Season0State;
  private readonly deps: Season0Deps;
  private ledger: FlowLedger;

  constructor(state: Season0State, deps: Season0Deps) {
    this.state = state;
    this.deps = deps;
    this.ledger = FlowLedger.replay(state.flowEntries);
    for (const q of state.quants) {
      const session = state.sessions[q.id];
      // pre-B2 sessions carry no memory: it starts clean, cursors pinned to the world's "now"
      if (session) restoreQuantSession(q.genome, session, state.lastSampleMs || state.startedAtMs);
    }
  }

  /** REAL genesis: launch agent zero on Pons, at dust size. */
  static async genesis(cfg: GenesisConfig, deps: Season0Deps): Promise<Season0Runtime> {
    const state: Season0State = {
      version: 1, real: true, seed: cfg.seed,
      startedAtMs: cfg.nowMs, lastSampleMs: 0, lastHourlyMs: cfg.nowMs, lastClaimMs: cfg.nowMs,
      lastRewardMs: cfg.nowMs,
      births: 0, deaths: 0, breedCounter: 0,
      quants: [], sessions: {}, equityById: {}, realizedSyncedById: {},
      flowEntries: [],
      events: [], prices: null, agentZero: null, birthsPaused: null, custody: "unknown",
      allowanceSeenById: {}, championId: null,
      lastSocialMs: 0, lastMentionIdByHandle: {}, socialReplies: { dayIndex: 0, byQuant: {} },
    };
    const runtime = new Season0Runtime(state, deps);
    const ethUsd = await deps.prices.refreshEthUsd(cfg.nowMs);
    return runtime.launchGenesis(cfg, ethUsd);
  }

  private async launchGenesis(cfg: GenesisConfig, ethUsd: number): Promise<this> {
    const { deps, state } = this;
    const genome = cfg.genome;
    const name = genome.meta.name;
    deps.log(`launching agent zero ${name} ($${genome.meta.ticker}) — gen 0, the start of the species …`);
    const launch = await deps.birthPons.launch({ name, ticker: genome.meta.ticker }, cfg.walletAddr, 0);
    const launchFeeCents = usdToCents(0.0005 * ethUsd);
    // the ONLY operator-funded flows in the species' history, both disclosed: agent zero's
    // bootstrap seed, and the real dust launch fee — on-chain the dust wallet (operator) pays
    // it, never agent zero. Charging it to eve would drift its estate $1.50 from the ledger
    // forever (found by the insolvency guard at the first death sweep, B6 tests).
    this.ledger.record("bootstrap", usdToCents(cfg.seedUsd), { fromId: "$operator", toId: genome.meta.id, atMs: cfg.nowMs, note: "agent zero bootstrap" });
    this.ledger.record("launch-fee", launchFeeCents, { fromId: "$operator", toId: "$sink", atMs: cfg.nowMs, note: "real dust launch" });
    state.quants.push({
      id: genome.meta.id, name, ticker: genome.meta.ticker,
      xHandle: xHandleOf(name),
      generation: genome.meta.generation, parents: [], genome, genomeHash: genomeHash(genome),
      status: "alive", bornAtMs: cfg.nowMs, diedAtMs: null, causeOfDeath: null, finalWords: null,
      seedUsd: cfg.seedUsd, processRunning: true, lastBroodAtMs: null,
      peakEquityUsd: cfg.seedUsd, feeRatePerHourUsd: 0,
      dailyBurnUsd: burnForCadence(genome.edge.cadenceMin),
      computeReserveUsd: 0, unclaimedFeesUsd: 0,
      walletAddr: cfg.walletAddr, tokenAddr: launch.tokenAddr, poolAddr: launch.poolAddr, birthTx: launch.tx,
      claimedTotalUsd: 0, rewardPaidTotalUsd: 0, rewardOwedUsd: 0,
      generatedPeakUsd: 0, childrenCount: 0,
      lastTickIndex: -1, feeObs: [],
    });
    state.agentZero = { tokenAddr: launch.tokenAddr, poolAddr: launch.poolAddr, tx: launch.tx, walletAddr: cfg.walletAddr };
    state.equityById[genome.meta.id] = cfg.seedUsd;
    state.realizedSyncedById[genome.meta.id] = 0;
    state.events.push({ atMs: cfg.nowMs, kind: "birth", quantId: genome.meta.id, detail: `gen 0 — agent zero's real dust launch, token ${launch.tokenAddr}. everything descends from here.` });
    deps.log(`  ${name} token ${launch.tokenAddr} tx ${launch.tx}`);
    state.flowEntries = [...this.ledger.entries];
    return this;
  }

  private living(): Season0Quant[] {
    return this.state.quants.filter((q) => q.status === "alive");
  }

  private universeUnion(): string[] {
    const set = new Set<string>();
    for (const q of this.living()) for (const s of q.genome.edge.universe) set.add(s);
    return [...set];
  }

  private viewFor(cadenceMin: number): PriceView {
    const { prices } = this.deps;
    return {
      quoteFor: (symbol) => prices.quoteFor(symbol),
      seriesFor: (symbol) => prices.seriesFor(symbol, cadenceMin),
    };
  }

  private tickIndexOf(q: Season0Quant, nowMs: number): number {
    return Math.floor((nowMs - q.bornAtMs) / (q.genome.edge.cadenceMin * 60_000));
  }

  /** record the realized-P&L delta since the last sync as a market-pnl flow, and lift the peak */
  private syncMarketPnl(q: Season0Quant, nowMs: number): void {
    const engine = getSessionEngine(q.id);
    if (!engine) return;
    const realized = engine.realizedPnlUsd;
    const prev = this.state.realizedSyncedById[q.id] ?? 0;
    const deltaCents = usdToCents(realized) - usdToCents(prev);
    if (deltaCents > 0) {
      this.ledger.record("market-pnl", deltaCents, { fromId: "$market", toId: q.id, atMs: nowMs, note: "realized" });
    } else if (deltaCents < 0) {
      this.ledger.record("market-pnl", -deltaCents, { fromId: q.id, toId: "$market", atMs: nowMs, note: "realized" });
    }
    if (deltaCents !== 0) this.state.realizedSyncedById[q.id] = realized;
    const generated = realized + q.claimedTotalUsd;
    if (generated > q.generatedPeakUsd) q.generatedPeakUsd = generated;
  }

  /** One daemon pass. Call about once a minute; every interval is self-gating. */
  async tick(nowMs: number): Promise<void> {
    const { deps, state } = this;

    if (nowMs - state.lastSampleMs >= SAMPLE_MS) {
      await deps.prices.sample(this.universeUnion(), nowMs);
      state.lastSampleMs = nowMs;
    }

    // ── trading: each living quant on its own real-time cadence grid (missed ticks skip)
    for (const q of this.living()) {
      const due = this.tickIndexOf(q, nowMs);
      if (due <= q.lastTickIndex) continue;
      q.lastTickIndex = due;
      const res = await runQuantOnce({
        genome: q.genome, mode: "paper", tick: due, seedUsd: q.seedUsd,
        prices: this.viewFor(q.genome.edge.cadenceMin), nowMs,
        birthLetter: q.birthLetter ?? null,
        tweetGuard: deps.tweetGuard ?? true,
        ...(deps.flowDesk ? { flowDesk: deps.flowDesk } : {}),
      });
      state.equityById[q.id] = res.equityUsd;
      if (res.trade) {
        state.events.push({
          atMs: nowMs, kind: "trade", quantId: q.id,
          detail: `${res.trade.side} ${res.trade.symbol} $${res.trade.notionalUsd.toFixed(2)}${res.trade.reason ? ` (${res.trade.reason})` : ""}`,
          ...(res.trade.thesis !== undefined ? { thesis: res.trade.thesis } : {}),
        });
      }
      if (res.veto) {
        state.events.push({ atMs: nowMs, kind: "veto", quantId: q.id, detail: `passed on ${res.veto.symbol}`, thesis: res.veto.thesis });
      }
      if (res.tweet && !res.tweet.rejected) {
        state.events.push({ atMs: nowMs, kind: "tweet", quantId: q.id, detail: res.tweet.text });
        // B4: the post also goes out on X when the agent has an account wired
        if (deps.x && deps.xAccounts?.(q.xHandle)) {
          try {
            await deps.x.post(q.xHandle, res.tweet.text);
          } catch (e) {
            deps.log(`x post failed for @${q.xHandle}: ${(e as Error).message}`);
          }
        }
      }
    }

    if (nowMs - state.lastHourlyMs >= HOUR_MS) {
      await this.hourly(nowMs);
      state.lastHourlyMs = nowMs;
    }
    if (nowMs - state.lastClaimMs >= CLAIM_INTERVAL_MS) {
      await this.claims(nowMs);
      state.lastClaimMs = nowMs;
    }
    if (nowMs - state.lastRewardMs >= REWARD_INTERVAL_MS) {
      this.rewards(nowMs);
      state.lastRewardMs = nowMs;
    }
    if (nowMs - state.lastSocialMs >= SOCIAL_INTERVAL_MS) {
      await this.social(nowMs);
      state.lastSocialMs = nowMs;
    }

    state.flowEntries = [...this.ledger.entries];
    const conservation = this.ledger.conservationCheck();
    if (!conservation.ok) {
      throw new Error(`flow conservation broken: sum ${conservation.sumCents}c, negative agents ${conservation.negativeAgents.join(",")}`);
    }
  }

  private async hourly(nowMs: number): Promise<void> {
    const { deps, state } = this;
    const hours = Math.max(1, Math.floor((nowMs - state.lastHourlyMs) / HOUR_MS));

    for (const q of state.quants) {
      if (q.status !== "alive") {
        // orphan tokens keep trading on-chain: keep the pending-fee read fresh for the
        // orphan-claim pass (B6) — no burn, no fitness inputs for the dead
        try {
          q.unclaimedFeesUsd = await deps.readFeesUsd(q);
        } catch (e) {
          deps.log(`fee read failed for orphan ${q.id}: ${(e as Error).message} — keeping last known`);
        }
        continue;
      }
      // compute burn debits real (paper) cash, scaled by hours actually elapsed
      const engine = getSessionEngine(q.id);
      if (engine) {
        const applied = engine.adjustCash(-(q.dailyBurnUsd / 24) * hours);
        state.equityById[q.id] = Math.max(0, (state.equityById[q.id] ?? q.seedUsd) + applied);
        const burnCents = usdToCents(-applied);
        if (burnCents > 0) {
          this.ledger.record("compute-burn", burnCents, { fromId: q.id, toId: "$sink", atMs: nowMs, note: "vps+llm" });
        }
      }
      this.syncMarketPnl(q, nowMs);
      // observed on-chain creator fees: pending (eth_call) + everything already claimed
      try {
        const pendingUsd = await deps.readFeesUsd(q);
        q.unclaimedFeesUsd = pendingUsd;
        const cumUsd = pendingUsd + q.claimedTotalUsd;
        q.feeObs.push({ atMs: nowMs, cumUsd });
        if (q.feeObs.length > 24 * 30) q.feeObs.splice(0, q.feeObs.length - 24 * 30);
        const cutoff = nowMs - FEE_RATE_WINDOW_H * HOUR_MS;
        const base = q.feeObs.find((o) => o.atMs >= cutoff) ?? q.feeObs[0]!;
        const spanH = Math.max(1, (nowMs - Math.max(base.atMs, q.bornAtMs)) / HOUR_MS);
        q.feeRatePerHourUsd = Math.max(0, (cumUsd - base.cumUsd) / spanH);
      } catch (e) {
        deps.log(`fee read failed for ${q.id}: ${(e as Error).message} — keeping last known`);
      }
      const eq = state.equityById[q.id] ?? q.seedUsd;
      if (eq > q.peakEquityUsd) q.peakEquityUsd = eq;
    }

    // deaths (§4.5) — instant, atomic, zombie-free, at live quotes; the dead feed the champion
    const equityMap = new Map(Object.entries(state.equityById));
    for (const { id, cause } of evaluateDeaths(state.quants, equityMap)) {
      const q = state.quants.find((x) => x.id === id)! as Season0Quant;
      const fitness: FitnessRow[] = buildFitnessTable(state.quants, equityMap);
      const championId = pickChampion(state.quants, fitness, q.id);
      const creditEquity = (cid: string, usd: number) => {
        state.equityById[cid] = (state.equityById[cid] ?? 0) + usd;
        getSessionEngine(cid)?.adjustCash(usd);
      };
      // final claim (B6): pull the dying agent's pending fees on-chain BEFORE the sweep, so
      // the estate the champion inherits is really claimed, not just observed. Death doesn't
      // wait for a failed tx — reap anyway.
      if (q.unclaimedFeesUsd >= CLAIM_MIN_USD) {
        try {
          const { tx, claimedUsd } = await deps.claimFees(q);
          const claimCents = usdToCents(claimedUsd);
          if (claimCents > 0) {
            const r = q.genome.econ.holderRewardPct;
            const split = splitFeeClaimCents(claimCents, r);
            this.ledger.record("fee-claim", claimCents, { fromId: "$protocol", toId: q.id, atMs: nowMs, note: `final claim ${tx}` });
            const credited = getSessionEngine(q.id)?.adjustCash(split.discretionCents / 100) ?? 0;
            if (credited > 0) state.equityById[q.id] = (state.equityById[q.id] ?? 0) + credited;
            q.computeReserveUsd += (split.computeReserveCents + split.holderRewardCents) / 100;
            q.rewardOwedUsd += split.holderRewardCents / 100;
            q.claimedTotalUsd += claimedUsd;
            noteFeeClaim(q.id, claimedUsd, nowMs);
            q.unclaimedFeesUsd = 0;
            state.events.push({ atMs: nowMs, kind: "fee-claim", quantId: q.id, detail: `final claim $${claimedUsd.toFixed(2)} before the grave (${tx})` });
          }
        } catch (e) {
          deps.log(`final fee claim failed for ${q.id}: ${(e as Error).message} — reaping anyway`);
        }
      }
      const { finalWords, sweptUsd } = reap(q, cause, {
        engine: getSessionEngine(q.id),
        quoteFor: (symbol) => deps.prices.quoteFor(symbol),
        ledger: this.ledger,
        nowMs,
        tick: this.tickIndexOf(q, nowMs),
        championId,
        creditEquity,
        syncRealized: () => this.syncMarketPnl(q, nowMs),
      });
      state.equityById[q.id] = 0;
      state.deaths += 1;
      // §5.4: the memory seals at death and publishes on the grave; the living witness it
      q.sealedMemory = sealSessionMemory(q.id, { name: q.name, cause, finalWords, bornAtMs: q.bornAtMs, diedAtMs: nowMs });
      for (const other of this.living()) {
        noteWitness(other.id, `witnessed a death: ${q.name} (${cause})`, "death", nowMs);
      }
      state.events.push({ atMs: nowMs, kind: "death", quantId: q.id, detail: `${cause} — "${finalWords}"` });
      if (sweptUsd > 0) {
        state.events.push({ atMs: nowMs, kind: "sweep", quantId: q.id, detail: `estate $${sweptUsd.toFixed(2)} → ${championId ?? "operator treasury"}` });
      }
      deps.log(`death: ${q.id} (${cause})`);
    }

    // milestones BEFORE breeding: the feed reads cause-then-effect — a reproduction right is
    // announced before the child it enables
    this.milestones(nowMs);
    await this.breeding(nowMs);
  }

  /**
   * Milestones (A4): reproduction rights earned (allowance crossed a new OFFSPRING milestone)
   * and champion takeovers. First observation is a quiet init — resumed history is not news;
   * only changes are broadcast.
   */
  private milestones(nowMs: number): void {
    const { state } = this;
    for (const q of this.living()) {
      const seen = state.allowanceSeenById[q.id];
      const allowance = offspringAllowance(q.generatedPeakUsd);
      if (seen === undefined) {
        state.allowanceSeenById[q.id] = allowance;
        continue;
      }
      if (allowance > seen) {
        state.allowanceSeenById[q.id] = allowance;
        const milestone = OFFSPRING.allowanceMilestonesUsd[allowance - 1]!;
        state.events.push({ atMs: nowMs, kind: "milestone", quantId: q.id, detail: `crossed $${milestone.toLocaleString("en-US")} lifetime generated — reproduction right #${allowance} earned` });
      }
    }
    if (this.living().length >= 2) {
      const fitness = buildFitnessTable(state.quants, new Map(Object.entries(state.equityById)));
      const champ = pickChampion(state.quants, fitness, "");
      if (champ && state.championId === null) {
        state.championId = champ;
      } else if (champ && champ !== state.championId) {
        state.championId = champ;
        const f = fitness.find((r) => r.id === champ)?.fitness ?? 0;
        state.events.push({ atMs: nowMs, kind: "milestone", quantId: champ, detail: `crowned champion — fitness ${f.toFixed(3)} leads the arena` });
      }
    }
  }

  private async breeding(nowMs: number): Promise<void> {
    const { deps, state } = this;
    const equityMap = new Map(Object.entries(state.equityById));
    const fitness: FitnessRow[] = buildFitnessTable(state.quants, equityMap);
    const eligible = evaluateBreeding(state.quants, fitness, equityMap, nowMs);
    if (eligible.length === 0) return;

    // budget gate: one real launch (plus gas) must fit above the reserve
    const balance = await deps.dustBalanceEth();
    const birthCostEth = 0.0005 + 0.002; // launch fee + gas margin (no dev-buy — airdrops are gone)
    if (balance < deps.reserveEth + birthCostEth) {
      if (!state.birthsPaused) {
        state.birthsPaused = `dust wallet ${balance.toFixed(4)} ETH < reserve ${deps.reserveEth} + birth cost ${birthCostEth.toFixed(4)} — top up to resume births`;
        deps.log(`BIRTHS PAUSED: ${state.birthsPaused}`);
      }
      return;
    }
    state.birthsPaused = null;

    const debitEquity = (quantId: string, usd: number): number => {
      const before = state.equityById[quantId] ?? 0;
      const moved = Math.min(usd, Math.max(0, before));
      state.equityById[quantId] = before - moved;
      getSessionEngine(quantId)?.adjustCash(-moved);
      return moved;
    };

    // walk eligibles until one births (allowance-exhausted leaders don't stall the species)
    for (const parent of eligible) {
      try {
        const result = await executeBirth(parent, {
          quants: state.quants, ledger: this.ledger,
          pons: deps.birthPons, rng: seededRng(`season0-${state.seed}-breed-${state.breedCounter++}`),
          nowMs, ethUsdPrice: deps.prices.ethUsd,
          burnForCadence,
          newbornFeeRate: () => 0, // real fee rates are OBSERVED, never assigned
          walletFor: deps.walletFor,
          parentEquityUsd: state.equityById[parent.id] ?? parent.seedUsd,
          debitEquity,
        });
        if (!result) continue;
        const child = result.child;
        // §5.4: the parent's letter, written from its own memory, addressed to the child's
        // real name — assigned after a successful birth, before the child's first tick
        child.birthLetter = composeBirthLetter(parent.id, parent.name, child.name, nowMs);
        const s0child: Season0Quant = { ...child, lastTickIndex: -1, feeObs: [] };
        state.quants.push(s0child);
        state.equityById[child.id] = child.seedUsd;
        state.realizedSyncedById[child.id] = 0;
        state.births += 1;
        const endow = child.endowment;
        state.events.push({ atMs: nowMs, kind: "birth", quantId: child.id, detail: `self-spawned by ${parent.id} — REAL dust launch ${child.birthTx}, funded $${(endow?.totalUsd ?? 0).toFixed(2)} from ${parent.name} (seed $${child.seedUsd.toFixed(2)}), ${child.genome.meta.mutations.length} mutations` });
        // §5.4: the living witness the birth (the parent already journaled it via the letter)
        for (const other of this.living()) {
          if (other.id !== child.id && other.id !== parent.id) {
            noteWitness(other.id, `witnessed a birth: ${child.name} (gen ${child.generation}, parent ${parent.name})`, "birth", nowMs);
          }
        }
        deps.log(`birth: ${child.id} token ${child.tokenAddr} (parent ${parent.id})`);
        return;
      } catch (e) {
        state.birthsPaused = `real launch failed: ${(e as Error).message}`;
        deps.log(`BIRTHS PAUSED: ${state.birthsPaused}`);
        return;
      }
    }
  }

  private async claims(nowMs: number): Promise<void> {
    const { deps, state } = this;
    for (const q of this.living()) {
      if (q.unclaimedFeesUsd < CLAIM_MIN_USD) continue;
      try {
        const { tx, claimedUsd } = await deps.claimFees(q);
        const claimCents = usdToCents(claimedUsd);
        if (claimCents <= 0) continue;
        const r = q.genome.econ.holderRewardPct;
        const split = splitFeeClaimCents(claimCents, r);
        this.ledger.record("fee-claim", claimCents, { fromId: "$protocol", toId: q.id, atMs: nowMs, note: tx });
        const credited = getSessionEngine(q.id)?.adjustCash(split.discretionCents / 100) ?? 0;
        if (credited > 0) state.equityById[q.id] = (state.equityById[q.id] ?? q.seedUsd) + credited;
        // the holder-reward share is earmarked in the compute reserve (untouchable by trading)
        // until the weekly distributor pays it out
        q.computeReserveUsd += (split.computeReserveCents + split.holderRewardCents) / 100;
        q.rewardOwedUsd += split.holderRewardCents / 100;
        q.claimedTotalUsd += claimedUsd;
        noteFeeClaim(q.id, claimedUsd, nowMs);
        const generated = (getSessionEngine(q.id)?.realizedPnlUsd ?? 0) + q.claimedTotalUsd;
        if (generated > q.generatedPeakUsd) q.generatedPeakUsd = generated;
        q.unclaimedFeesUsd = 0;
        state.events.push({ atMs: nowMs, kind: "fee-claim", quantId: q.id, detail: `claimed $${claimedUsd.toFixed(2)} on-chain (${tx}) → 10% compute · ${(r * 100).toFixed(0)}% holders earmarked · rest discretion` });
        deps.log(`fee claim: ${q.id} $${claimedUsd.toFixed(2)} tx ${tx}`);
      } catch (e) {
        deps.log(`fee claim failed for ${q.id}: ${(e as Error).message}`);
      }
    }

    // orphan-fee claims (B6): dead agents' pools keep accruing; claim on the same cadence at
    // a gas-disciplined threshold and sweep to the reigning champion. Two flows (claim in,
    // sweep out) keep the dead agent's ledger at zero — the fees were never its generation.
    for (const q of state.quants) {
      if (q.status !== "dead" || q.unclaimedFeesUsd < ORPHAN_CLAIM_MIN_USD) continue;
      try {
        const { tx, claimedUsd } = await deps.claimFees(q);
        const claimCents = usdToCents(claimedUsd);
        if (claimCents <= 0) continue;
        const fitness = buildFitnessTable(state.quants, new Map(Object.entries(state.equityById)));
        const champ = pickChampion(state.quants, fitness, q.id);
        this.ledger.record("fee-claim", claimCents, { fromId: "$protocol", toId: q.id, atMs: nowMs, note: `orphan fees ${tx}` });
        this.ledger.record("champion-sweep", claimCents, { fromId: q.id, toId: champ ?? "$operator-treasury", atMs: nowMs, note: "orphan fees" });
        if (champ) {
          getSessionEngine(champ)?.adjustCash(claimCents / 100);
          state.equityById[champ] = (state.equityById[champ] ?? 0) + claimCents / 100;
        }
        q.claimedTotalUsd += claimedUsd;
        q.unclaimedFeesUsd = 0;
        state.events.push({ atMs: nowMs, kind: "sweep", quantId: q.id, detail: `orphan fees $${claimedUsd.toFixed(2)} → ${champ ?? "operator treasury"} (${tx})` });
        deps.log(`orphan claim: ${q.id} $${claimedUsd.toFixed(2)} → ${champ ?? "treasury"} tx ${tx}`);
      } catch (e) {
        deps.log(`orphan fee claim failed for ${q.id}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * The weekly rewards distributor: pay out each living agent's accrued holder rewards from its
   * earmarked reserve. Season 0: accounting + disclosed operator transfer (the on-chain batch
   * payout wiring is B6). The flow is recorded now — the estate and the ledger move together.
   */
  private rewards(nowMs: number): void {
    const { deps, state } = this;
    for (const q of this.living()) {
      const owedCents = usdToCents(Math.min(q.rewardOwedUsd, q.computeReserveUsd));
      if (owedCents <= 0) continue;
      this.ledger.record("holder-reward", owedCents, { fromId: q.id, toId: "$holders", atMs: nowMs, note: "weekly distribution" });
      q.computeReserveUsd -= owedCents / 100;
      q.rewardOwedUsd = 0;
      q.rewardPaidTotalUsd += owedCents / 100;
      state.events.push({ atMs: nowMs, kind: "reward", quantId: q.id, detail: `holder rewards $${(owedCents / 100).toFixed(2)} distributed (${(q.genome.econ.holderRewardPct * 100).toFixed(0)}% of fees)` });
      deps.log(`rewards: ${q.id} $${(owedCents / 100).toFixed(2)} to holders`);
    }
  }

  /**
   * The social pass (B4): read each account-holding agent's mentions and answer some, in its
   * own voice. The read-path is untrusted input — every mention is sanitized and framed as
   * data, and it can ONLY reach the reply composer: no code path passes social text into the
   * trade gate. Reply appetite derives from the beefiness gene (0–4/day). While the guard
   * flag is on, replies quoting banned phrasing are skipped, not sent.
   */
  private async social(nowMs: number): Promise<void> {
    const { deps, state } = this;
    if (!deps.x || !deps.xAccounts) return;
    const dayIndex = Math.floor(nowMs / 86_400_000);
    if (state.socialReplies.dayIndex !== dayIndex) state.socialReplies = { dayIndex, byQuant: {} };

    for (const q of this.living()) {
      const handle = q.xHandle;
      if (!handle || !deps.xAccounts(handle)) continue;
      let mentions: XMention[];
      try {
        mentions = await deps.x.readMentions(handle, state.lastMentionIdByHandle[handle]);
      } catch (e) {
        deps.log(`mentions read failed for @${handle}: ${(e as Error).message}`);
        continue;
      }
      const budget = Math.round(q.genome.voice.beefiness * 4);
      for (const m of mentions) {
        state.lastMentionIdByHandle[handle] = m.id; // the cursor advances whether or not we answer
        const used = state.socialReplies.byQuant[q.id] ?? 0;
        if (used >= budget) continue;
        const framed = frameSocialText(sanitizeSocialText(m.text));
        const mem = getSessionMemory(q.id);
        const text = composeTweet({
          kind: "reply",
          name: q.name,
          ticker: q.ticker,
          voice: q.genome.voice,
          rng: seededRng(`${q.id}-reply-${m.id}`),
          replyTo: framed,
          avoid: mem ? recentPostTexts(mem, 5) : [],
        });
        if (deps.tweetGuard !== false && !guardTweet(text, { ticker: q.ticker }).ok) continue;
        try {
          await deps.x.post(handle, text, m.id);
          state.socialReplies.byQuant[q.id] = used + 1;
          noteSocialPost(q.id, text, nowMs);
          state.events.push({ atMs: nowMs, kind: "tweet", quantId: q.id, detail: `↳ ${text}` });
        } catch (e) {
          deps.log(`reply failed for @${handle}: ${(e as Error).message}`);
        }
      }
    }
  }

  /** The dashboard world — same schema the sim writes, plus real-season markers. */
  render(nowMs: number): Record<string, unknown> {
    const { state } = this;
    const equityMap = new Map(Object.entries(state.equityById));
    const fitness = buildFitnessTable(state.quants, equityMap);
    const fitnessById = new Map(fitness.map((r) => [r.id, r.fitness]));
    return {
      real: true,
      custody: state.custody,
      agentZero: state.agentZero,
      birthsPaused: state.birthsPaused,
      config: { seed: state.seed, accel: 1, minutes: Math.round((nowMs - state.startedAtMs) / 60_000), mode: "paper" },
      simStartMs: state.startedAtMs,
      simEndMs: nowMs,
      births: state.births,
      deaths: state.deaths,
      quants: state.quants.map((q) => toOut(q, state.equityById[q.id] ?? q.seedUsd, fitnessById.get(q.id) ?? null, this.ledger)),
      flows: this.ledger.toJSON(),
      events: state.events.slice(-800),
    };
  }

  /** Atomic persistence: full runtime state + the rendered dashboard world. */
  persist(worldPath: string, evolutionPath: string, nowMs: number): void {
    this.state.sessions = serializeQuantSessions();
    this.state.prices = this.deps.prices.serialize();
    writeAtomic(worldPath, JSON.stringify(this.state));
    writeAtomic(evolutionPath, JSON.stringify(this.render(nowMs), null, 2));
  }

  static load(worldPath: string, deps: Season0Deps): Season0Runtime {
    const raw = JSON.parse(readFileSync(worldPath, "utf8")) as Record<string, unknown>;
    if (raw.version !== 1 || raw.real !== true) {
      throw new Error(`season0 world at ${worldPath}: unsupported shape`);
    }
    const state = migrateState(raw);
    return new Season0Runtime(state, deps);
  }
}

/**
 * Pre-B0 state migration (2026-08-02): the pool-era world had `ledgerStartCents`/`ledgerEntries`
 * (treasury types) and `mother`. Map to flow entries best-effort — old pool movements become
 * disclosed legacy sink flows — and default the new per-quant counters. Accounting from the
 * migration point forward is exact; the pool era's balances are history, not reconciled (see
 * build/state/NOTES.md).
 */
function migrateState(raw: Record<string, unknown>): Season0State {
  const state = raw as unknown as Season0State & {
    ledgerEntries?: Array<{ type: string; amountCents: number; atMs: number; quantId?: string; note?: string }>;
    ledgerStartCents?: number;
    mother?: Season0State["agentZero"];
  };
  if (!Array.isArray(state.flowEntries)) {
    const flows: FlowEntry[] = [];
    for (const e of state.ledgerEntries ?? []) {
      const q = e.quantId ?? "unknown";
      const base = { atMs: e.atMs, note: `legacy pool era: ${e.type}${e.note ? ` — ${e.note}` : ""}` };
      if (e.type === "seed-paid") flows.push({ type: "bootstrap", amountCents: e.amountCents, fromId: "$operator", toId: q, ...base });
      else if (e.type === "top-up") flows.push({ type: "bootstrap", amountCents: e.amountCents, fromId: "$operator", toId: "$sink", ...base });
      else flows.push({ type: "compute-burn", amountCents: e.amountCents, fromId: q, toId: "$sink", ...base });
    }
    state.flowEntries = flows;
  }
  if (!state.agentZero && state.mother) state.agentZero = state.mother;
  state.lastRewardMs = state.lastRewardMs ?? state.startedAtMs;
  state.realizedSyncedById = state.realizedSyncedById ?? {};
  // B4 social pass cursors
  state.lastSocialMs = state.lastSocialMs ?? 0;
  state.lastMentionIdByHandle = state.lastMentionIdByHandle ?? {};
  state.socialReplies = state.socialReplies ?? { dayIndex: 0, byQuant: {} };
  // A4 milestone cursors: quiet-init to CURRENT values — pre-upgrade history is not news
  state.championId = state.championId ?? null;
  if (!state.allowanceSeenById) {
    state.allowanceSeenById = {};
    for (const q of state.quants) {
      state.allowanceSeenById[q.id] = offspringAllowance(q.generatedPeakUsd ?? 0);
    }
  }
  for (const q of state.quants) {
    q.claimedTotalUsd = q.claimedTotalUsd ?? 0;
    q.rewardPaidTotalUsd = q.rewardPaidTotalUsd ?? 0;
    q.rewardOwedUsd = q.rewardOwedUsd ?? 0;
    q.generatedPeakUsd = q.generatedPeakUsd ?? 0;
    q.childrenCount = q.childrenCount ?? 0;
    // pre-B0 genomes carry no econ section — fill the default holder-reward trait
    (q.genome as { econ?: { holderRewardPct: number } }).econ ??= { holderRewardPct: 0.2 };
    // and no designed x handle
    q.xHandle = q.xHandle ?? xHandleOf(q.name);
    // §5.4 fields (pre-B2 worlds)
    q.birthLetter = q.birthLetter ?? null;
    q.sealedMemory = q.sealedMemory ?? null;
  }
  return state;
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content + "\n");
  renameSync(tmp, path);
}

export function season0WorldExists(worldPath: string): boolean {
  return existsSync(worldPath);
}
