#!/usr/bin/env node
/**
 * season0-daemon.mjs — keeps the real gen-0 season alive: one pass a minute over the
 * Season0Runtime (live-price paper ticks, hourly burn/fees/deaths/breeding, 4-hourly
 * claims), persisting the world + dashboard after every pass.
 *
 *   start   spawn the loop detached (logs → build/logs/season0.log, pid → build/state/season0.pid)
 *   run     the loop itself, foreground (what `start` spawns)
 *   stop    SIGTERM the running loop (it persists and exits cleanly)
 *   status  one-page season summary from the world file
 *
 * Kill switch: `touch build/state/SEASON0_STOP` — the loop persists and exits on its next pass.
 * Real spends: ONLY bred-child Pons launches + fee claims (dust key), both inside the
 * runtime's budget gate (reserve floor 0.005 ETH) and covered by build/state/DUST_OK.
 */
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { buildDeps, loadEnv } from "./season0-deps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORLD = resolve(ROOT, "build/state/season0-world.json");
const EVOLUTION = resolve(ROOT, "build/logs/evolution.json");
const PID_FILE = resolve(ROOT, "build/state/season0.pid");
const STOP_FILE = resolve(ROOT, "build/state/SEASON0_STOP");
const LOG_FILE = resolve(ROOT, "build/logs/season0.log");

const TICK_MS = 60_000;
const FEEDS_EVERY_MS = 10 * 60_000;
const MAX_CONSECUTIVE_FAILURES = 30;

const cmd = process.argv[2] ?? "status";

function alivePid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

if (cmd === "start") {
  if (!existsSync(WORLD)) {
    console.error("no season0 world — run build/scripts/season0-genesis.mjs first");
    process.exit(1);
  }
  const running = alivePid();
  if (running) {
    console.log(`already running (pid ${running})`);
    process.exit(0);
  }
  rmSync(STOP_FILE, { force: true });
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  const logFd = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run"], {
    cwd: ROOT, detached: true, stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid) + "\n");
  console.log(`season-0 daemon started (pid ${child.pid}) — log: build/logs/season0.log`);
  process.exit(0);
}

if (cmd === "stop") {
  const pid = alivePid();
  if (!pid) {
    console.log("not running");
    process.exit(0);
  }
  process.kill(pid, "SIGTERM");
  console.log(`sent SIGTERM to ${pid} — it persists and exits on its current pass`);
  process.exit(0);
}

if (cmd === "status") {
  if (!existsSync(WORLD)) {
    console.log("no season0 world yet — genesis has not run");
    process.exit(0);
  }
  const w = JSON.parse(readFileSync(WORLD, "utf8"));
  const alive = w.quants.filter((q) => q.status === "alive");
  const now = Date.now();
  console.log(`season 0 (real dust) — started ${new Date(w.startedAtMs).toISOString()}`);
  console.log(`daemon: ${alivePid() ? `running (pid ${alivePid()})` : "STOPPED"}   births ${w.births}  deaths ${w.deaths}  custody ${w.custody}`);
  if (w.birthsPaused) console.log(`BIRTHS PAUSED: ${w.birthsPaused}`);
  for (const q of w.quants) {
    const eq = w.equityById[q.id] ?? q.seedUsd;
    const age = ((now - q.bornAtMs) / 3_600_000).toFixed(1);
    console.log(`  ${q.status === "alive" ? "•" : "†"} ${q.name.padEnd(8)} gen${q.generation}  $${eq.toFixed(2).padStart(8)}  fees/h $${q.feeRatePerHourUsd.toFixed(4)}  age ${age}h${q.causeOfDeath ? `  (${q.causeOfDeath})` : ""}`);
  }
  console.log(`alive ${alive.length}/${w.quants.length} — dashboard: http://localhost:4321`);
  process.exit(0);
}

if (cmd !== "run") {
  console.error(`unknown command "${cmd}" — use start | run | stop | status`);
  process.exit(1);
}

// ── the loop (spawned by `start`)
const env = loadEnv(ROOT);
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (s) => console.log(`${stamp()} ${s}`);

if (!existsSync(resolve(ROOT, "build/state/DUST_OK"))) {
  console.error("DUST_OK missing — the season needs the dust gate for births/claims. Exiting.");
  process.exit(20);
}

const system = await import(new URL("../../apps/system/dist/index.js", import.meta.url));
const deps = await buildDeps({ ROOT, env, log });
const runtime = system.Season0Runtime.load(WORLD, deps);
if (runtime.state.prices) deps.prices.restore(runtime.state.prices);
deps._internals.setCustody(runtime.state.custody);
writeFileSync(PID_FILE, String(process.pid) + "\n");
log(`season-0 loop up: ${runtime.state.quants.length} quants, custody ${runtime.state.custody}, ETH/USD pending first sample`);

let stopping = false;
let failures = 0;
let lastFeedsMs = 0;

async function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  try {
    runtime.persist(WORLD, EVOLUTION, Date.now());
    log(`persisted on ${reason} — bye`);
  } catch (e) {
    log(`persist on ${reason} failed: ${e.message}`);
  }
  rmSync(PID_FILE, { force: true });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function pass() {
  if (existsSync(STOP_FILE)) {
    log("SEASON0_STOP present — halting");
    return shutdown("stop-file");
  }
  const nowMs = Date.now();
  try {
    await runtime.tick(nowMs);
    runtime.persist(WORLD, EVOLUTION, nowMs);
    failures = 0;
    if (nowMs - lastFeedsMs >= FEEDS_EVERY_MS) {
      lastFeedsMs = nowMs;
      const r = spawnSync(process.execPath, [resolve(ROOT, "build/scripts/compose-feeds.mjs")], { cwd: ROOT, stdio: "pipe" });
      if (r.status !== 0) log(`compose-feeds exit ${r.status} (non-fatal)`);
    }
  } catch (e) {
    failures += 1;
    log(`pass failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${e.message}`);
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      log("too many consecutive failures — exiting so launchd/the human notices");
      await shutdown("failure-cap");
    }
  }
}

await pass();
setInterval(() => void pass(), TICK_MS);
