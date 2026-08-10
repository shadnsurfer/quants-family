/**
 * FlowLedger (PROJECT.md §4.6, 2026-08-02 model): every non-market money movement is a
 * double-entry transfer in integer cents between two accounts. Agent accounts are quant ids
 * (solvency-gated); "$"-prefixed external accounts are the world and may carry any balance.
 * Conservation is structural: balances across ALL accounts sum to zero, always.
 *
 * These tests mirror the I1 referee in build/scripts/assert-invariants.mjs — the toJSON
 * block must expose the totals, external balances and conservation block it reconciles.
 */
import { describe, expect, it } from "vitest";
import { FlowLedger, type FlowEntry, type FlowType } from "../src/index.js";

const AT = 1_767_605_400_000;

/** A scripted mixed sequence over every flow type, all legal under the solvency gate. */
function runMixed(): FlowLedger {
  const ledger = new FlowLedger();
  let at = AT;
  const rec = (type: FlowType, amountCents: number, fromId: string, toId: string) =>
    ledger.record(type, amountCents, { fromId, toId, atMs: at++ });

  rec("bootstrap", 150_000, "$operator", "g0-eve"); // genesis seed
  rec("market-pnl", 46_500, "$market", "g0-eve"); // resumed history, in
  rec("market-pnl", 2_100, "g0-eve", "$market"); // realized loss, out
  rec("fee-claim", 320, "$protocol", "g0-eve");
  rec("holder-reward", 64, "g0-eve", "$holders");
  rec("compute-burn", 75, "g0-eve", "$sink");
  rec("buyback-burn", 100, "g0-eve", "$sink");
  rec("birth-funding", 39_300, "g0-eve", "g1-ito");
  rec("launch-fee", 150, "g1-ito", "$sink");
  rec("bootstrap", 10_000, "$operator", "g1-doob");
  rec("champion-sweep", 3_500, "g1-doob", "g0-eve"); // the dead feed the champion
  return ledger;
}

describe("record() validation", () => {
  it("rejects negative amounts and leaves state untouched", () => {
    const ledger = new FlowLedger();
    ledger.record("bootstrap", 1_000, { fromId: "$operator", toId: "g1-a", atMs: 0 });
    expect(() => ledger.record("compute-burn", -1, { fromId: "g1-a", toId: "$sink", atMs: 1 })).toThrow(RangeError);
    expect(() => ledger.record("compute-burn", -1, { fromId: "g1-a", toId: "$sink", atMs: 1 })).toThrow(
      /non-negative integer cents/,
    );
    expect(ledger.balanceOf("g1-a")).toBe(1_000);
    expect(ledger.balanceOf("$sink")).toBe(0);
    expect(ledger.entries).toHaveLength(1);
  });

  it("rejects non-integer amounts (fractional cents cannot exist)", () => {
    const ledger = new FlowLedger();
    expect(() => ledger.record("fee-claim", 10.5, { fromId: "$protocol", toId: "g1-a", atMs: 0 })).toThrow(RangeError);
    // classic float residue (0.1 + 0.2 in dollars → 30.000000000000004 cents)
    expect(() =>
      ledger.record("fee-claim", (0.1 + 0.2) * 100, { fromId: "$protocol", toId: "g1-a", atMs: 0 }),
    ).toThrow(RangeError);
    expect(ledger.entries).toHaveLength(0);
  });

  it("rejects self-transfers even when the amount is zero", () => {
    const ledger = new FlowLedger();
    expect(() => ledger.record("market-pnl", 0, { fromId: "g1-a", toId: "g1-a", atMs: 0 })).toThrow(
      /fromId and toId are both g1-a/,
    );
    expect(() => ledger.record("compute-burn", 50, { fromId: "$sink", toId: "$sink", atMs: 0 })).toThrow(RangeError);
    expect(ledger.entries).toHaveLength(0);
  });

  it("allows zero-amount entries: recorded, but no balance moves", () => {
    const ledger = new FlowLedger();
    ledger.record("market-pnl", 0, { fromId: "$market", toId: "g1-a", atMs: 0 });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.balanceOf("g1-a")).toBe(0);
    expect(ledger.balanceOf("$market")).toBe(0);
    expect(ledger.conservationCheck().ok).toBe(true);
  });
});

describe("double-entry movement", () => {
  it("debits fromId and credits toId by the exact amount", () => {
    const ledger = new FlowLedger();
    ledger.record("bootstrap", 150_000, { fromId: "$operator", toId: "g0-eve", atMs: AT });
    expect(ledger.balanceOf("g0-eve")).toBe(150_000);
    expect(ledger.balanceOf("$operator")).toBe(-150_000); // external: the world owes the species

    ledger.record("birth-funding", 30_000, { fromId: "g0-eve", toId: "g1-ito", atMs: AT + 1 });
    expect(ledger.balanceOf("g0-eve")).toBe(120_000);
    expect(ledger.balanceOf("g1-ito")).toBe(30_000);
  });

  it("preserves every entry in order with its metadata (incl. optional note)", () => {
    const ledger = runMixed();
    expect(ledger.entries).toHaveLength(11);
    expect(ledger.entries[0]).toEqual({
      type: "bootstrap", amountCents: 150_000, fromId: "$operator", toId: "g0-eve", atMs: AT,
    });
    const withNote = new FlowLedger();
    withNote.record("bootstrap", 20_150, { fromId: "$operator", toId: "g1-a", atMs: 0 });
    withNote.record("launch-fee", 150, { fromId: "g1-a", toId: "$sink", atMs: 1, note: "pons launch" });
    expect(withNote.entries[1]!.note).toBe("pons launch");
  });

  it("tracks balances exactly through the mixed sequence", () => {
    const ledger = runMixed();
    // eve: +150000 +46500 −2100 +320 −64 −75 −100 −39300 +3500
    expect(ledger.balanceOf("g0-eve")).toBe(158_681);
    expect(ledger.balanceOf("g1-ito")).toBe(39_300 - 150);
    expect(ledger.balanceOf("g1-doob")).toBe(10_000 - 3_500);
    expect(ledger.balanceOf("$operator")).toBe(-160_000);
    expect(ledger.balanceOf("$market")).toBe(-46_500 + 2_100);
    expect(ledger.balanceOf("$protocol")).toBe(-320);
    expect(ledger.balanceOf("$holders")).toBe(64);
    expect(ledger.balanceOf("$sink")).toBe(75 + 100 + 150);
    expect(ledger.conservationCheck().ok).toBe(true);
  });

  it("totalCents sums per type only", () => {
    const ledger = runMixed();
    expect(ledger.totalCents("bootstrap")).toBe(160_000);
    expect(ledger.totalCents("market-pnl")).toBe(48_600);
    expect(ledger.totalCents("fee-claim")).toBe(320);
    expect(ledger.totalCents("holder-reward")).toBe(64);
    expect(ledger.totalCents("compute-burn")).toBe(75);
    expect(ledger.totalCents("buyback-burn")).toBe(100);
    expect(ledger.totalCents("birth-funding")).toBe(39_300);
    expect(ledger.totalCents("launch-fee")).toBe(150);
    expect(ledger.totalCents("champion-sweep")).toBe(3_500);
  });
});

describe("insolvency protection", () => {
  it("throws RangeError when an internal (agent) account would go negative", () => {
    const ledger = new FlowLedger();
    ledger.record("bootstrap", 449, { fromId: "$operator", toId: "g1-a", atMs: 0 });
    expect(() => ledger.record("compute-burn", 450, { fromId: "g1-a", toId: "$sink", atMs: 1 })).toThrow(RangeError);
    expect(() => ledger.record("compute-burn", 450, { fromId: "g1-a", toId: "$sink", atMs: 1 })).toThrow(/insolvent/);
  });

  it("a rejected outflow leaves balances and entries exactly as they were", () => {
    const ledger = new FlowLedger();
    ledger.record("bootstrap", 459, { fromId: "$operator", toId: "g1-a", atMs: 0 });
    ledger.record("compute-burn", 10, { fromId: "g1-a", toId: "$sink", atMs: 1 });
    expect(() => ledger.record("champion-sweep", 1_000, { fromId: "g1-a", toId: "g1-b", atMs: 2 })).toThrow(RangeError);
    expect(ledger.balanceOf("g1-a")).toBe(449);
    expect(ledger.balanceOf("g1-b")).toBe(0);
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.conservationCheck().ok).toBe(true);
  });

  it("an outflow exactly equal to the balance is legal and drains the agent to zero", () => {
    const ledger = new FlowLedger();
    ledger.record("bootstrap", 500, { fromId: "$operator", toId: "g1-a", atMs: 0 });
    ledger.record("champion-sweep", 500, { fromId: "g1-a", toId: "g1-b", atMs: 1 });
    expect(ledger.balanceOf("g1-a")).toBe(0);
    expect(ledger.conservationCheck().ok).toBe(true);
  });

  it("an agent with no history rejects any outflow but accepts inflows", () => {
    const ledger = new FlowLedger();
    expect(() => ledger.record("holder-reward", 1, { fromId: "g1-a", toId: "$holders", atMs: 0 })).toThrow(/insolvent/);
    ledger.record("fee-claim", 500, { fromId: "$protocol", toId: "g1-a", atMs: 1 });
    expect(ledger.balanceOf("g1-a")).toBe(500);
  });

  it("every external account may go negative freely — the solvency gate is for agents only", () => {
    const externals = ["$operator", "$protocol", "$market", "$holders", "$sink", "$operator-treasury"] as const;
    for (const ext of externals) {
      const ledger = new FlowLedger();
      ledger.record("bootstrap", 999_999, { fromId: ext, toId: "g1-a", atMs: 0 });
      expect(ledger.balanceOf(ext)).toBe(-999_999);
      expect(ledger.conservationCheck().ok).toBe(true); // externals are the world, not agents
    }
  });
});

describe("replay", () => {
  it("rebuilds balances, totals and entries exactly from persisted entries", () => {
    const original = runMixed();
    const replayed = FlowLedger.replay(original.entries);
    expect(replayed.entries).toEqual(original.entries);
    for (const id of ["g0-eve", "g1-ito", "g1-doob", "$operator", "$market", "$protocol", "$holders", "$sink"]) {
      expect(replayed.balanceOf(id)).toBe(original.balanceOf(id));
    }
    for (const type of ["bootstrap", "market-pnl", "fee-claim", "holder-reward", "compute-burn",
      "buyback-burn", "birth-funding", "launch-fee", "champion-sweep"] as const) {
      expect(replayed.totalCents(type)).toBe(original.totalCents(type));
    }
    expect(replayed.conservationCheck()).toEqual(original.conservationCheck());
  });

  it("re-enforces the solvency gate on replay — a corrupt history refuses to load", () => {
    const corrupt: FlowEntry[] = [
      { type: "bootstrap", amountCents: 100, fromId: "$operator", toId: "g1-a", atMs: 0 },
      { type: "compute-burn", amountCents: 101, fromId: "g1-a", toId: "$sink", atMs: 1 }, // insolvent
    ];
    expect(() => FlowLedger.replay(corrupt)).toThrow(/insolvent/);
  });
});

describe("conservationCheck", () => {
  it("holds on a fresh ledger", () => {
    expect(new FlowLedger().conservationCheck()).toEqual({ ok: true, sumCents: 0, negativeAgents: [] });
  });

  it("holds after any legal mixed sequence: every account sums to exactly zero", () => {
    const check = runMixed().conservationCheck();
    expect(check.ok).toBe(true);
    expect(check.sumCents).toBe(0);
    expect(check.negativeAgents).toEqual([]);
  });

  it("detects a negative agent account (the referee's insolvency tripwire)", () => {
    const ledger = runMixed();
    // unreachable through record() — the gate throws first — so corrupt the book directly
    // to prove the CHECK itself still reports the violation (defense in depth).
    (ledger as unknown as { balances: Map<string, number> }).balances.set("g1-rogue", -1);
    const check = ledger.conservationCheck();
    expect(check.ok).toBe(false);
    expect(check.negativeAgents).toEqual(["g1-rogue"]);
    expect(check.sumCents).toBe(-1);
  });
});

describe("toJSON — the I1 referee surface", () => {
  it("exposes entryCount, USD totals per flow type, USD external balances and conservation", () => {
    const json = runMixed().toJSON();
    expect(json.entryCount).toBe(11);
    expect(json.totals).toEqual({
      bootstrap: 1_600,
      marketPnl: 486,
      birthFunding: 393,
      launchFees: 1.5,
      feeClaims: 3.2,
      holderRewards: 0.64,
      buybackBurns: 1,
      computeBurns: 0.75,
      championSweeps: 35,
    });
    expect(json.external).toEqual({
      operator: -1_600,
      protocol: -3.2,
      market: -444,
      holders: 0.64,
      sink: 3.25,
      operatorTreasury: 0,
    });
    expect(json.conservation).toEqual({ ok: true, sumCents: 0, negativeAgents: [] });
    // exact key set: any drift in this surface must be a conscious decision
    expect(Object.keys(json).sort()).toEqual(["conservation", "entryCount", "external", "totals"]);
    expect(Object.keys(json.totals).sort()).toEqual([
      "birthFunding", "bootstrap", "buybackBurns", "championSweeps", "computeBurns",
      "feeClaims", "holderRewards", "launchFees", "marketPnl",
    ]);
    expect(Object.keys(json.external).sort()).toEqual([
      "holders", "market", "operator", "operatorTreasury", "protocol", "sink",
    ]);
  });

  it("genesis bootstrap: the operator is down exactly what the species received", () => {
    const ledger = new FlowLedger();
    for (const id of ["g0-eve", "g1-sigma", "g1-doob"]) {
      ledger.record("bootstrap", 150_000, { fromId: "$operator", toId: id, atMs: AT, note: "resume bootstrap" });
    }
    const json = ledger.toJSON();
    expect(json.totals.bootstrap).toBe(4_500);
    expect(json.external.operator).toBe(-4_500);
    expect(json.conservation.ok).toBe(true);
  });
});
