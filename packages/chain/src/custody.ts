/**
 * Custody router (PROJECT.md §1.6, 2026-08-09 amendment). CUSTODY_MODE decides where quant
 * keys live and who can ever see them:
 *
 *   local   (default) — season-0 model: scrypt + AES-256-GCM keystore files on the host
 *                       (wallets.ts). Unchanged behavior.
 *   turnkey           — keys are created and sign inside Turnkey's Nitro Enclaves. Raw key
 *                       material never exists on this host and cannot be exported by anyone,
 *                       operator included. The daemon holds only org API credentials, which
 *                       authorize signing REQUESTS (further constrainable by Turnkey policies)
 *                       — never key export. This doubles as the disaster-recovery path: an
 *                       agent that goes dark never strands its funds, because signing
 *                       authority does not die with the process.
 *
 * Turnkey state on disk: data/keystore/turnkey-registry.json maps quant id →
 * { address, turnkeyPrivateKeyId }. IDs and addresses are identifiers, not secrets.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Account, Address } from "viem";
import { createAccountWithAddress } from "@turnkey/viem";
import { Turnkey as TurnkeyServerSDK, type TurnkeyApiClient } from "@turnkey/sdk-server";
import { birthWallet, ensureKeystoreSecret, listWallets, loadWallet } from "./wallets.js";

export type CustodyMode = "local" | "turnkey";

export function custodyMode(env: NodeJS.ProcessEnv = process.env): CustodyMode {
  const raw = (env.CUSTODY_MODE ?? "local").trim();
  if (raw === "local" || raw === "turnkey") return raw;
  throw new Error(`CUSTODY_MODE must be "local" or "turnkey", got "${raw}"`);
}

/* ── turnkey registry (identifiers only, no secrets) ─────────────────────── */

const REGISTRY_FILE = "turnkey-registry.json";

export interface TurnkeyRegistryEntry {
  address: Address;
  turnkeyPrivateKeyId: string;
}

export interface TurnkeyRegistry {
  version: 1;
  quants: Record<string, TurnkeyRegistryEntry>;
}

export function readTurnkeyRegistry(dir: string): TurnkeyRegistry {
  const path = join(dir, REGISTRY_FILE);
  if (!existsSync(path)) return { version: 1, quants: {} };
  return JSON.parse(readFileSync(path, "utf8")) as TurnkeyRegistry;
}

function writeTurnkeyRegistry(dir: string, registry: TurnkeyRegistry): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, REGISTRY_FILE), JSON.stringify(registry, null, 2) + "\n", { mode: 0o600 });
}

/* ── turnkey client ──────────────────────────────────────────────────────── */

const TURNKEY_ENV = ["TURNKEY_API_PUBLIC_KEY", "TURNKEY_API_PRIVATE_KEY", "TURNKEY_ORG_ID"] as const;

/** Fail fast with the exact missing vars before any network or key parsing happens. */
function assertTurnkeyEnv(env: NodeJS.ProcessEnv): void {
  const missing = TURNKEY_ENV.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`CUSTODY_MODE=turnkey needs ${missing.join(", ")} in env (see .env.example)`);
  }
}

let cached: { key: string; client: TurnkeyApiClient } | null = null;

export function turnkeyClient(env: NodeJS.ProcessEnv = process.env): TurnkeyApiClient {
  assertTurnkeyEnv(env);
  const key = `${env.TURNKEY_API_PUBLIC_KEY}:${env.TURNKEY_ORG_ID}`;
  if (cached?.key !== key) {
    cached = {
      key,
      client: new TurnkeyServerSDK({
        apiBaseUrl: env.TURNKEY_API_BASE_URL ?? "https://api.turnkey.com",
        apiPublicKey: env.TURNKEY_API_PUBLIC_KEY!,
        apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY!,
        defaultOrganizationId: env.TURNKEY_ORG_ID!,
      }).apiClient(),
    };
  }
  return cached.client;
}

/* ── the router ──────────────────────────────────────────────────────────── */

export interface CustodyOpts {
  keystoreDir: string;
  /** local custody only: explicit keystore secret; falls back to env/machine secret */
  passphrase?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the signing account for a quant under the active custody mode. Synchronous in both
 * modes: turnkey's createAccountWithAddress builds the viem account from the registry entry —
 * only signing itself (per transaction) is an async API call into the enclave.
 */
export function resolveCustodyAccount(quantId: string, opts: CustodyOpts): Account {
  const env = opts.env ?? process.env;
  if (custodyMode(env) === "local") {
    const secret = opts.passphrase ?? ensureKeystoreSecret(opts.keystoreDir, env.KEYSTORE_PASSPHRASE);
    return loadWallet(opts.keystoreDir, quantId, secret);
  }
  assertTurnkeyEnv(env);
  const entry = readTurnkeyRegistry(opts.keystoreDir).quants[quantId];
  if (!entry) {
    throw new Error(
      `custody: no turnkey key registered for "${quantId}" — provision it first (scripts/turnkey-provision.mjs)`,
    );
  }
  return createAccountWithAddress({
    client: turnkeyClient(env),
    organizationId: env.TURNKEY_ORG_ID!,
    signWith: entry.turnkeyPrivateKeyId,
    ethereumAddress: entry.address,
  });
}

/**
 * Birth a wallet for a newborn quant under the active custody mode. Idempotent per quant id:
 * an existing keystore file or registry entry returns its recorded address — a live key is
 * never regenerated out from under its funds. Awaitable: local is sync, turnkey is one API
 * round-trip (key creation inside the enclave).
 */
export async function birthCustodyWallet(quantId: string, opts: CustodyOpts): Promise<Address> {
  const env = opts.env ?? process.env;
  if (custodyMode(env) === "local") {
    const existing = listWallets(opts.keystoreDir).find((w) => w.id === quantId);
    if (existing) return existing.address;
    const secret = opts.passphrase ?? ensureKeystoreSecret(opts.keystoreDir, env.KEYSTORE_PASSPHRASE);
    return birthWallet(opts.keystoreDir, quantId, secret);
  }
  assertTurnkeyEnv(env);
  const registry = readTurnkeyRegistry(opts.keystoreDir);
  const existing = registry.quants[quantId];
  if (existing) return existing.address;
  const res = await turnkeyClient(env).createPrivateKeys({
    organizationId: env.TURNKEY_ORG_ID!,
    privateKeys: [
      {
        privateKeyName: `quants-${quantId}`,
        curve: "CURVE_SECP256K1",
        addressFormats: ["ADDRESS_FORMAT_ETHEREUM"],
        privateKeyTags: [],
      },
    ],
  });
  const created = res.privateKeys?.[0];
  const address = created?.addresses?.find((a) => a.format === "ADDRESS_FORMAT_ETHEREUM")?.address;
  if (!created?.privateKeyId || !address) {
    throw new Error(`custody: turnkey createPrivateKeys returned no ethereum key for "${quantId}"`);
  }
  registry.quants[quantId] = { address: address as Address, turnkeyPrivateKeyId: created.privateKeyId };
  writeTurnkeyRegistry(opts.keystoreDir, registry);
  return address as Address;
}
