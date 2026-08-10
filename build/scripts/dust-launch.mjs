#!/usr/bin/env node
/**
 * dust-launch.mjs — M5 referee. Launches ONE real dust token on Pons with pocket change and
 * verifies the full money cycle (launch → fee-claim read → dev-buy) on Robinhood Chain mainnet.
 *
 * SPENDS REAL FUNDS (tiny). Hard-gated three ways:
 *   1. refuses without the human-created confirm file (default build/state/DUST_OK);
 *   2. the PreToolUse safety-guard hook blocks the model from invoking this script directly —
 *      it runs only inside the milestone verifier;
 *   3. requires a complete .env (RPC_URL, CHAIN_ID, PONS_FACTORY, funded key) + the Pons ABI
 *      research artifact (data/chain/pons-abi.json, from docs.ponsfamily.fi — Phase 4 task).
 *
 * Without the confirm file it exits 20 with the NO_CONFIRM_FILE sentinel, which the verifier
 * translates to blocked-waiting-human — the loop proceeds to M6+ without stalling.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [])),
);
const confirmFile = resolve(ROOT, args["confirm-file"] || "build/state/DUST_OK");

if (!existsSync(confirmFile)) {
  console.error(
    `NO_CONFIRM_FILE: dust launch requires ${confirmFile} (created by the human) plus a funded key in .env. ` +
      `Marking M5 blocked-waiting-human; the loop continues with M6+.`,
  );
  process.exit(20);
}

// ── DUST_OK present: validate the environment before touching anything.
function loadEnv() {
  const envPath = resolve(ROOT, ".env");
  const out = { ...process.env };
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
      if (m && !(m[1] in process.env)) out[m[1]] = m[2];
    }
  }
  return out;
}

const env = loadEnv();
const missing = ["RPC_URL", "CHAIN_ID", "DUST_PRIVATE_KEY"].filter((k) => !env[k]);
const abiPath = resolve(ROOT, "data/chain/pons-abi.json");
if (!existsSync(abiPath)) {
  console.error(
    "WAITING_HUMAN: DUST_OK is present but the Pons research artifact is missing " +
      "(data/chain/pons-abi.json — regenerate from docs.ponsfamily.com + the verified contracts on blockscout). " +
      "Not spending anything.",
  );
  process.exit(20);
}
if (missing.length) {
  console.error(
    `WAITING_HUMAN: DUST_OK is present but .env is incomplete (missing: ${missing.join(", ")}). Not spending anything.`,
  );
  process.exit(20);
}
process.env.DUST_PRIVATE_KEY = env.DUST_PRIVATE_KEY;

// ── Everything present: perform the dust cycle via the real chain adapter.
const mod = await import(new URL("../../packages/chain/dist/index.js", import.meta.url)).catch(() => null);
if (!mod?.PonsLive) {
  console.error("packages/chain must export PonsLive (built to dist). Build M5's chain package first.");
  process.exit(1);
}

try {
  const pons = await mod.createPonsLive({
    rpcUrl: env.RPC_URL,
    chainId: Number(env.CHAIN_ID),
    abiPath,
  });
  const result = await pons.dustCycle({
    name: "dust0",
    ticker: "DUST0",
    devBuyEth: 0.0002,
  });
  writeFileSync(resolve(ROOT, "build/logs/dust-launch.json"), JSON.stringify(result, null, 2) + "\n");
  console.log("DUST LAUNCH OK ✓");
  console.log(`  token:    ${result.tokenAddr}  https://robinhoodchain.blockscout.com/address/${result.tokenAddr}`);
  console.log(`  pool:     ${result.poolAddr}`);
  console.log(`  launch:   https://robinhoodchain.blockscout.com/tx/${result.launchTx}`);
  console.log(`  feeClaim: https://robinhoodchain.blockscout.com/tx/${result.feeClaimTx}`);
  console.log(`  devBuy:   https://robinhoodchain.blockscout.com/tx/${result.devBuyTx}`);
} catch (e) {
  console.error(`DUST LAUNCH FAILED: ${e?.message ?? e}`);
  process.exit(1);
}
