/**
 * runEvolution (M3 referee entry) — the same run sim-evolution.mjs writes to
 * build/logs/evolution.json, checked here against in-test mirrors of the
 * assert-invariants.mjs referees, re-expressed for the 2026-08-02 no-pool model:
 *   I1  flow conservation + per-agent estate↔ledger reconciliation (to the cent),
 *   I2  no zombies, I3 family-tree consistency.
 *
 * Bootstrap (hand-shaped resume): eve (gen 0, allowance 2 at >$2k generated — SPENT on the
 * two pre-spawned gen-1 children), child1 (peak $1,200 → allowance 1, leads fitness, births
 * gen 2 in-window), child2 (resumed a whisper above the ruin line with collapsed fees —
 * burn debits push it under §4.5 mid-window on the referee seed). Genesis seeds are the ONLY
 * operator-funded flows; the gen-2 child is funded 20% from child1's own equity minus the
 * $1.50 launch fee. The dead child's estate sweeps to the champion.
 *
 * One full run (seed 42, accel 60, 20 minutes) shared from beforeAll.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { INHERIT_UNITS, MONEY, offspringAllowance } from "@quants/core";
import { guardTweet } from "@quants/brain";
import { runEvolution, burnForCadence, type EvolutionResult } from "../src/index.js";

let r: EvolutionResult;

beforeAll(async () => {
  r = await runEvolution({ seed: 42, accel: 60, minutes: 20, mode: "paper" });
}, 180_000);

// ---------- in-test mirrors of the assert-invariants.mjs referees ----------

/** I2: no dead quant may keep a process or a position. */
function zombies(res: EvolutionResult): string[] {
  return res.quants
    .filter((q) => q.status === "dead" && (q.processRunning || q.openPositions > 0))
    .map((q) => q.id);
}

/** I3 support: every ancestor id reachable from `id`, once per PATH — duplicates = diamond/cycle. */
function ancestorWalk(id: string, byId: Map<string, EvolutionResult["quants"][number]>, depth = 0): string[] {
  if (depth > 64) throw new Error(`ancestor walk did not terminate at ${id}`);
  const out: string[] = [];
  for (const p of byId.get(id)?.parents ?? []) {
    out.push(p, ...ancestorWalk(p, byId, depth + 1));
  }
  return out;
}

function assertInvariants(res: EvolutionResult): void {
  // I1: double-entry conservation AND per-agent reconciliation, to the cent
  expect(res.flows.conservation.ok).toBe(true);
  expect(res.flows.conservation.sumCents).toBe(0);
  expect(res.flows.conservation.negativeAgents).toEqual([]);
  for (const q of res.quants) {
    expect(Math.abs(q.estateUsd - q.ledgerBalanceUsd)).toBeLessThanOrEqual(0.01);
  }
  // I2
  expect(zombies(res)).toEqual([]);
  // I3
  const byId = new Map(res.quants.map((q) => [q.id, q]));
  for (const q of res.quants) {
    expect(q.parents.length).toBeLessThanOrEqual(1); // single parent, ever
    for (const p of q.parents) expect(byId.has(p)).toBe(true); // parents exist
    const walked = ancestorWalk(q.id, byId); // terminates (no cycles)
    expect(new Set(walked).size).toBe(walked.length); // single-parent chains cannot diamond
  }
}

/** In-window births are exactly the endowed quants — bootstrap resumes carry no endowment. */
function bornInWindow(res: EvolutionResult): EvolutionResult["quants"] {
  return res.quants.filter((q) => q.endowment !== null);
}

const gen1 = (res: EvolutionResult) => res.quants.filter((q) => q.generation === 1);

describe("runEvolution — seed 42, accel 60, 20 minutes (the M3 referee configuration)", () => {
  it("clears the milestone gate: at least one birth AND at least one death", () => {
    expect(r.births).toBeGreaterThanOrEqual(1);
    expect(r.deaths).toBeGreaterThanOrEqual(1);
    // bootstrap is eve + two pre-spawned gen-1 children; every other quant was born in-window
    expect(r.quants).toHaveLength(3 + r.births);
    expect(r.quants.filter((q) => q.status === "dead")).toHaveLength(r.deaths);
  });

  it("holds all three referee invariants (I1 conservation + reconciliation, I2, I3)", () => {
    assertInvariants(r);
  });

  it("flows: the operator funds ONLY the 3 genesis seeds; every birth pays its $1.50 launch fee to the sink", () => {
    const f = r.flows;
    // genesis bootstrap: eve + 2 children × GENESIS_SEED_USD $1,500 — the only operator money
    expect(f.totals.bootstrap).toBeCloseTo(3 * 1_500, 6);
    expect(f.external.operator).toBeCloseTo(-3 * 1_500, 6);
    // every in-window birth: parent-funded endowment in, exactly one $1.50 launch fee out
    expect(f.totals.birthFunding).toBeGreaterThan(0);
    expect(f.totals.launchFees).toBeCloseTo(r.births * 1.5, 6);
    for (const c of bornInWindow(r)) {
      expect(c.endowment!.launchFeeUsd).toBeCloseTo(1.5, 6); // 0.0005 ETH × $3,000
      // the endowment splits exactly into launch fee + the trading seed the child holds
      expect(c.endowment!.totalUsd).toBeCloseTo(c.endowment!.launchFeeUsd + c.endowment!.tradingSeedUsd, 6);
      expect(c.seedUsd).toBeCloseTo(c.endowment!.tradingSeedUsd, 6);
      expect(c.seedUsd).toBeGreaterThanOrEqual(MONEY.minChildTradingUsd);
    }
    // the species lived: fees were claimed, compute burned, the dead were swept
    expect(f.totals.feeClaims).toBeGreaterThan(0);
    expect(f.totals.computeBurns).toBeGreaterThan(0);
    expect(f.totals.championSweeps).toBeGreaterThan(0);
    // holder rewards are EARMARKED in-window (weekly distribution; 20 sim-hours < 7 days):
    // nothing distributed yet, the earmark sits in owed + compute reserve (B6 model)
    expect(f.totals.holderRewards).toBe(0);
    expect(r.quants.some((q) => q.rewardOwedUsd > 0)).toBe(true);
    // a champion survived to receive every sweep — the operator treasury was never touched
    expect(f.external.operatorTreasury).toBe(0);
    expect(f.entryCount).toBeGreaterThan(0);
  });

  it("the lineage: eve alive at gen 0 with its allowance SPENT; the in-window birth is child1's, not eve's", () => {
    const eve = r.quants[0]!;
    expect(eve.generation).toBe(0);
    expect(eve.status).toBe("alive");
    expect(eve.parents).toEqual([]);
    expect(eve.bornAtMs).toBeLessThan(r.simStartMs); // resumed mid-life
    expect(eve.endowment).toBeNull();
    expect(eve.geneOrigins).toBeNull();
    // eve resumed with peak $2,100 → allowance 2 — and two children already born: spent.
    // (the peak is monotonic; in-window gains can only ADD allowance, so pin the spent state
    // via childrenCount and the absence of eve-parented in-window births)
    expect(eve.generatedPeakUsd).toBeGreaterThanOrEqual(2_100);
    expect(eve.childrenCount).toBe(2);
    expect(eve.allowance).toBe(offspringAllowance(eve.generatedPeakUsd));

    // the two pre-spawned gen-1 children of eve, resumed pre-window, never endowed
    const g1 = gen1(r);
    expect(g1).toHaveLength(2);
    for (const c of g1) {
      expect(c.parents).toEqual([eve.id]);
      expect(c.bornAtMs).toBeLessThan(r.simStartMs);
      expect(c.endowment).toBeNull();
    }

    // child1 (peak $1,200 → allowance 1) survives and parents every in-window birth — eve does not
    const child1 = g1.find((q) => q.status === "alive")!;
    expect(child1.generatedPeakUsd).toBeGreaterThanOrEqual(1_200);
    const children = bornInWindow(r);
    expect(children.length).toBe(r.births);
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) {
      expect(c.generation).toBe(2);
      expect(c.parents).toEqual([child1.id]);
      expect(c.endowment!.fromQuantId).toBe(child1.id);
      expect(c.bornAtMs).toBeGreaterThan(r.simStartMs);
      expect(c.bornAtMs).toBeLessThanOrEqual(r.simEndMs);
    }
    expect(child1.childrenCount).toBe(r.births);
    // and the gen-2 child was funded out of child1's OWN balance: 20% endowment, $1.50 fee, seed ≥ $200
    expect(children[0]!.endowment!.totalUsd).toBeGreaterThanOrEqual(MONEY.minChildTradingUsd + 1.5);
  });

  it("child2 — the hand-shaped casualty — dies of ruin in-window, and its estate sweeps to a living champion", () => {
    const child2 = gen1(r).find((q) => q.status === "dead")!;
    expect(child2).toBeDefined();
    expect(child2.causeOfDeath).toBe("ruin");
    expect(child2.processRunning).toBe(false);
    expect(child2.openPositions).toBe(0);
    expect(child2.equityUsd).toBe(0);
    expect(child2.estateUsd).toBe(0); // drained
    expect(child2.diedAtMs).toBeGreaterThan(r.simStartMs);
    expect(child2.diedAtMs).toBeLessThanOrEqual(r.simEndMs);

    // the sweep went to a LIVING quant (the champion at death time) — not the operator treasury
    const sweeps = r.events.filter((e) => e.kind === "sweep" && e.quantId === child2.id);
    expect(sweeps.length).toBeGreaterThanOrEqual(1);
    const byId = new Map(r.quants.map((q) => [q.id, q]));
    for (const s of sweeps) {
      const dest = s.detail.split(" → ").pop()!;
      const recipient = byId.get(dest);
      expect(recipient).toBeDefined();
      expect(recipient!.status).toBe("alive");
      expect(recipient!.id).not.toBe(child2.id);
    }
  });

  it("every quant exposes the reproduction governor + reconciliation fields, self-consistently", () => {
    for (const q of r.quants) {
      expect(q.holderRewardPct).toBeGreaterThanOrEqual(0);
      expect(q.holderRewardPct).toBeLessThanOrEqual(0.4);
      expect(q.claimedTotalUsd).toBeGreaterThanOrEqual(0);
      expect(q.rewardPaidTotalUsd).toBeGreaterThanOrEqual(0);
      expect(q.generatedPeakUsd).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(q.childrenCount)).toBe(true);
      expect(q.childrenCount).toBeGreaterThanOrEqual(0);
      // the exported allowance is exactly the governor's reading of the exported peak
      expect(q.allowance).toBe(offspringAllowance(q.generatedPeakUsd));
      expect(q.childrenCount).toBeLessThanOrEqual(q.allowance); // the governor held
      expect(Number.isFinite(q.estateUsd)).toBe(true);
      expect(Number.isFinite(q.ledgerBalanceUsd)).toBe(true);
    }
    // the per-quant reward counters reconcile with the flow totals, to the cent
    const paid = r.quants.reduce((s, q) => s + q.rewardPaidTotalUsd, 0);
    const claimed = r.quants.reduce((s, q) => s + q.claimedTotalUsd, 0);
    expect(paid).toBeCloseTo(r.flows.totals.holderRewards, 6);
    expect(claimed).toBeCloseTo(r.flows.totals.feeClaims, 6);
  });

  it("every spawned quant — bootstrap gen-1 AND in-window gen-2 — carries a selfGeneOrigins report over all 27 units", () => {
    const spawned = [...gen1(r), ...bornInWindow(r)];
    expect(spawned.length).toBeGreaterThanOrEqual(3);
    for (const q of spawned) {
      expect(q.geneOrigins).toBeTruthy();
      expect(Object.keys(q.geneOrigins!)).toEqual([...INHERIT_UNITS]);
      for (const origin of Object.values(q.geneOrigins!)) {
        expect(["parent", "mutated"]).toContain(origin.from); // no mate, no 'both' — ever
      }
    }
  });

  it("every grave is complete: cause, time, guarded final words; every living quant is solvent", () => {
    for (const q of r.quants) {
      if (q.status === "dead") {
        expect(["ruin", "starvation"]).toContain(q.causeOfDeath);
        expect(q.diedAtMs).not.toBeNull();
        expect(q.finalWords).not.toBeNull();
        expect(q.finalWords!.length).toBeGreaterThan(0);
        expect(guardTweet(q.finalWords!, { ticker: q.ticker }).ok).toBe(true);
        expect(q.fitness).toBeNull(); // the dead are no longer ranked
      } else {
        expect(q.diedAtMs).toBeNull();
        expect(q.causeOfDeath).toBeNull();
        expect(q.equityUsd).toBeGreaterThan(0);
        expect(typeof q.fitness).toBe("number"); // the living always are
      }
    }
  });

  it("identity hygiene: unique ids and names, real genome hashes, plausible token addresses", () => {
    const ids = r.quants.map((q) => q.id);
    const names = r.quants.map((q) => q.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const q of r.quants) {
      expect(q.genomeHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(q.tokenAddr).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });

  it("event tape: known kinds only, one SELF-SPAWNED birth event per birth, one death event per death, all in-window", () => {
    const allowed = new Set(["birth", "death", "fee-claim", "trade", "tweet", "halt", "reward", "sweep", "veto", "milestone"]);
    const ids = new Set(r.quants.map((q) => q.id));
    for (const e of r.events) {
      expect(allowed.has(e.kind)).toBe(true);
      expect(ids.has(e.quantId)).toBe(true);
      expect(e.atMs).toBeGreaterThanOrEqual(r.simStartMs);
      expect(e.atMs).toBeLessThanOrEqual(r.simEndMs);
      // A4: trades and vetoes carry the agent's voiced reasoning; nothing else may
      if (e.kind === "trade" || e.kind === "veto") expect(e.thesis!.length).toBeGreaterThan(0);
      else expect(e.thesis).toBeUndefined();
    }
    const child1 = gen1(r).find((q) => q.status === "alive")!;
    const birthEvents = r.events.filter((e) => e.kind === "birth");
    expect(birthEvents).toHaveLength(r.births);
    for (const e of birthEvents) {
      // the tape names exactly ONE parent — child1 — and no mate
      expect(e.detail.startsWith(`self-spawned by ${child1.id}`)).toBe(true);
    }
    const deathEvents = r.events.filter((e) => e.kind === "death");
    expect(deathEvents).toHaveLength(r.deaths);
    for (const e of deathEvents) expect(r.quants.find((q) => q.id === e.quantId)!.status).toBe("dead");
  });

  it("simulates exactly accel × minutes of species time", () => {
    expect(r.config).toEqual({ seed: 42, accel: 60, minutes: 20, mode: "paper" });
    expect(r.simEndMs - r.simStartMs).toBe(60 * 20 * 60_000); // 1,200 sim-minutes
  });

  it("§5.4: every quant publishes a self-model; the dead publish sealed graves; births carry letters", () => {
    for (const q of r.quants) {
      expect(q.selfModel, `no self-model on ${q.id}`).toBeTruthy();
      if (q.status === "dead") expect(q.selfModel).toContain("sealed self-model");
    }
    // the in-window child was born with its parent's letter pinned into its self-model
    for (const c of bornInWindow(r)) {
      expect(c.selfModel).toContain("letter");
    }
  });
});

describe("mode gate and burn model", () => {
  it("refuses non-paper mode — live capital stays behind the Phase 6 checklist", async () => {
    await expect(
      runEvolution({ seed: 42, accel: 60, minutes: 20, mode: "live" as unknown as "paper" }),
    ).rejects.toThrow(/Phase 6/);
  });

  it("burnForCadence: base VPS share + per-LLM-call cost, faster loops burn more", () => {
    expect(burnForCadence(20)).toBeCloseTo(0.3 + 0.005 * (1440 / 20), 12);
    expect(burnForCadence(10)).toBeGreaterThan(burnForCadence(60));
  });
});

describe("weekly holder-rewards distribution (B6 earmark model — needs > 7 sim-days)", () => {
  let long: EvolutionResult;

  beforeAll(async () => {
    // 12,000 sim-minutes = 8.33 days — crosses exactly one weekly boundary at minute 10,080
    long = await runEvolution({ seed: 42, accel: 60, minutes: 200, mode: "paper" });
  }, 180_000);

  it("distributes earmarked rewards on the weekly cadence and keeps every invariant", () => {
    assertInvariants(long);
    // the earmark was paid out: holder-reward flows exist and reward events hit the feed
    expect(long.flows.totals.holderRewards).toBeGreaterThan(0);
    const rewardEvents = long.events.filter((e) => e.kind === "reward");
    expect(rewardEvents.length).toBeGreaterThan(0);
    for (const e of rewardEvents) expect(e.detail).toContain("holder rewards");
    // every agent that distributed shows it on its public counter
    const paidIds = new Set(rewardEvents.map((e) => e.quantId));
    for (const id of paidIds) {
      expect(long.quants.find((q) => q.id === id)!.rewardPaidTotalUsd).toBeGreaterThan(0);
    }
    // the earmark is honest: owed never exceeds what the estate can actually pay
    for (const q of long.quants) {
      if (q.status !== "alive") continue;
      expect(q.rewardOwedUsd).toBeLessThanOrEqual(q.estateUsd + 1e-9);
    }
  });
});
