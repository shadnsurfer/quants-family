#!/usr/bin/env node
/**
 * season0-genesis.mjs — GEN 0, lineage model (Charles directive 2026-07-24).
 *
 * One-shot: launches AGENT ZERO (eve) on Pons FOR REAL — one dust-sized launch
 * (0.0005 ETH fee + gas), eve's own keystore wallet as the immutable creator-fee
 * wallet — probes claim custody on-chain, retires any previous season world,
 * and writes the fresh single-root world the daemon then grows by self-reproduction.
 *
 * SPENDS REAL FUNDS (~0.0006 ETH). Gates, in order:
 *   1. build/state/DUST_OK must exist (human-created; covers dust-scale Pons spends);
 *   2. complete .env (RPC_URL, CHAIN_ID, DUST_PRIVATE_KEY) + the Pons ABI artifact;
 *   3. refuses to run twice: an existing build/state/season0-world.json requires --force —
 *      re-running RETIRES that world (archived, its tokens orphaned) and starts a new lineage.
 */
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildDeps, loadEnv } from "./season0-deps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORLD = resolve(ROOT, "build/state/season0-world.json");
const EVOLUTION = resolve(ROOT, "build/logs/evolution.json");
const force = process.argv.includes("--force");

// ── gate 1: the human dust confirm file
if (!existsSync(resolve(ROOT, "build/state/DUST_OK"))) {
  console.error("NO_CONFIRM_FILE: season-0 genesis spends real dust and requires build/state/DUST_OK.");
  process.exit(20);
}
// ── gate 3: never silently replace a living season
if (existsSync(WORLD) && !force) {
  console.error(`REFUSING: ${WORLD} already exists — a season is (or was) live. Re-running retires it
(tokens orphaned) and launches a NEW lineage. If that is truly intended: --force (stop the daemon first).`);
  process.exit(1);
}

const env = loadEnv(ROOT);
const log = (s) => console.log(`[genesis] ${s}`);

const system = await import(new URL("../../apps/system/dist/index.js", import.meta.url)).catch(() => null);
const core = await import(new URL("../../packages/core/dist/index.js", import.meta.url)).catch(() => null);
if (!system?.Season0Runtime || !core?.parseGenome) {
  console.error("build first: pnpm -r build (needs apps/system + packages/core dist)");
  process.exit(1);
}

const deps = await buildDeps({ ROOT, env, log });
const { chain, dust, ponsDust, setCustody } = deps._internals;

// ── preflight: budget + agent zero's keystore wallet
const balance = await dust.balanceEth();
const needEth = 0.0005 + 0.001; // one launch + gas margin (no dev-buy — airdrops are gone)
log(`dust wallet ${dust.address} balance ${balance.toFixed(4)} ETH (need ~${needEth.toFixed(4)} for genesis)`);
if (balance < needEth) {
  console.error(`INSUFFICIENT DUST: ${balance.toFixed(4)} ETH < ${needEth.toFixed(4)} needed. Top up ${dust.address}.`);
  process.exit(1);
}

const genome = core.parseGenome(JSON.parse(readFileSync(resolve(ROOT, "data/genesis/quants.json"), "utf8")));
const KEYSTORE_DIR = resolve(ROOT, "data/keystore");
// agent zero's wallet is born the same way every child's will be — the custody router
// (CUSTODY_MODE) decides local keystore vs Turnkey enclave; idempotent, address-only
const walletAddr = await chain.birthCustodyWallet(genome.meta.id, {
  keystoreDir: KEYSTORE_DIR,
  passphrase: env.KEYSTORE_PASSPHRASE,
  env,
});
log(`${genome.meta.id}'s custody wallet (${chain.custodyMode(env)}): ${walletAddr}`);

// ── retire the previous season, if any (its on-chain tokens are orphaned, like DUST0)
if (existsSync(WORLD)) {
  const stamp = new Date().toISOString().slice(0, 10);
  const grave = resolve(ROOT, `build/state/season0-world.retired-${stamp}.json`);
  renameSync(WORLD, grave);
  log(`previous season archived → ${grave} (its tokens remain on-chain, orphaned)`);
}

// ── LAUNCH agent zero (one real tx)
const nowMs = Date.now();
const runtime = await system.Season0Runtime.genesis({
  genome,
  walletAddr,
  seedUsd: 100,
  nowMs,
  seed: 4663,
  // agent zero's public X account is the species account (PROJECT.md §1.1)
  xHandle: "quantsdotfamily",
}, deps);

// ── custody probe on the agent-zero token: who may claim, and who gets paid?
const eve = runtime.state.quants[0];
log(`custody probe on ${eve.id} (${eve.tokenAddr}) …`);
let custody = "unknown";
try {
  const WETH = chain.RWA_INFRA.weth;
  const before = {
    qWeth: await deps._internals.erc20BalanceOf(deps._internals.publicClient, WETH, eve.walletAddr),
    qTok: await deps._internals.erc20BalanceOf(deps._internals.publicClient, eve.tokenAddr, eve.walletAddr),
  };
  let dustSeatOk = true;
  try {
    await ponsDust.readCreatorFees(eve.tokenAddr);
  } catch {
    dustSeatOk = false;
  }
  if (!dustSeatOk) {
    custody = "quant-key-claims";
    log("locker rejects a non-feeWallet caller → claims will be signed by each quant's own keystore");
  } else {
    const claim = await ponsDust.claimFees(eve.tokenAddr);
    const after = {
      qWeth: await deps._internals.erc20BalanceOf(deps._internals.publicClient, WETH, eve.walletAddr),
      qTok: await deps._internals.erc20BalanceOf(deps._internals.publicClient, eve.tokenAddr, eve.walletAddr),
    };
    if (after.qWeth > before.qWeth || after.qTok > before.qTok) {
      custody = "dust-key-claims";
      log(`probe claim ${claim.tx}: proceeds landed in ${eve.id}'s own wallet → dust key may crank claims for everyone`);
    } else {
      custody = "quant-key-claims";
      log(`probe claim ${claim.tx}: proceeds did NOT reach the fee wallet → claims must be quant-signed`);
    }
  }
} catch (e) {
  log(`custody probe inconclusive (${e.message}) — claims deferred until resolved`);
}
runtime.state.custody = custody;
setCustody(custody);

// ── prime the price tape so the first ticks have live quotes
await deps.prices.sample(genome.edge.universe, Date.now());
log(`price tape primed for ${genome.edge.universe.length} symbols @ ETH/USD $${deps.prices.ethUsd.toFixed(2)}`);

// ── replace the dashboard world, regenerate the feed surfaces
for (const f of ["build/logs/feeds-full.json", "build/logs/feeds.json"]) rmSync(resolve(ROOT, f), { force: true });
runtime.persist(WORLD, EVOLUTION, Date.now());
log("dashboard world replaced: build/logs/evolution.json is now the single-root lineage (real: true)");
for (const script of ["twitter-dryrun.mjs", "compose-feeds.mjs"]) {
  const r = spawnSync(process.execPath, [resolve(ROOT, "build/scripts", script)], { cwd: ROOT, stdio: "pipe" });
  log(`${script}: ${r.status === 0 ? "ok" : `exit ${r.status} (feeds refresh non-fatal)`}`);
}

console.log("\nGEN 0 IS LIVE — the lineage begins:");
console.log(`  ${eve.name}  $${eve.ticker}  ${eve.tokenAddr}  https://robinhoodchain.blockscout.com/address/${eve.tokenAddr}`);
console.log(`  wallet ${eve.walletAddr}   custody: ${custody}   dust left: ${(await dust.balanceEth()).toFixed(4)} ETH`);
console.log("  first possible spawn: +72h, if eve grows to 1.3× seed with drawdown < 40%");
console.log("  next: node build/scripts/season0-daemon.mjs start");
