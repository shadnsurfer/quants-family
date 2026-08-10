/**
 * Birth executor (PROJECT.md §4.4, 2026-08-02): ONE child per event, a clone of its single
 * parent pushed through the mutation engine, funded entirely from the PARENT's own balance
 * (endowment = 20% of parent equity, covering the $1.50 Pons launch fee; the remainder is the
 * trading seed, which must clear $200). The lifetime offspring allowance (milestones on
 * generatedPeakUsd) is re-verified at execution — an aborted birth returns null WITHOUT
 * burning the parent's cooldown, moving money, or launching a token.
 *
 * All randomness is seeded. Expected amounts are hand-computed in integer cents from
 * MONEY.parentEndowmentPct / MONEY.launchFeeEth / MONEY.minChildTradingUsd.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNAL_GENES, INHERIT_UNITS, MONEY, genomeHash, offspringAllowance, parseGenome,
  seededRng, slugOf, usdToCents,
  type Genome,
} from "@quants/core";
import {
  FlowLedger, executeBirth,
  type BirthContext, type QuantRecord,
} from "../src/index.js";

const NOW_MS = 1_767_605_400_000;
const ETH_USD = 3_000;
const LAUNCH_FEE_CENTS = usdToCents(MONEY.launchFeeEth * ETH_USD); // 150c = $1.50
const MIN_SEED_CENTS = usdToCents(MONEY.minChildTradingUsd); // 20,000c = $200

function makeGenome(id: string, name: string, generation: number, parents: string[]): Genome {
  return {
    meta: { id, name, ticker: name.slice(0, 6).toUpperCase(), generation, parents, mutations: [], birthTx: null, genomeHash: null },
    edge: {
      archetype: "momentum", universe: ["NVDA", "TSLA"], aggression: 0.6,
      patience: { minHoldMin: 30, maxHoldHrs: 48 }, fear: 0.05, conviction: 0.12,
      cadenceMin: 20, darkHours: 0.5, entryThesisStyle: "test-style",
      signal: { ...DEFAULT_SIGNAL_GENES },
      researchStyle: "priceAction", flowWeight: 0, flowSkepticism: 0.5,
    },
    econ: { holderRewardPct: 0.2 },
    voice: {
      archetype: "stoic", postsPerDay: 4, flexStyle: "receipts-only",
      beefiness: 0.2, lowercase: true, emojiPolicy: "none",
    },
  };
}

interface ParentSpec {
  generatedPeakUsd?: number;
  childrenCount?: number;
  lastBroodAtMs?: number | null;
}

function makeParent(spec: ParentSpec = {}): QuantRecord {
  const id = "g1-papa";
  return {
    id, name: "papa", ticker: "PAPA",
    generation: 1, parents: ["g0-eve"],
    genome: makeGenome(id, "papa", 1, ["g0-eve"]), genomeHash: "0xfixture",
    status: "alive",
    bornAtMs: NOW_MS - 100 * 3_600_000, diedAtMs: null, causeOfDeath: null, finalWords: null,
    seedUsd: 1_500, processRunning: true,
    lastBroodAtMs: spec.lastBroodAtMs ?? null,
    peakEquityUsd: 2_000, feeRatePerHourUsd: 0.8, dailyBurnUsd: 0.7,
    computeReserveUsd: 0, unclaimedFeesUsd: 0,
    walletAddr: "0xwallet-g1-papa", tokenAddr: "0xtok", poolAddr: "0xpool", birthTx: "tx",
    claimedTotalUsd: 0, rewardPaidTotalUsd: 0, rewardOwedUsd: 0,
    generatedPeakUsd: spec.generatedPeakUsd ?? 1_500, // allowance 1 by default (> $1k milestone)
    childrenCount: spec.childrenCount ?? 0,
  };
}

interface Rig {
  ctx: BirthContext;
  ledger: FlowLedger;
  debits: Array<{ quantId: string; usd: number }>;
  launches: Array<{ name: string; feeWallet: string; devBuyEth: number }>;
}

/**
 * A ctx wired like the sim's: the parent is pre-funded on the ledger (genesis bootstrap), the
 * pons stub captures every launch (esp. devBuyEth), and debitEquity is a full-balance stub that
 * records every debit for exact assertion.
 */
function makeCtx(
  parent: QuantRecord,
  quants: QuantRecord[],
  over: Partial<BirthContext> = {},
  seed = "birth",
): Rig {
  const ledger = new FlowLedger();
  // pre-fund the parent on the ledger (as genesis bootstrap would) so the birth-funding
  // debit passes the solvency gate — the rich default needs up to 20% of $100k
  ledger.record("bootstrap", usdToCents(100_000), { fromId: "$operator", toId: parent.id, atMs: 0, note: "test funding" });
  const debits: Rig["debits"] = [];
  const launches: Rig["launches"] = [];
  const ctx: BirthContext = {
    quants,
    ledger,
    pons: {
      launch: (meta, feeWallet, devBuyEth) => {
        launches.push({ name: meta.name, feeWallet, devBuyEth });
        return { tokenAddr: `0x${"ab".repeat(20)}`, poolAddr: `0x${"cd".repeat(20)}`, tx: `paper-launch-${meta.name}` };
      },
    },
    rng: seededRng(seed),
    nowMs: NOW_MS,
    ethUsdPrice: ETH_USD,
    burnForCadence: (cadenceMin) => cadenceMin / 100,
    newbornFeeRate: () => 0.5,
    walletFor: (quantId) => `0x${quantId.padEnd(40, "0").slice(0, 40)}`,
    parentEquityUsd: 100_000, // rich by default; cascade-boundary tests override down
    debitEquity: (quantId, usd) => {
      debits.push({ quantId, usd });
      return usd;
    },
    ...over,
  };
  return { ctx, ledger, debits, launches };
}

describe("executeBirth — happy path (one child, parent-funded)", () => {
  it("births exactly ONE child: clone of the parent, fresh meta, zeroed counters", async () => {
    const parent = makeParent();
    const { ctx } = makeCtx(parent, [parent]);
    const result = (await executeBirth(parent, ctx))!;
    const child = result.child;

    expect(child.generation).toBe(2); // papa is gen 1
    expect(child.parents).toEqual(["g1-papa"]); // ONE parent — single-parent design
    expect(child.id).toBe(`g2-${slugOf(child.name)}`); // id is the slugged, safe form of the designed name
    expect(child.xHandle.length).toBeGreaterThan(0);
    expect(child.xHandle.length).toBeLessThanOrEqual(15);
    expect(child.status).toBe("alive");
    expect(child.processRunning).toBe(true);
    expect(child.bornAtMs).toBe(NOW_MS);
    expect(child.diedAtMs).toBeNull();
    expect(child.causeOfDeath).toBeNull();
    expect(child.genome.meta.id).toBe(child.id);
    expect(child.genome.meta.generation).toBe(2);
    expect(child.genome.meta.parents).toEqual(["g1-papa"]);
    // the newborn's books all start at zero
    expect(child.claimedTotalUsd).toBe(0);
    expect(child.rewardPaidTotalUsd).toBe(0);
    expect(child.rewardOwedUsd).toBe(0);
    expect(child.generatedPeakUsd).toBe(0);
    expect(child.childrenCount).toBe(0);
    expect(child.lastBroodAtMs).toBeNull();
    expect(child.computeReserveUsd).toBe(0);
    expect(child.unclaimedFeesUsd).toBe(0);
    expect(child.peakEquityUsd).toBe(child.seedUsd);
    expect(child.dailyBurnUsd).toBe(child.genome.edge.cadenceMin / 100); // ctx.burnForCadence wired
    expect(child.feeRatePerHourUsd).toBe(0.5); // ctx.newbornFeeRate wired
    expect(child.walletAddr).toBe(ctx.walletFor(child.id));
    expect(child.birthTx).toBe(`paper-launch-${child.name}`);
  });

  it("runs the funding cascade: parent debited 20% of its equity, seed = endowment − launch fee", async () => {
    const parent = makeParent();
    // $100,000 equity → endowment $20,000 → seed $19,998.50 after the $1.50 launch fee
    const { ctx, ledger, debits } = makeCtx(parent, [parent]);
    const child = (await executeBirth(parent, ctx))!.child;

    const endowmentCents = usdToCents(100_000 * MONEY.parentEndowmentPct); // 2,000,000c
    const seedCents = endowmentCents - LAUNCH_FEE_CENTS;
    expect(debits).toEqual([{ quantId: "g1-papa", usd: endowmentCents / 100 }]); // parent actually debited
    expect(child.endowment).toEqual({
      fromQuantId: "g1-papa",
      totalUsd: endowmentCents / 100,
      launchFeeUsd: LAUNCH_FEE_CENTS / 100,
      tradingSeedUsd: seedCents / 100,
    });
    expect(child.seedUsd).toBe(seedCents / 100);

    // exactly two flow entries past the test's funding bootstrap: the cascade, then the fee
    const births = ledger.entries.filter((e) => e.type === "birth-funding");
    const fees = ledger.entries.filter((e) => e.type === "launch-fee");
    expect(ledger.entries).toHaveLength(3);
    expect(births).toEqual([{
      type: "birth-funding", amountCents: endowmentCents, fromId: "g1-papa", toId: child.id, atMs: NOW_MS,
    }]);
    expect(fees).toEqual([{
      type: "launch-fee", amountCents: LAUNCH_FEE_CENTS, fromId: child.id, toId: "$sink", atMs: NOW_MS, note: "pons launch",
    }]);
    expect(ledger.balanceOf(child.id)).toBe(seedCents);
    expect(ledger.balanceOf("g1-papa")).toBe(usdToCents(100_000) - endowmentCents);
    expect(ledger.conservationCheck().ok).toBe(true);
  });

  it("burns ONLY the parent's cooldown and counts exactly one more child", async () => {
    const parent = makeParent();
    const bystander = makeParent({ childrenCount: 0 });
    bystander.id = "g1-other";
    bystander.name = "other";
    const { ctx } = makeCtx(parent, [parent, bystander]);
    expect(parent.childrenCount).toBe(0);
    expect(parent.lastBroodAtMs).toBeNull();

    const child = (await executeBirth(parent, ctx))!.child;
    expect(parent.childrenCount).toBe(1);
    expect(parent.lastBroodAtMs).toBe(NOW_MS);
    expect(bystander.childrenCount).toBe(0); // nobody else pays
    expect(bystander.lastBroodAtMs).toBeNull();
    expect(child.childrenCount).toBe(0); // newborns start cooldown-free
  });

  it("launches with devBuyEth === 0 — airdrops/dev-buys are gone", async () => {
    const parent = makeParent();
    const { ctx, launches } = makeCtx(parent, [parent]);
    const child = (await executeBirth(parent, ctx))!.child;
    expect(launches).toHaveLength(1);
    expect(launches[0]!.devBuyEth).toBe(0);
    expect(launches[0]!.name).toBe(child.name);
    expect(launches[0]!.feeWallet).toBe(child.walletAddr); // the child's own wallet from day one
  });

  it("the child genome parses, its hash matches, and the origins report covers every unit", async () => {
    const parent = makeParent();
    const { ctx } = makeCtx(parent, [parent]);
    const child = (await executeBirth(parent, ctx))!.child;
    const reparsed = parseGenome(JSON.parse(JSON.stringify(child.genome))); // zod re-parse enforces every clamp
    expect(genomeHash(reparsed)).toBe(child.genomeHash);
    expect(child.genomeHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(child.geneOrigins).toBeTruthy();
    expect(Object.keys(child.geneOrigins!)).toEqual([...INHERIT_UNITS]);
    for (const origin of Object.values(child.geneOrigins!)) {
      expect(["parent", "mutated"]).toContain(origin.from); // single parent — no mate, no both
    }
  });

  it("is deterministic: the same seed replays a byte-identical child", async () => {
    const a = makeParent();
    const b = makeParent();
    const childA = (await executeBirth(a, makeCtx(a, [a], {}, "replay").ctx))!.child;
    const childB = (await executeBirth(b, makeCtx(b, [b], {}, "replay").ctx))!.child;
    expect(childA).toEqual(childB);
  });
});

describe("executeBirth — the $200 seed boundary (seed = 20% of equity − $1.50 launch fee)", () => {
  // viability: round(equityCents × 0.2) − 150 ≥ 20,000 — the floor is equity $1,007.48 in cents
  // math ((200 + 1.50) / 0.2 = $1,007.50; the cents rounding puts the exact edge at 100748c).
  it("equity $1,007.51 → endowment $201.50 → seed exactly $200.00 → the birth proceeds", async () => {
    const parent = makeParent();
    const { ctx, ledger, debits } = makeCtx(parent, [parent], { parentEquityUsd: 1_007.51 });
    const child = (await executeBirth(parent, ctx))!.child;
    expect(debits).toEqual([{ quantId: "g1-papa", usd: 201.5 }]);
    expect(child.seedUsd).toBe(200);
    expect(child.endowment).toEqual({ fromQuantId: "g1-papa", totalUsd: 201.5, launchFeeUsd: 1.5, tradingSeedUsd: 200 });
    expect(ledger.totalCents("birth-funding")).toBe(20_150);
    expect(ledger.totalCents("launch-fee")).toBe(LAUNCH_FEE_CENTS);
    expect(parent.childrenCount).toBe(1);
    expect(parent.lastBroodAtMs).toBe(NOW_MS);
  });

  it("pins the exact cents edge: $1,007.48 seeds exactly $200 (viable); $1,007.47 falls one cent short (null)", async () => {
    const viable = makeParent();
    const ok = makeCtx(viable, [viable], { parentEquityUsd: 1_007.48 });
    // 100748c × 0.2 = 20149.6 → round 20150c → seed 20000c = $200 exactly
    expect((await executeBirth(viable, ok.ctx))!.child.seedUsd).toBe(200);

    const poor = makeParent();
    const short = makeCtx(poor, [poor], { parentEquityUsd: 1_007.47 });
    // 100747c × 0.2 = 20149.4 → round 20149c → seed 19999c < $200
    expect(await executeBirth(poor, short.ctx)).toBeNull();
    expect(short.debits).toHaveLength(0);
    expect(short.ledger.totalCents("birth-funding")).toBe(0);
    expect(poor.lastBroodAtMs).toBeNull(); // poverty is not a birth — no cooldown burned
    expect(poor.childrenCount).toBe(0);
  });

  it("a $1,000 parent cannot afford a viable child: null, nothing moves, cooldown NOT burned", async () => {
    const parent = makeParent();
    // 20% of $1,000 = $200.00 endowment − $1.50 launch fee = $198.50 seed < $200 floor
    const { ctx, ledger, debits, launches } = makeCtx(parent, [parent], { parentEquityUsd: 1_000 });
    expect(await executeBirth(parent, ctx)).toBeNull();
    expect(ledger.entries).toHaveLength(1); // only the test's funding bootstrap
    expect(debits).toHaveLength(0); // the parent was never debited for a child that wasn't born
    expect(launches).toHaveLength(0); // no token launched
    expect(parent.lastBroodAtMs).toBeNull();
    expect(parent.childrenCount).toBe(0);
    expect(ledger.conservationCheck().ok).toBe(true);
  });
});

describe("executeBirth — the lifetime offspring allowance, re-verified at execution", () => {
  it("allowance exhausted (childrenCount === allowance) → null, no flows, no launch, no cooldown", async () => {
    const parent = makeParent({ generatedPeakUsd: 2_100, childrenCount: 2 }); // allowance 2 at >$2k, spent
    expect(offspringAllowance(parent.generatedPeakUsd)).toBe(2);
    const { ctx, ledger, debits, launches } = makeCtx(parent, [parent]);
    expect(await executeBirth(parent, ctx)).toBeNull();
    expect(ledger.entries).toHaveLength(1); // only the test's funding bootstrap
    expect(debits).toHaveLength(0);
    expect(launches).toHaveLength(0);
    expect(parent.childrenCount).toBe(2); // unchanged
    expect(parent.lastBroodAtMs).toBeNull();
  });

  it("zero generated capital means zero allowance — even a rich, childless parent is refused", async () => {
    const parent = makeParent({ generatedPeakUsd: 0, childrenCount: 0 });
    expect(offspringAllowance(0)).toBe(0);
    const { ctx, ledger, debits, launches } = makeCtx(parent, [parent]);
    expect(await executeBirth(parent, ctx)).toBeNull();
    expect(ledger.entries).toHaveLength(1);
    expect(debits).toHaveLength(0);
    expect(launches).toHaveLength(0);
    expect(parent.lastBroodAtMs).toBeNull();
  });

  it("milestones are strictly-greater: peak exactly $1,000 → no allowance; one cent over → one child", async () => {
    const at = makeParent({ generatedPeakUsd: 1_000, childrenCount: 0 });
    expect(offspringAllowance(1_000)).toBe(0);
    expect(await executeBirth(at, makeCtx(at, [at]).ctx)).toBeNull();
    expect(at.lastBroodAtMs).toBeNull();

    const over = makeParent({ generatedPeakUsd: 1_000.01, childrenCount: 0 });
    expect(offspringAllowance(1_000.01)).toBe(1);
    const result = await executeBirth(over, makeCtx(over, [over]).ctx);
    expect(result).not.toBeNull();
    expect(over.childrenCount).toBe(1);
    expect(over.lastBroodAtMs).toBe(NOW_MS);
  });

  it("the allowance is checked before poverty: a spent parent aborts even when it could afford the seed", async () => {
    const parent = makeParent({ generatedPeakUsd: 2_100, childrenCount: 2 });
    const { ctx, debits } = makeCtx(parent, [parent], { parentEquityUsd: 100_000 });
    expect(await executeBirth(parent, ctx)).toBeNull();
    expect(debits).toHaveLength(0);
    expect(parent.lastBroodAtMs).toBeNull();
  });
});
