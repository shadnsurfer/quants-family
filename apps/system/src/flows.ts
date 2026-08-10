/**
 * Species flow ledger (PROJECT.md §4.6, 2026-08-02 model) — every non-market money movement,
 * double-entry, in integer cents. There is no central pot: each entry moves exact cents from one
 * account to another. Agent accounts are quant ids; external accounts are "$"-prefixed:
 *
 *   $operator            the human operator (genesis bootstrap source; sweep fallback)
 *   $protocol            Pons (creator-fee claims originate here)
 *   $market              trading counterparties (realized P&L flows through here)
 *   $holders             token holders receiving reward distributions
 *   $sink                value leaving the species (launch fees, compute burn, buyback-burns)
 *   $operator-treasury   sweep fallback when no living champion exists (disclosed)
 *
 * Conservation is structural: balances across ALL accounts sum to zero, always — and each
 * agent's ledger-view balance reconciles with its estate (cash + compute reserve + unclaimed
 * fees) to the cent, which is what assert-invariants re-derives. Never weakened, re-expressed.
 */

export type FlowType =
  | "bootstrap" // $operator → agent (genesis seed — the only operator-funded flow)
  | "market-pnl" // $market ↔ agent (realized trading P&L, either direction)
  | "birth-funding" // parent → child (the funding cascade endowment)
  | "launch-fee" // child → $sink (Pons launch fee)
  | "fee-claim" // $protocol → agent (creator fees claimed from the agent's token)
  | "holder-reward" // agent → $holders (r% reward distributions)
  | "buyback-burn" // agent → $sink (discretion: buy back own token and burn)
  | "compute-burn" // agent → $sink (VPS/LLM burn)
  | "champion-sweep"; // dead agent → champion (or → $operator-treasury when none survive)

export interface FlowEntry {
  type: FlowType;
  /** always positive; direction comes from fromId → toId */
  amountCents: number;
  fromId: string;
  toId: string;
  atMs: number;
  note?: string;
}

const isExternal = (id: string): boolean => id.startsWith("$");

export class FlowLedger {
  readonly entries: FlowEntry[] = [];
  private readonly balances = new Map<string, number>();

  record(type: FlowType, amountCents: number, meta: { fromId: string; toId: string; atMs: number; note?: string }): void {
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new RangeError(`flow amounts are non-negative integer cents, got ${amountCents} for ${type}`);
    }
    if (meta.fromId === meta.toId) {
      throw new RangeError(`flow ${type}: fromId and toId are both ${meta.fromId}`);
    }
    const fromBal = (this.balances.get(meta.fromId) ?? 0) - amountCents;
    if (!isExternal(meta.fromId) && fromBal < 0) {
      throw new RangeError(
        `flow ${type}: ${meta.fromId} insolvent — ${amountCents}c exceeds its ledger balance ${fromBal + amountCents}c`,
      );
    }
    this.balances.set(meta.fromId, fromBal);
    this.balances.set(meta.toId, (this.balances.get(meta.toId) ?? 0) + amountCents);
    this.entries.push({ type, amountCents, ...meta });
  }

  /** Rebuild by replaying persisted entries — conservation is re-enforced structurally. */
  static replay(entries: readonly FlowEntry[]): FlowLedger {
    const ledger = new FlowLedger();
    for (const e of entries) {
      ledger.record(e.type, e.amountCents, {
        fromId: e.fromId,
        toId: e.toId,
        atMs: e.atMs,
        ...(e.note !== undefined ? { note: e.note } : {}),
      });
    }
    return ledger;
  }

  /** Ledger-view balance of one account in cents (inflows − outflows). */
  balanceOf(id: string): number {
    return this.balances.get(id) ?? 0;
  }

  totalCents(type: FlowType): number {
    let sum = 0;
    for (const e of this.entries) if (e.type === type) sum += e.amountCents;
    return sum;
  }

  /**
   * Double-entry conservation: every account's balances sum to exactly zero, and no agent
   * account is negative. External accounts may carry any balance (they are the world).
   */
  conservationCheck(): { ok: boolean; sumCents: number; negativeAgents: string[] } {
    let sum = 0;
    const negativeAgents: string[] = [];
    for (const [id, bal] of this.balances) {
      sum += bal;
      if (!isExternal(id) && bal < 0) negativeAgents.push(id);
    }
    return { ok: sum === 0 && negativeAgents.length === 0, sumCents: sum, negativeAgents };
  }

  /** The shape assert-invariants.mjs §I1 reconciles + the site renders (USD floats at the edge). */
  toJSON(): {
    entryCount: number;
    totals: Record<"bootstrap" | "marketPnl" | "birthFunding" | "launchFees" | "feeClaims" | "holderRewards" | "buybackBurns" | "computeBurns" | "championSweeps", number>;
    external: Record<"operator" | "protocol" | "market" | "holders" | "sink" | "operatorTreasury", number>;
    conservation: { ok: boolean; sumCents: number; negativeAgents: string[] };
  } {
    return {
      entryCount: this.entries.length,
      totals: {
        bootstrap: this.totalCents("bootstrap") / 100,
        marketPnl: this.totalCents("market-pnl") / 100,
        birthFunding: this.totalCents("birth-funding") / 100,
        launchFees: this.totalCents("launch-fee") / 100,
        feeClaims: this.totalCents("fee-claim") / 100,
        holderRewards: this.totalCents("holder-reward") / 100,
        buybackBurns: this.totalCents("buyback-burn") / 100,
        computeBurns: this.totalCents("compute-burn") / 100,
        championSweeps: this.totalCents("champion-sweep") / 100,
      },
      external: {
        operator: this.balanceOf("$operator") / 100,
        protocol: this.balanceOf("$protocol") / 100,
        market: this.balanceOf("$market") / 100,
        holders: this.balanceOf("$holders") / 100,
        sink: this.balanceOf("$sink") / 100,
        operatorTreasury: this.balanceOf("$operator-treasury") / 100,
      },
      conservation: this.conservationCheck(),
    };
  }
}
