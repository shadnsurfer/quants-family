/**
 * Per-quant autonomous trading: the live gate must be unbypassable, the whitelist must be in
 * lockstep with the verified registry, and a trader must only exist for a wallet you hold.
 * No network sends anywhere in this suite — the gates throw first, by design.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GUARDRAILS } from "@quants/core";
import {
  QuantTrader, STOCK_TOKENS, assertLiveGateOpen, birthWallet,
} from "../src/index.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "quants-trading-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const PASS = "correct horse battery staple";

describe("whitelist ↔ registry lockstep", () => {
  it("every whitelisted symbol has a verified canonical address, and vice versa", () => {
    const whitelist = [...GUARDRAILS.venueWhitelist].sort();
    const registry = Object.keys(STOCK_TOKENS).sort();
    expect(whitelist).toEqual(registry);
  });

  it("HOOD is on neither side — Robinhood does not tokenize itself", () => {
    expect(STOCK_TOKENS["HOOD"]).toBeUndefined();
    expect(GUARDRAILS.venueWhitelist).not.toContain("HOOD");
  });

  it("the registry is the expanded pool: 94 canonical assets including the new tier", () => {
    expect(Object.keys(STOCK_TOKENS)).toHaveLength(94);
    for (const sym of ["PLTR", "COIN", "GME", "MSTR", "QQQ", "SPY", "TSM", "LLY", "XOM", "SOFI"]) {
      expect(STOCK_TOKENS[sym], sym).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});

describe("assertLiveGateOpen — the unbypassable human gate", () => {
  it("refuses when MODE is not live, regardless of the consent file", () => {
    const goLive = join(dir, "GO_LIVE_OK");
    writeFileSync(goLive, "");
    for (const mode of [undefined, "paper", "PAPER", "Live", "live "]) {
      expect(() => assertLiveGateOpen({ mode, goLiveFile: goLive })).toThrow(/MODE is not 'live'/);
    }
  });

  it("refuses when GO_LIVE_OK is absent, even in live mode", () => {
    expect(() => assertLiveGateOpen({ mode: "live", goLiveFile: join(dir, "GO_LIVE_OK") }))
      .toThrow(/GO_LIVE_OK is absent/);
  });

  it("opens only with BOTH: MODE=live and the consent file", () => {
    const goLive = join(dir, "GO_LIVE_OK");
    writeFileSync(goLive, "");
    expect(() => assertLiveGateOpen({ mode: "live", goLiveFile: goLive })).not.toThrow();
  });
});

describe("QuantTrader", () => {
  function makeTrader(gateOverrides: Partial<{ mode: string; goLiveFile: string }> = {}) {
    birthWallet(dir, "g2-testtrader", PASS);
    return new QuantTrader({
      quantId: "g2-testtrader",
      keystoreDir: dir,
      passphrase: PASS,
      rpcUrl: "https://rpc.invalid.example",
      chainId: 4663,
      routerAddr: "0x000000000000000000000000000000000000dEaD",
      gate: { mode: gateOverrides.mode, goLiveFile: gateOverrides.goLiveFile ?? join(dir, "GO_LIVE_OK") },
    });
  }

  it("construction requires the quant's own keystore + passphrase; address is its wallet", () => {
    const trader = makeTrader();
    expect(trader.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(() =>
      new QuantTrader({
        quantId: "g2-testtrader", keystoreDir: dir, passphrase: "wrong passphrase",
        rpcUrl: "https://rpc.invalid.example", chainId: 4663,
        routerAddr: "0x000000000000000000000000000000000000dEaD",
        gate: { mode: undefined, goLiveFile: join(dir, "GO_LIVE_OK") },
      }),
    ).toThrow(/wrong passphrase|corrupted/);
  });

  it("buyStock refuses BEFORE any network call when the gate is shut (invalid rpc never contacted)", async () => {
    const trader = makeTrader({ mode: "paper" });
    await expect(trader.buyStock("NVDA", 0.001)).rejects.toThrow(/MODE is not 'live'/);
  });

  it("non-whitelisted symbols are refused at the static guard, gate open or not", () => {
    expect(() => QuantTrader.assertTradeable("HOOD")).toThrow(/not on the frozen venue whitelist/);
    expect(() => QuantTrader.assertTradeable("DUST0")).toThrow(/not on the frozen venue whitelist/);
    expect(QuantTrader.assertTradeable("NVDA")).toBe(STOCK_TOKENS["NVDA"]);
    expect(QuantTrader.assertTradeable("PLTR")).toBe(STOCK_TOKENS["PLTR"]);
  });
});
