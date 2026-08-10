/**
 * Paper-mode Pons launcher: fabricates deterministic, obviously-fake addresses so births are
 * fully exercised without a chain. The real adapter pair (PonsMock/PonsLive) lands in
 * packages/chain at M5 behind the same PonsLike surface.
 */
import { hashSeed } from "@quants/core";
import type { LaunchResult, PonsLike } from "./types.js";

function fakeAddr(tag: string, name: string): `0x${string}` {
  const h1 = hashSeed(`${tag}:${name}`).toString(16).padStart(8, "0");
  const h2 = hashSeed(`${name}:${tag}`).toString(16).padStart(8, "0");
  return `0x${(h1 + h2).repeat(3).slice(0, 40)}`;
}

export class PaperPons implements PonsLike {
  launch(meta: { name: string; ticker: string }, feeWallet: string, _devBuyEth: number): LaunchResult {
    return {
      tokenAddr: fakeAddr("token", meta.name),
      poolAddr: fakeAddr("pool", meta.name),
      tx: `paper-launch-${meta.name}-${feeWallet.slice(0, 10)}`,
    };
  }
}
