#!/usr/bin/env node
/**
 * assert-guardrails.mjs — M1 referee.
 * The arena's three system rules (venue whitelist, slippage cap, thin-liquidity rule) MUST be
 * frozen constants in packages/core, and MUST NOT appear inside any genome schema or mutation
 * code — if evolution could touch a system rule, the fairness story collapses. Every other
 * limit is a per-agent gene BY DESIGN (2026-08-02 amendment): position sizing, stop-losses,
 * exposure breadth, and daily-loss behavior live in the genome and evolve.
 *
 * Exit 0 = boundary intact. Non-zero = violation (loop must fix).
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
let problems = [];

// 1) constants file must exist and export a frozen GUARDRAILS object holding the three rules.
const constPath = "packages/core/src/constants.ts";
const constPathAlt = "packages/core/constants.ts";
const cpath = existsSync(constPath) ? constPath : (existsSync(constPathAlt) ? constPathAlt : null);
if (!cpath) {
  problems.push(`missing guardrails constants file (expected ${constPath})`);
} else {
  const src = readFileSync(cpath, "utf8");
  if (!/GUARDRAILS/.test(src)) problems.push(`${cpath}: no GUARDRAILS export found`);
  if (!/Object\.freeze|as const/.test(src)) problems.push(`${cpath}: GUARDRAILS must be frozen (Object.freeze or 'as const')`);
  // the three system rules must be named somewhere in the constants
  for (const needle of ["slippage", "whitelist", "spread"]) {
    if (!new RegExp(needle, "i").test(src)) problems.push(`${cpath}: system rule '${needle}' not defined`);
  }
}

// 2) system-rule keys must NOT appear inside the genome schema (edge/econ/voice genes).
const genomeCandidates = ["packages/core/src/genome.ts", "packages/core/genome.ts"];
const gpath = genomeCandidates.find(existsSync);
if (gpath) {
  const gsrc = readFileSync(gpath, "utf8");
  for (const banned of ["slippageCap", "venueWhitelist", "thinLiquidity"]) {
    if (new RegExp(banned, "i").test(gsrc)) {
      problems.push(`${gpath}: system rule '${banned}' must NOT be part of the genome (it would become mutable)`);
    }
  }
}

// 3) mutation code must not assign system-rule values anywhere.
try {
  const hits = execSync(
    `grep -rniE "GUARDRAILS\\.(slippage|whitelist|spread|thinLiquidity)\\s*=" packages apps 2>/dev/null || true`,
    { cwd: ROOT, encoding: "utf8" }
  ).trim();
  if (hits) problems.push(`system rules are being ASSIGNED (mutated) somewhere:\n${hits}`);
} catch {}

if (problems.length) {
  console.error("GUARDRAIL BOUNDARY VIOLATIONS:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("guardrail boundary intact ✓ (3 system rules frozen; per-agent limits are genes)");
process.exit(0);
