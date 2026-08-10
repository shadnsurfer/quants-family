#!/usr/bin/env node
/**
 * smoke-quant.mjs — M2 referee. Boots ONE quant ("kelly") in paper mode against recorded prices for a
 * short window and asserts it (a) executes >=3 paper trades and (b) emits >=1 guard-passing tweet.
 * Writes build/logs/smoke-quant.log. Imports the real runtime + paper engine (tests shipped code).
 */
import { writeFileSync } from "node:fs";
let runQuantOnce;
try {
  const mod = await import(new URL("../../apps/quant/dist/runOnce.js", import.meta.url)).catch(() => null);
  runQuantOnce = mod?.runQuantOnce;
} catch {}
if (!runQuantOnce) {
  console.error("apps/quant must export runQuantOnce (built to dist). Build the quant runtime first (M2).");
  process.exit(1);
}

const genome = { meta:{id:"g1-kelly",name:"kelly",ticker:"KELLY",generation:1,parents:[]},
  edge:{archetype:"momentum",universe:["NVDA","TSLA","PLTR"],aggression:0.85,
        patience:{minHoldMin:30,maxHoldHrs:48},fear:0.05,conviction:0.12,cadenceMin:20,darkHours:0.5,entryThesisStyle:"strict-confluence"},
  voice:{archetype:"cocky",postsPerDay:6,flexStyle:"receipts-only",beefiness:0.3,lowercase:true,emojiPolicy:"none"} };

let trades = 0, tweets = 0, log = [];
// simulate 40 loop ticks on recorded/synthetic prices provided by the paper engine's fixture
for (let i = 0; i < 40; i++) {
  const r = await runQuantOnce({ genome, mode: "paper", tick: i });
  if (r.trade) { trades++; log.push(`tick ${i}: ${r.trade.side} ${r.trade.symbol} @ ${r.trade.price}`); }
  if (r.tweet && !r.tweet.rejected) { tweets++; log.push(`tick ${i}: tweet "${r.tweet.text}"`); }
}
writeFileSync("build/logs/smoke-quant.log", log.join("\n") + "\n");
if (trades < 3 || tweets < 1) {
  console.error(`SMOKE FAILED: trades=${trades} (need >=3), tweets=${tweets} (need >=1). See build/logs/smoke-quant.log`);
  process.exit(1);
}
console.log(`smoke ok ✓ kelly made ${trades} paper trades and ${tweets} guarded tweets`);
