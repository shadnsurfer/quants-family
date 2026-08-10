/**
 * PonsMock — the paper/CI implementation of the Pons adapter. Deterministic (keccak-derived
 * addresses, seeded fee accrual), in-memory, inspectable. The M5 referee runs against THIS;
 * PonsLive swaps in behind the same interface once the human drops DUST_OK.
 */
import { keccak256, toHex } from "viem";
import { seededRng } from "@quants/core";
import type {
  CreatorFees, PonsAdapter, PonsClaimResult, PonsLaunchResult, TokenMeta,
} from "./pons.js";

interface MockToken {
  meta: TokenMeta;
  feeWallet: `0x${string}`;
  devBuyEth: number;
  launchedAtCall: number;
  accrued: CreatorFees;
  claimed: CreatorFees;
}

function derivedAddr(kind: string, name: string): `0x${string}` {
  return `0x${keccak256(toHex(`pons-${kind}-${name}`)).slice(2, 42)}`;
}

export class PonsMock implements PonsAdapter {
  private readonly tokens = new Map<`0x${string}`, MockToken>();
  private calls = 0;
  private readonly rng: () => number;

  constructor(seed: number | string = "pons-mock") {
    this.rng = seededRng(seed);
  }

  async launch(meta: TokenMeta, feeWallet: `0x${string}`, devBuyEth: number): Promise<PonsLaunchResult> {
    if (!meta.name || !meta.ticker) throw new Error("PonsMock.launch: name and ticker required");
    if (devBuyEth < 0) throw new Error("PonsMock.launch: devBuyEth must be ≥ 0");
    const tokenAddr = derivedAddr("token", meta.name);
    if (this.tokens.has(tokenAddr)) throw new Error(`PonsMock.launch: token for "${meta.name}" already launched`);
    this.calls += 1;
    const token: MockToken = {
      meta,
      feeWallet,
      devBuyEth,
      launchedAtCall: this.calls,
      accrued: { tokenFees: 0, wethFees: 0 },
      claimed: { tokenFees: 0, wethFees: 0 },
    };
    this.tokens.set(tokenAddr, token);
    return {
      tokenAddr,
      poolAddr: derivedAddr("pool", meta.name),
      tx: `0x${keccak256(toHex(`launch-${meta.name}-${this.calls}`)).slice(2)}`,
    };
  }

  /** Simulate trading volume: accrue creator fees deterministically. Test/paper hook. */
  accrueFees(tokenAddr: `0x${string}`, tokenFees?: number, wethFees?: number): void {
    const t = this.mustGet(tokenAddr);
    t.accrued.tokenFees += tokenFees ?? Math.round(this.rng() * 1000) / 100;
    t.accrued.wethFees += wethFees ?? Math.round(this.rng() * 1e6) / 1e8;
  }

  async readCreatorFees(tokenAddr: `0x${string}`): Promise<CreatorFees> {
    const t = this.mustGet(tokenAddr);
    return { ...t.accrued };
  }

  async claimFees(tokenAddr: `0x${string}`): Promise<PonsClaimResult> {
    const t = this.mustGet(tokenAddr);
    const out: PonsClaimResult = {
      ...t.accrued,
      tx: `0x${keccak256(toHex(`claim-${tokenAddr}-${t.claimed.tokenFees}-${t.accrued.tokenFees}`)).slice(2)}`,
    };
    t.claimed.tokenFees += t.accrued.tokenFees;
    t.claimed.wethFees += t.accrued.wethFees;
    t.accrued = { tokenFees: 0, wethFees: 0 };
    return out;
  }

  /** Inspection helpers for tests and the dress rehearsal. */
  launchedTokens(): Array<{ tokenAddr: `0x${string}`; meta: TokenMeta; feeWallet: `0x${string}`; devBuyEth: number }> {
    return [...this.tokens.entries()].map(([tokenAddr, t]) => ({
      tokenAddr, meta: t.meta, feeWallet: t.feeWallet, devBuyEth: t.devBuyEth,
    }));
  }

  totalClaimed(tokenAddr: `0x${string}`): CreatorFees {
    const t = this.mustGet(tokenAddr);
    return { ...t.claimed };
  }

  private mustGet(tokenAddr: `0x${string}`): MockToken {
    const t = this.tokens.get(tokenAddr);
    if (!t) throw new Error(`PonsMock: unknown token ${tokenAddr}`);
    return t;
  }
}
