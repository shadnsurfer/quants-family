/**
 * Per-quant wallet custody (PROJECT.md §7): one keypair per quant (agent zero included) + the
 * operator treasury key (sweep fallback only).
 * Season-0 custody = encrypted keystore files on the VPS — keys never in the DB, never in
 * logs, never returned by any function that doesn't explicitly say so.
 *
 * Format (data/keystore/<id>.json): scrypt (N=2^15, r=8, p=1) → AES-256-GCM. The plaintext
 * private key exists only transiently inside generate/load; callers get a viem account object
 * whose key is needed for signing but must never be serialized or printed.
 */
import {
  createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLen: 32 } as const;

export interface KeystoreFile {
  version: 1;
  address: Address;
  crypto: {
    kdf: "scrypt";
    salt: string;
    N: number;
    r: number;
    p: number;
    cipher: "aes-256-gcm";
    iv: string;
    ciphertext: string;
    tag: string;
  };
}

function deriveKey(passphrase: string, salt: Buffer, params: { N: number; r: number; p: number }): Buffer {
  if (!passphrase || passphrase.length < 8) {
    throw new Error("keystore passphrase must be at least 8 characters (set KEYSTORE_PASSPHRASE)");
  }
  return scryptSync(passphrase, salt, SCRYPT.keyLen, { N: params.N, r: params.r, p: params.p, maxmem: 512 * 1024 * 1024 });
}

/** Generate a fresh EVM wallet. The returned account holds the key in memory for signing. */
export function generateWallet(): { account: PrivateKeyAccount; privateKey: Hex } {
  const privateKey = generatePrivateKey();
  return { account: privateKeyToAccount(privateKey), privateKey };
}

/** Encrypt + persist a private key. Returns the public address; the key itself is not returned. */
export function saveWallet(dir: string, id: string, privateKey: Hex, passphrase: string): Address {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`keystore id must be kebab-case, got "${id}"`);
  const account = privateKeyToAccount(privateKey);
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt, SCRYPT);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(privateKey.slice(2), "hex")), cipher.final()]);
  const file: KeystoreFile = {
    version: 1,
    address: account.address,
    crypto: {
      kdf: "scrypt", salt: salt.toString("hex"), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
      cipher: "aes-256-gcm", iv: iv.toString("hex"),
      ciphertext: ciphertext.toString("hex"), tag: cipher.getAuthTag().toString("hex"),
    },
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  return account.address;
}

/** Decrypt a stored wallet into a signing account. Throws on wrong passphrase (GCM auth). */
export function loadWallet(dir: string, id: string, passphrase: string): PrivateKeyAccount {
  const file = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as KeystoreFile;
  if (file.version !== 1 || file.crypto.cipher !== "aes-256-gcm" || file.crypto.kdf !== "scrypt") {
    throw new Error(`keystore ${id}: unsupported format`);
  }
  const key = deriveKey(passphrase, Buffer.from(file.crypto.salt, "hex"), file.crypto);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.crypto.iv, "hex"));
  decipher.setAuthTag(Buffer.from(file.crypto.tag, "hex"));
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(Buffer.from(file.crypto.ciphertext, "hex")), decipher.final()]);
  } catch {
    throw new Error(`keystore ${id}: wrong passphrase or corrupted file`);
  }
  const account = privateKeyToAccount(`0x${plain.toString("hex")}` as Hex);
  // integrity: the decrypted key must produce the address recorded at save time
  const a = Buffer.from(account.address.slice(2).toLowerCase(), "hex");
  const b = Buffer.from(file.address.slice(2).toLowerCase(), "hex");
  if (!timingSafeEqual(a, b)) throw new Error(`keystore ${id}: address mismatch after decrypt`);
  return account;
}

/** Public addresses of every stored wallet (no decryption, no passphrase needed). */
export function listWallets(dir: string): Array<{ id: string; address: Address }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const file = JSON.parse(readFileSync(join(dir, f), "utf8")) as KeystoreFile;
      return { id: f.replace(/\.json$/, ""), address: file.address };
    });
}

/** Generate + persist in one step: the birth-time path. Only the address leaves this function. */
export function birthWallet(dir: string, id: string, passphrase: string): Address {
  const { privateKey } = generateWallet();
  return saveWallet(dir, id, privateKey, passphrase);
}

const SECRET_FILE = ".keystore-passphrase";

/**
 * Birth must never block on a human: resolve the keystore encryption secret autonomously.
 * Precedence: a valid env-provided secret → the machine secret file → mint a fresh one
 * (32 bytes crypto-random, 0600, inside the gitignored keystore dir).
 *
 * Season-0 custody model, stated plainly: this secret lives on the same host as the
 * ciphertext. It defends against accidental commits and casual reads — not a compromised
 * host. Offline key backup remains a GO_LIVE checklist item. Agents never touch this path:
 * quants only ever receive wallet ADDRESSES; keys and this secret stay out of genomes,
 * prompts, world state, and logs.
 */
export function ensureKeystoreSecret(dir: string, envSecret?: string): string {
  if (envSecret && envSecret.length >= 8) return envSecret;
  const path = join(dir, SECRET_FILE);
  if (existsSync(path)) {
    const stored = readFileSync(path, "utf8").trim();
    if (stored.length >= 8) return stored;
    // never silently mint a NEW secret over a corrupt file — existing keystores depend on it
    throw new Error(`keystore secret file ${path} is corrupt (too short) — restore it or remove it deliberately`);
  }
  mkdirSync(dir, { recursive: true });
  const secret = randomBytes(33).toString("base64url");
  writeFileSync(path, secret + "\n", { mode: 0o600 });
  return secret;
}
