#!/usr/bin/env node
/**
 * sim-evolution.mjs — M3 driver. Runs a deterministic, time-accelerated evolution of agent zero
 * + its descendants in paper mode and writes build/logs/evolution.json (consumed by
 * assert-invariants.mjs). Flags: --accel <x> --minutes <m>. Seeded RNG => reproducible.
 * Imports the real orchestrator.
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const args = Object.fromEntries(process.argv.slice(2).flatMap((a,i,arr)=> a.startsWith("--") ? [[a.slice(2), arr[i+1]]] : []));
const accel = Number(args.accel || 60), minutes = Number(args.minutes || 20);

// season-0 guard: once a REAL world is live, the sim must not clobber the dashboard truth.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outFile = process.argv.includes("--force")
  ? "build/logs/evolution.json"
  : existsSync(resolve(ROOT, "build/state/season0-world.json"))
    ? "build/logs/evolution.sim.json"
    : "build/logs/evolution.json";
if (outFile !== "build/logs/evolution.json") {
  console.error("season-0 REAL world detected — sim output diverted to build/logs/evolution.sim.json (use --force to overwrite the live dashboard).");
}

let runEvolution;
try {
  const mod = await import(new URL("../../apps/system/dist/simEvolution.js", import.meta.url)).catch(() => null);
  runEvolution = mod?.runEvolution;
} catch {}
if (!runEvolution) {
  console.error("apps/system must export runEvolution (built to dist). Build the orchestrator first (M3).");
  process.exit(1);
}

// deterministic seed so the referee is reproducible
const result = await runEvolution({ seed: 42, accel, minutes, mode: "paper" });
writeFileSync(outFile, JSON.stringify(result, null, 2));

if ((result.births ?? 0) < 1 || (result.deaths ?? 0) < 1) {
  console.error(`EVOLUTION SIM: expected >=1 birth and >=1 death, got births=${result.births} deaths=${result.deaths}. ` +
                `Tune the seeded fixture so both selection paths fire.`);
  process.exit(1);
}
console.log(`evolution sim ok ✓ (births=${result.births}, deaths=${result.deaths}, live=${(result.quants||[]).filter(q=>q.status!=="dead").length})`);
