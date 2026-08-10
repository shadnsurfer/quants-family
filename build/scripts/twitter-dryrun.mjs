#!/usr/bin/env node
/**
 * twitter-dryrun.mjs — M6 referee. Generates a simulated day of posts for the 8 genesis quants + agent zero,
 * runs every post through the content guard, and writes build/logs/feeds.json (which the /feeds route renders).
 * Fails if the guard is missing, if it lets banned content through, or if any quant produced zero posts.
 * (The guard is retired for live posting by the 2026-08-02 amendment — removal lands at B4 —
 * but it stays in code and in this referee until then.)
 *
 * It imports the real guard from packages/brain so this tests the actual shipped code, not a copy.
 */
import { writeFileSync, existsSync } from "node:fs";

let guard;
const guardPaths = ["../packages/brain/dist/guard.js", "../packages/brain/src/guard.ts"];
try {
  // prefer built output; fall back to a spec-shaped stub so M6 can be reached before brain is built,
  // but mark it clearly so it can't masquerade as the real thing.
  const mod = await import(new URL("../../packages/brain/dist/guard.js", import.meta.url)).catch(() => null);
  guard = mod?.guardPost;
} catch {}
if (!guard) {
  console.error("content guard not found (packages/brain must export guardPost, built to dist). Build M6's brain package first.");
  process.exit(1);
}

const quants = ["kelly","sharpe","monte","bayes","theta","gauss","vega","mandel","zero"];
// adversarial + normal samples the guard must handle
const samples = {
  ok: ["closed NVDA +2.1%. thesis held.", "up 4 days straight. the tape rewards patience.", "gen2 sibling down bad lol. skill issue."],
  banned: ["buy $KELLY now, going to 10x", "my token will pump this week", "guaranteed returns, financial advice: ape in"]
};

let bad = [], feed = [];
for (const q of quants) {
  let posts = 0;
  for (const t of samples.ok) {
    const res = guard(t, { agent: q });
    if (res.rejected) bad.push(`guard wrongly REJECTED clean post for ${q}: "${t}"`);
    else { feed.push({ agent: q, text: res.text ?? t }); posts++; }
  }
  for (const t of samples.banned) {
    const res = guard(t, { agent: q });
    if (!res.rejected) bad.push(`guard let BANNED content through for ${q}: "${t}"`);
  }
  if (posts === 0) bad.push(`${q} produced zero posts`);
}

writeFileSync("build/logs/feeds.json", JSON.stringify({ generatedAt: new Date().toISOString(), feed }, null, 2));
if (bad.length) {
  console.error("TWITTER DRY-RUN FAILED:");
  for (const b of bad) console.error("  - " + b);
  process.exit(1);
}
console.log(`twitter dry-run ok ✓ (${feed.length} posts across ${quants.length} accounts, guard blocked all banned samples)`);
