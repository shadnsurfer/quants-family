#!/usr/bin/env node
/**
 * turnkey-provision.mjs — create per-quant enclave keys in the operator's Turnkey org
 * (CUSTODY_MODE=turnkey path; PROJECT.md §1.6, 2026-08-09 amendment).
 *
 * For each quant id: creates a secp256k1 key INSIDE Turnkey's Nitro Enclave — raw key
 * material never leaves Turnkey, is never returned by the API, and cannot be exported by
 * anyone, operator included — then records { address, turnkeyPrivateKeyId } in
 * data/keystore/turnkey-registry.json (identifiers only, no secrets). Idempotent:
 * already-registered ids keep their address and skip.
 *
 * Usage:  node scripts/turnkey-provision.mjs <quant-id> [more-ids...]
 *         node scripts/turnkey-provision.mjs --list
 * Requires (env or .env): TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY, TURNKEY_ORG_ID.
 * Secrets live in .env, never on the command line.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../build/scripts/season0-deps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEYSTORE_DIR = resolve(ROOT, "data/keystore");

const chain = await import(new URL("../packages/chain/dist/index.js", import.meta.url)).catch(() => null);
if (!chain?.birthCustodyWallet) {
  console.error("build packages/chain first (pnpm typecheck emits dist).");
  process.exit(1);
}

// provisioning is ALWAYS the turnkey path, whatever the runtime .env mode is
const env = { ...loadEnv(ROOT), CUSTODY_MODE: "turnkey" };

const args = process.argv.slice(2);
if (args.includes("--list")) {
  const registry = chain.readTurnkeyRegistry(KEYSTORE_DIR);
  const rows = Object.entries(registry.quants);
  if (!rows.length) console.log("registry empty — no turnkey keys provisioned yet");
  for (const [id, entry] of rows) console.log(`${id}: ${entry.address} (key ${entry.turnkeyPrivateKeyId})`);
  process.exit(0);
}

const ids = args.filter((a) => !a.startsWith("--"));
if (!ids.length) {
  console.error("usage: node scripts/turnkey-provision.mjs <quant-id> [more-ids...] | --list");
  process.exit(1);
}

for (const id of ids) {
  const address = await chain.birthCustodyWallet(id, { keystoreDir: KEYSTORE_DIR, env });
  console.log(`${id}: ${address}`);
}
console.log(`\nregistry: ${KEYSTORE_DIR}/turnkey-registry.json (identifiers only, no secrets)`);
console.log("next: scope the org's Turnkey policies (which keys these API credentials may sign with), then CUSTODY_MODE=turnkey in .env");
