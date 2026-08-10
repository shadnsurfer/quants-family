#!/usr/bin/env node
/**
 * assert-invariants.mjs — the load-bearing referee (M3, M7).
 * Reads the simulation output (build/logs/evolution.json) and/or the live DB snapshot and asserts the
 * invariants that MUST always hold. These are deliberately strict — never weaken them to pass.
 * Re-expressed 2026-08-02 for the no-pool model (see build/state/NOTES.md):
 *
 *   I1  Flow conservation + per-agent reconciliation: the double-entry flow ledger sums to zero
 *       with no negative agent account, AND every quant's estate (cash + positions-at-cost +
 *       compute reserve + unclaimed fees) matches its ledger-view balance to the cent.
 *   I2  No zombies: no quant with status 'dead' has a running process / open position.
 *   I3  Tree consistency: every non-genesis quant references parents that exist; no cycles.
 *
 * Exit 0 = all hold. Non-zero = violation (loop must fix the code, not the check).
 */
import { readFileSync, existsSync } from "node:fs";

const EVO = "build/logs/evolution.json";
if (!existsSync(EVO)) {
  console.error(`no ${EVO} yet — run the evolution sim first (M3).`);
  process.exit(1);
}
const s = JSON.parse(readFileSync(EVO, "utf8"));
let bad = [];

// I1 — flow conservation + per-agent reconciliation (double-entry, to the cent)
if (s.flows) {
  const c = s.flows.conservation;
  if (!c) {
    bad.push("I1 flows: no conservation block in flows summary");
  } else {
    if (c.sumCents !== 0) bad.push(`I1 flows: double-entry balances sum to ${c.sumCents}c, expected 0`);
    if ((c.negativeAgents || []).length > 0) bad.push(`I1 flows: agent accounts negative: ${c.negativeAgents.join(", ")}`);
  }
  for (const q of s.quants || []) {
    if (q.estateUsd === undefined || q.ledgerBalanceUsd === undefined) {
      bad.push(`I1 flows: ${q.id} missing estate/ledger reconciliation fields`);
      continue;
    }
    const drift = Math.abs(q.estateUsd - q.ledgerBalanceUsd);
    if (drift > 0.01) {
      bad.push(`I1 reconciliation: ${q.id} estate ${q.estateUsd} vs ledger ${q.ledgerBalanceUsd} (drift ${drift})`);
    }
  }
} else {
  bad.push("I1 flows: no flows block in evolution.json (pre-B0 output — re-run the sim)");
}

// I2 — no zombies
for (const q of s.quants || []) {
  if (q.status === "dead") {
    if (q.processRunning) bad.push(`I2 zombie: ${q.id} is dead but process still running`);
    if ((q.openPositions ?? 0) > 0) bad.push(`I2 zombie: ${q.id} is dead but has ${q.openPositions} open positions`);
  }
}

// I3 — tree consistency
const ids = new Set((s.quants || []).map(q => q.id));
for (const q of s.quants || []) {
  if ((q.generation ?? 1) > 1 || (q.parents && q.parents.length)) {
    for (const p of q.parents || []) {
      if (!ids.has(p)) bad.push(`I3 tree: ${q.id} references missing parent ${p}`);
    }
  }
}
// simple cycle check
function hasCycle(startId) {
  const seen = new Set(); let cur = [startId];
  while (cur.length) {
    const nxt = [];
    for (const id of cur) {
      if (seen.has(id)) return true;
      seen.add(id);
      const q = (s.quants || []).find(x => x.id === id);
      for (const p of (q?.parents || [])) nxt.push(p);
    }
    cur = nxt;
    if (seen.size > (s.quants || []).length + 1) return true;
  }
  return false;
}
for (const q of s.quants || []) if (hasCycle(q.id)) { bad.push(`I3 tree: cycle detected at ${q.id}`); break; }

if (bad.length) {
  console.error("INVARIANT VIOLATIONS (do not weaken these — fix the code):");
  for (const b of bad) console.error("  - " + b);
  process.exit(1);
}
console.log(`invariants hold ✓  (quants: ${(s.quants||[]).length}, births: ${s.births ?? "?"}, deaths: ${s.deaths ?? "?"})`);
process.exit(0);
