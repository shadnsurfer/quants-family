#!/usr/bin/env node
/**
 * dress-rehearsal.mjs — M7 referee. One integrated pass of the whole show:
 *
 *   leg 1  BIRTH    — a parent births through the real chain adapter. With DUST_OK + env
 *                     present this is a REAL dust launch (PonsLive); otherwise it runs on
 *                     PonsMock from @quants/chain, explicitly labeled — never silently faked.
 *   leg 2  TRADING  — a fresh seeded evolution run: real quant runtime, paper engine,
 *                     births/deaths/flows (rewrites build/logs/evolution.json).
 *   leg 3  VOICES   — tweets composed + guarded in the run; feed files regenerated;
 *                     the guard-rejection log must be non-empty (the guard visibly working).
 *   leg 4  DASHBOARD— the live site reflects all three: /, /q/kelly, /feeds, /graveyard,
 *                     /docs all 200 with the expected content markers.
 *
 * Strict: any leg failing exits non-zero. Writes build/logs/dress-rehearsal.json.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.DASH_URL || "http://localhost:4321";
const failures = [];
const report = { legs: {}, atMs: Date.now() };

// season-0 guard: with a REAL world live, the rehearsal sim must not clobber the dashboard —
// its evolution run diverts to evolution.sim.json (still fully exercised and asserted).
const seasonLive = existsSync(resolve(ROOT, "build/state/season0-world.json")) && !process.argv.includes("--force");
const EVO_OUT = resolve(ROOT, seasonLive ? "build/logs/evolution.sim.json" : "build/logs/evolution.json");
if (seasonLive) console.error("season-0 REAL world detected — rehearsal evolution output diverted to evolution.sim.json");

// ── leg 1: birth through the chain adapter
try {
  const chain = await import(new URL("../../packages/chain/dist/index.js", import.meta.url));
  const dustOk = existsSync(resolve(ROOT, "build/state/DUST_OK"));
  if (dustOk) {
    // real dust path runs inside dust-launch.mjs (triple-gated); here we only verify its receipt
    const receiptPath = resolve(ROOT, "build/logs/dust-launch.json");
    if (!existsSync(receiptPath)) {
      failures.push("DUST_OK present but no dust-launch receipt — run the M5 verify first");
    } else {
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      report.legs.birth = { mode: "dust", tokenAddr: receipt.tokenAddr, launchTx: receipt.launchTx };
    }
  } else {
    const pons = new chain.PonsMock("dress-rehearsal");
    const launch = await pons.launch({ name: "rehearsal", ticker: "RHRSL" }, "0x000000000000000000000000000000000000dEaD", 0.0002);
    pons.accrueFees(launch.tokenAddr, 5, 0.002);
    const claim = await pons.claimFees(launch.tokenAddr);
    if (!launch.tokenAddr.startsWith("0x") || !claim.tx.startsWith("0x")) {
      failures.push("mock birth cycle produced malformed addresses/txs");
    }
    report.legs.birth = {
      mode: "mock (dust blocked-waiting-human — drop build/state/DUST_OK to make this real)",
      tokenAddr: launch.tokenAddr,
      launchTx: launch.tx,
      feeClaimTx: claim.tx,
    };
  }
} catch (e) {
  failures.push(`birth leg: ${e?.message ?? e}`);
}

// ── leg 2: full evolution run (real runtime, paper engine, flow ledger)
try {
  const system = await import(new URL("../../apps/system/dist/simEvolution.js", import.meta.url));
  const result = await system.runEvolution({ seed: 42, accel: 60, minutes: 20, mode: "paper" });
  writeFileSync(EVO_OUT, JSON.stringify(result, null, 2));
  const trades = result.events.filter((e) => e.kind === "trade").length;
  if (result.births < 1) failures.push(`trading leg: expected ≥1 birth, got ${result.births}`);
  if (result.deaths < 1) failures.push(`trading leg: expected ≥1 death, got ${result.deaths}`);
  if (trades < 10) failures.push(`trading leg: expected ≥10 paper trades across the species, got ${trades}`);
  report.legs.trading = { births: result.births, deaths: result.deaths, trades, quants: result.quants.length };
} catch (e) {
  failures.push(`trading leg: ${e?.message ?? e}`);
}

// ── leg 3: voices — guarded tweets in the run + regenerated feeds + visible rejections
try {
  execFileSync("node", ["build/scripts/twitter-dryrun.mjs"], { cwd: ROOT, stdio: "pipe" });
  execFileSync("node", ["build/scripts/compose-feeds.mjs"], { cwd: ROOT, stdio: "pipe" });
  const evo = JSON.parse(readFileSync(EVO_OUT, "utf8"));
  const tweetEvents = evo.events.filter((e) => e.kind === "tweet").length;
  const feeds = JSON.parse(readFileSync(resolve(ROOT, "build/logs/feeds-full.json"), "utf8"));
  if (tweetEvents < 5) failures.push(`voices leg: expected ≥5 guarded tweets in the sim, got ${tweetEvents}`);
  if ((feeds.rejections ?? []).length < 1) failures.push("voices leg: guard-rejection log is empty — the guard must be seen working");
  report.legs.voices = { simTweets: tweetEvents, feedPosts: feeds.posts.length, rejectionsLogged: feeds.rejections.length };
} catch (e) {
  failures.push(`voices leg: ${e?.message ?? e}`);
}

// ── leg 4: the dashboard reflects all three
async function probe(path, marker) {
  try {
    const r = await fetch(BASE + path, { signal: AbortSignal.timeout(8000) });
    const body = await r.text();
    if (r.status !== 200) return `${path} -> HTTP ${r.status}`;
    if (marker && !marker.test(body)) return `${path} missing expected content ${marker}`;
    return null;
  } catch (e) {
    return `${path} unreachable (${String(e).slice(0, 80)}) — is the site running?`;
  }
}
const probes = await Promise.all([
  probe("/", /most quants will die/i),
  probe("/q/kelly", /trait card|equity/i),
  probe("/feeds", /rejection log|dry-run/i),
  probe("/graveyard", /graveyard/i),
  probe("/docs", /commandments|fitness|what is quants/i),
]);
for (const p of probes) if (p) failures.push(`dashboard leg: ${p}`);
report.legs.dashboard = { probes: 5, failures: probes.filter(Boolean).length };

writeFileSync(resolve(ROOT, "build/logs/dress-rehearsal.json"), JSON.stringify(report, null, 2));

if (failures.length) {
  console.error("DRESS REHEARSAL FAILED:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(
  `dress rehearsal ok ✓  birth=${report.legs.birth.mode.split(" ")[0]} ` +
  `trades=${report.legs.trading.trades} births=${report.legs.trading.births} deaths=${report.legs.trading.deaths} ` +
  `tweets=${report.legs.voices.simTweets} rejectionsLogged=${report.legs.voices.rejectionsLogged} dashboard=5/5`,
);
