/**
 * Per-quant wallet custody: generation, encrypted keystore roundtrip, wrong-passphrase
 * rejection, and the load-bearing property that the plaintext key NEVER touches disk.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  birthWallet, ensureKeystoreSecret, generateWallet, listWallets, loadWallet, saveWallet,
} from "../src/index.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "quants-keystore-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const PASS = "correct horse battery staple";

describe("generateWallet", () => {
  it("produces a valid account whose address derives from the key", () => {
    const { account, privateKey } = generateWallet();
    expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("never produces the same key twice", () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateWallet().privateKey));
    expect(keys.size).toBe(20);
  });
});

describe("keystore roundtrip", () => {
  it("save → load returns a signer with the same address; key absent from disk", () => {
    const { privateKey, account } = generateWallet();
    const savedAddr = saveWallet(dir, "g2-testling", privateKey, PASS);
    expect(savedAddr).toBe(account.address);

    const raw = readFileSync(join(dir, "g2-testling.json"), "utf8");
    expect(raw).not.toContain(privateKey.slice(2)); // plaintext key never on disk
    expect(raw).toContain(account.address); // public address is fine

    const loaded = loadWallet(dir, "g2-testling", PASS);
    expect(loaded.address).toBe(account.address);
  });

  it("wrong passphrase throws, never returns a wrong key", () => {
    const { privateKey } = generateWallet();
    saveWallet(dir, "g2-a", privateKey, PASS);
    expect(() => loadWallet(dir, "g2-a", "wrong passphrase!")).toThrow(/wrong passphrase|corrupted/);
  });

  it("short passphrases are refused outright", () => {
    const { privateKey } = generateWallet();
    expect(() => saveWallet(dir, "g2-b", privateKey, "short")).toThrow(/at least 8/);
  });

  it("ids must be kebab-case (no path tricks)", () => {
    const { privateKey } = generateWallet();
    expect(() => saveWallet(dir, "../evil", privateKey, PASS)).toThrow(/kebab-case/);
    expect(() => saveWallet(dir, "UPPER", privateKey, PASS)).toThrow(/kebab-case/);
  });

  it("tampered ciphertext fails GCM auth", () => {
    const { privateKey } = generateWallet();
    saveWallet(dir, "g2-c", privateKey, PASS);
    const path = join(dir, "g2-c.json");
    const file = JSON.parse(readFileSync(path, "utf8"));
    file.crypto.ciphertext = file.crypto.ciphertext.replace(/^../, "00");
    require("node:fs").writeFileSync(path, JSON.stringify(file));
    expect(() => loadWallet(dir, "g2-c", PASS)).toThrow(/wrong passphrase|corrupted/);
  });
});

describe("birthWallet + listWallets", () => {
  it("issues distinct wallets per quant and lists them without a passphrase", () => {
    const a = birthWallet(dir, "g2-ito", PASS);
    const b = birthWallet(dir, "g2-wiener", PASS);
    expect(a).not.toBe(b);
    const listed = listWallets(dir);
    expect(listed.map((w) => w.id).sort()).toEqual(["g2-ito", "g2-wiener"]);
    expect(listed.find((w) => w.id === "g2-ito")!.address).toBe(a);
    // and each is loadable into a signer
    expect(loadWallet(dir, "g2-ito", PASS).address).toBe(a);
  });

  it("keystore files are written 0600 (owner-only)", () => {
    birthWallet(dir, "g2-perm", PASS);
    const mode = require("node:fs").statSync(join(dir, "g2-perm.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("empty dir lists empty", () => {
    expect(listWallets(join(dir, "nope"))).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(0);
  });
});

describe("ensureKeystoreSecret — birth never blocks on a human", () => {
  it("a valid env secret always wins and mints no file", () => {
    expect(ensureKeystoreSecret(dir, PASS)).toBe(PASS);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("without an env secret it mints a machine secret once, 0600, and stays stable", () => {
    const first = ensureKeystoreSecret(dir);
    expect(first.length).toBeGreaterThanOrEqual(32);
    const mode = statSync(join(dir, ".keystore-passphrase")).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(ensureKeystoreSecret(dir)).toBe(first);
    expect(ensureKeystoreSecret(dir, "short")).toBe(first); // too-short env falls through
  });

  it("a corrupt (too short) secret file throws instead of silently re-minting", () => {
    writeFileSync(join(dir, ".keystore-passphrase"), "oops\n");
    expect(() => ensureKeystoreSecret(dir)).toThrow(/corrupt/);
  });

  it("end to end: machine secret births a wallet; only the ADDRESS leaves, key stays sealed", () => {
    const secret = ensureKeystoreSecret(dir);
    const addr = birthWallet(dir, "g2-autonomous", secret);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const raw = readFileSync(join(dir, "g2-autonomous.json"), "utf8");
    expect(raw).not.toContain(secret); // the secret itself never lands in a keystore
    expect(JSON.parse(raw)).not.toHaveProperty("privateKey");
    expect(loadWallet(dir, "g2-autonomous", secret).address).toBe(addr);
  });
});
