/**
 * Thin viem client factories for the ops scripts (season-0 daemon/genesis). Keeps every
 * build/scripts/*.mjs free of direct viem imports — they use the built chain package only.
 */
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther,
  type Account, type Address, type Hex, type PublicClient, type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChain, type ChainEnv } from "./chainDef.js";

export function chainPublicClient(env: ChainEnv): PublicClient {
  return createPublicClient({ chain: robinhoodChain(env), transport: http(env.rpcUrl) });
}

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export async function erc20BalanceOf(client: PublicClient, token: Address, owner: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [owner] });
}

export interface WalletOps {
  address: Address;
  account: Account;
  balanceEth(): Promise<number>;
  /** send ETH and wait for inclusion — used only for dust gas top-ups */
  sendEth(to: Address, amountEth: number): Promise<string>;
}

export function walletOps(env: ChainEnv & { privateKey?: Hex; account?: Account }): WalletOps {
  if (!env.privateKey && !env.account) throw new Error("walletOps: pass privateKey or account");
  const account = env.account ?? privateKeyToAccount(env.privateKey!);
  const chain = robinhoodChain(env);
  const publicClient = createPublicClient({ chain, transport: http(env.rpcUrl) });
  const wallet: WalletClient = createWalletClient({ chain, transport: http(env.rpcUrl), account });
  return {
    address: account.address,
    account,
    async balanceEth() {
      return Number(await publicClient.getBalance({ address: account.address })) / 1e18;
    },
    async sendEth(to, amountEth) {
      const hash = await wallet.sendTransaction({ chain, account, to, value: parseEther(String(amountEth)) });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`sendEth reverted: ${hash}`);
      return hash;
    },
  };
}
