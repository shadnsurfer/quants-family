/**
 * Custody router: CUSTODY_MODE parsing, local-mode roundtrip parity with wallets.ts,
 * idempotent births (a live key is never regenerated out from under its funds), and the
 * turnkey failure modes — all offline; no Turnkey API calls are made in these tests.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  birthCustodyWallet, custodyMode, loadWallet, readTurnkeyRegistry, resolveCustodyAccount,
} from "../src/index.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "quants-custody-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const PASS = "correct horse battery staple";
const LOCAL = { CUSTODY_MODE: "local" } as NodeJS.ProcessEnv;
const TURNKEY_ENV = {
  CUSTODY_MODE: "turnkey",
  TURNKEY_API_PUBLIC_KEY: "02" + "ab".repeat(32),
  TURNKEY_API_PRIVATE_KEY: "cd".repeat(32),
  TURNKEY_ORG_ID: "00000000-0000-0000-0000-000000000000",
} as NodeJS.ProcessEnv;

describe("custodyMode", () => {
  it("defaults to local when CUSTODY_MODE is unset", () => {
    expect(custodyMode({})).toBe("local");
  });
  it("parses turnkey", () => {
    expect(custodyMode({ CUSTODY_MODE: "turnkey" })).toBe("turnkey");
  });
  it("rejects unknown modes loudly", () => {
    expect(() => custodyMode({ CUSTODY_MODE: "paper" })).toThrow(/local.*turnkey/);
  });
});

describe("local custody", () => {
  it("birth + resolve roundtrip yields the same address as the raw keystore path", async () => {
    const addr = await birthCustodyWallet("g2-custody", { keystoreDir: dir, passphrase: PASS, env: LOCAL });
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const acct = resolveCustodyAccount("g2-custody", { keystoreDir: dir, passphrase: PASS, env: LOCAL });
    expect(acct.address).toBe(addr);
    // and it is the exact same key the legacy keystore API would load
    expect(loadWallet(dir, "g2-custody", PASS).address).toBe(addr);
  });

  it("birth is idempotent — an existing id keeps its address (and its funds)", async () => {
    const first = await birthCustodyWallet("g2-idem", { keystoreDir: dir, passphrase: PASS, env: LOCAL });
    const second = await birthCustodyWallet("g2-idem", { keystoreDir: dir, passphrase: PASS, env: LOCAL });
    expect(second).toBe(first);
  });
});

describe("turnkey custody (offline failure modes)", () => {
  it("names the missing turnkey env vars before anything else", () => {
    expect(() =>
      resolveCustodyAccount("g2-x", { keystoreDir: dir, env: { CUSTODY_MODE: "turnkey" } })
    ).toThrow(/TURNKEY_API_PUBLIC_KEY.*TURNKEY_API_PRIVATE_KEY.*TURNKEY_ORG_ID/s);
  });

  it("refuses to sign for a quant with no registered turnkey key", () => {
    expect(() =>
      resolveCustodyAccount("g2-unprovisioned", { keystoreDir: dir, env: TURNKEY_ENV })
    ).toThrow(/no turnkey key registered.*g2-unprovisioned/);
  });

  it("registry roundtrip records identifiers only", async () => {
    const registry = readTurnkeyRegistry(dir);
    expect(registry).toEqual({ version: 1, quants: {} });
    // idempotency in turnkey mode is registry-driven: a recorded entry returns without an API call
    registry.quants["g2-reg"] = { address: "0x000000000000000000000000000000000000dEaD", turnkeyPrivateKeyId: "pk_test" };
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "turnkey-registry.json"), JSON.stringify(registry));
    const addr = await birthCustodyWallet("g2-reg", { keystoreDir: dir, env: TURNKEY_ENV });
    expect(addr).toBe("0x000000000000000000000000000000000000dEaD");
  });
});
