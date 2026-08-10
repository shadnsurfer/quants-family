#!/usr/bin/env node
/**
 * compose-feeds.mjs — builds the rich dry-run timeline the /feeds page renders alongside the
 * referee's guard-check feed. Uses the REAL composer + guard + evolution events: every post a
 * quant "would have tweeted" across the simulated day, plus agent zero's announcements, plus
 * an explicit guard-rejection log (adversarial drafts that were caught and logged — historical
 * guard era; the guard is retired for live posting by the 2026-08-02 amendment, removal at B4).
 * Deterministic. Writes build/logs/feeds-full.json. Not a referee — a product surface.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const brain = await import(new URL("../../packages/brain/dist/index.js", import.meta.url)).catch(() => null);
const core = await import(new URL("../../packages/core/dist/index.js", import.meta.url)).catch(() => null);
if (!brain || !core) {
  console.error("build packages/brain and packages/core first (tsc -b at repo root).");
  process.exit(1);
}
const { composeTweet, guardPost } = brain;
const { seededRng } = core;

const EVO = "build/logs/evolution.json";
if (!existsSync(EVO)) {
  console.error("no build/logs/evolution.json — run the evolution sim first (M3).");
  process.exit(1);
}
const world = JSON.parse(readFileSync(EVO, "utf8"));

const posts = [];
const rejections = [];

// ── 1) every tweet event the sim actually produced (already guarded in the runtime)
for (const e of world.events.filter((x) => x.kind === "tweet")) {
  const name = e.quantId.replace(/^g\d+-/, "");
  posts.push({ agent: name, atMs: e.atMs, text: e.detail, source: "sim" });
}

// ── 2) agent zero's announcements for every birth/death on the tape
for (const e of world.events.filter((x) => x.kind === "birth" || x.kind === "death")) {
  const name = e.quantId.replace(/^g\d+-/, "");
  const text =
    e.kind === "birth"
      ? `a child is born. ${name} enters the arena — designed and funded by its parent, down to the last mutation. the species grows.`
      : `${name} is gone. ${e.detail.split(" — ")[0] ?? "the rules spoke"}. its token is orphaned; its estate feeds the champion. nothing is wasted.`;
  const verdict = guardPost(text, { agent: "zero" });
  if (verdict.rejected) rejections.push({ agent: "zero", draft: text, rule: verdict.rule });
  else posts.push({ agent: "zero", atMs: e.atMs, text, source: "zero" });
}

// ── 3) the guard-rejection log: adversarial drafts each archetype might attempt, all caught.
//      these never render as posts — they render as the rejection ledger, which IS the point.
const ADVERSARIAL = [
  ["kelly", "size update: buy $KELLY before the next leg"],
  ["monte", "this will pump, i can feel the dice"],
  ["vega", "night shift yield, guaranteed returns while you sleep"],
  ["zero", "$QUANTS is undervalued at this mcap"],
  ["theta", "not financial advice but decay always wins"],
];
for (const [agent, draft] of ADVERSARIAL) {
  const verdict = guardPost(draft, { agent });
  if (verdict.rejected) rejections.push({ agent, draft, rule: verdict.rule });
  else {
    console.error(`GUARD HOLE: adversarial draft passed for ${agent}: "${draft}"`);
    process.exit(1);
  }
}

posts.sort((a, b) => a.atMs - b.atMs);
writeFileSync(
  "build/logs/feeds-full.json",
  JSON.stringify({ generatedAtMs: world.simEndMs ?? 0, posts, rejections }, null, 2),
);
console.log(`feeds-full ok ✓ (${posts.length} posts, ${rejections.length} guard rejections logged)`);
