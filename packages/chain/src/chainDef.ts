/**
 * Robinhood Chain definition (PROJECT.md §7): Ethereum L2 on the Arbitrum Orbit stack,
 * built from env (RPC_URL, CHAIN_ID) — no hardcoded endpoints in the codebase.
 */
import { defineChain, type Chain } from "viem";

export interface ChainEnv {
  rpcUrl: string;
  chainId: number;
}

export function robinhoodChain(env: ChainEnv): Chain {
  if (!env.rpcUrl || !/^https?:\/\//.test(env.rpcUrl)) {
    throw new Error(`robinhoodChain: RPC_URL must be an http(s) url, got "${env.rpcUrl}"`);
  }
  if (!Number.isInteger(env.chainId) || env.chainId <= 0) {
    throw new Error(`robinhoodChain: CHAIN_ID must be a positive integer, got ${env.chainId}`);
  }
  return defineChain({
    id: env.chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [env.rpcUrl] } },
    blockExplorers: {
      default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
    },
  });
}

export function explorerTxUrl(txHash: string): string {
  return `https://robinhoodchain.blockscout.com/tx/${txHash}`;
}

export function explorerAddressUrl(addr: string): string {
  return `https://robinhoodchain.blockscout.com/address/${addr}`;
}
