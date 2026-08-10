/**
 * PonsLive — the real-chain Pons adapter (M5+). SPENDS REAL FUNDS; reachable only through
 * dust-launch.mjs, which is triple-gated (DUST_OK confirm file + safety-guard hook + complete
 * env). Wired against the VERIFIED contracts on Robinhood Chain (researched 2026-07-22, see
 * data/chain/pons-abi.json):
 *
 *   PonsLaunchFactory.launchToken(TokenParams, launchConfigId, dexId, salt) payable → token
 *   PonsLaunchLocker.collectFees(token) → (amount0, amount1)   // creator fee claim
 *
 * Unclaimed fees are read by SIMULATING collectFees via eth_call — the locker exposes no
 * pending-fees view. The artifact is validated strictly; wrong ABI + real money is not a
 * place for defaults. Two facts remain to confirm at the manual dust launch (artifact
 * _readme): dev-buy-via-msg.value and the working launchConfigId/dexId.
 */
import {
  createPublicClient, createWalletClient, decodeEventLog, http, parseEther,
  type Abi, type Account, type Address, type Hex, type PublicClient, type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChain } from "./chainDef.js";
import type { PonsAdapter, PonsClaimResult, PonsLaunchResult, TokenMeta, CreatorFees } from "./pons.js";

/** Shape of data/chain/pons-abi.json — the Phase 4 research artifact. */
export interface PonsAbiArtifact {
  network: { chainId: number; rpcUrl: string };
  factoryAddr: Address;
  lockerAddr: Address;
  factoryAbi: Abi;
  lockerAbi: Abi;
  launchFunction: string;
  claimFunction: string;
  launchEvent: string;
  launchConfigId: number;
  dexId: number;
}

export interface PonsLiveConfig {
  rpcUrl: string;
  chainId: number;
  artifact: PonsAbiArtifact;
  /** hex private key — season-0 custody: throwaway dust key from env, never the treasury key */
  privateKey?: Hex;
  /** alternative to privateKey: an already-loaded account (e.g. a quant's custody account) */
  account?: Account;
}

function abiNames(abi: Abi): Set<string> {
  return new Set(abi.filter((e) => "name" in e).map((e) => (e as { name: string }).name));
}

export function validateArtifact(a: unknown): PonsAbiArtifact {
  const art = a as Partial<PonsAbiArtifact> | null;
  if (!art || typeof art !== "object") throw new Error("pons-abi artifact: not an object");
  const missing: string[] = [];
  if (!art.network || !Number.isInteger(art.network.chainId) || !art.network.rpcUrl) missing.push("network.chainId/rpcUrl");
  for (const k of ["factoryAddr", "lockerAddr"] as const) {
    if (typeof art[k] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(art[k]!)) missing.push(k);
  }
  if (!Array.isArray(art.factoryAbi) || art.factoryAbi.length === 0) missing.push("factoryAbi");
  if (!Array.isArray(art.lockerAbi) || art.lockerAbi.length === 0) missing.push("lockerAbi");
  for (const k of ["launchFunction", "claimFunction", "launchEvent"] as const) {
    if (typeof art[k] !== "string" || !art[k]) missing.push(k);
  }
  if (!Number.isInteger(art.launchConfigId) || !Number.isInteger(art.dexId)) missing.push("launchConfigId/dexId");
  if (missing.length) {
    throw new Error(
      `pons-abi artifact incomplete (missing: ${missing.join(", ")}) — complete the research at docs.ponsfamily.com before any dust spend`,
    );
  }
  const factoryNames = abiNames(art.factoryAbi as Abi);
  const lockerNames = abiNames(art.lockerAbi as Abi);
  if (!factoryNames.has(art.launchFunction!)) {
    throw new Error(`pons-abi artifact: launch function "${art.launchFunction}" not in factoryAbi — refusing to guess with real funds`);
  }
  if (!factoryNames.has(art.launchEvent!)) {
    throw new Error(`pons-abi artifact: launch event "${art.launchEvent}" not in factoryAbi — refusing to guess with real funds`);
  }
  if (!lockerNames.has(art.claimFunction!)) {
    throw new Error(`pons-abi artifact: claim function "${art.claimFunction}" not in lockerAbi — refusing to guess with real funds`);
  }
  return art as PonsAbiArtifact;
}

export class PonsLive implements PonsAdapter {
  readonly publicClient: PublicClient;
  private readonly wallet: WalletClient;
  private readonly account;
  private readonly art: PonsAbiArtifact;

  constructor(cfg: PonsLiveConfig) {
    this.art = validateArtifact(cfg.artifact);
    if (cfg.chainId !== this.art.network.chainId) {
      throw new Error(`chain id mismatch: env says ${cfg.chainId}, artifact says ${this.art.network.chainId}`);
    }
    if (!cfg.privateKey && !cfg.account) {
      throw new Error("PonsLive needs a signer: pass privateKey or account");
    }
    const chain = robinhoodChain({ rpcUrl: cfg.rpcUrl, chainId: cfg.chainId });
    this.account = cfg.account ?? privateKeyToAccount(cfg.privateKey!);
    this.publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
    this.wallet = createWalletClient({ chain, transport: http(cfg.rpcUrl), account: this.account });
  }

  get address(): Address {
    return this.account.address;
  }

  /** Current launch fee straight from the factory (never hardcoded for a real spend). */
  async launchFeeWei(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.art.factoryAddr,
      abi: this.art.factoryAbi,
      functionName: "launchFee",
    })) as bigint;
  }

  async launch(meta: TokenMeta, feeWallet: Address, devBuyEth: number): Promise<PonsLaunchResult> {
    const fee = await this.launchFeeWei();
    // VERIFY-AT-DUST: excess msg.value above launchFee becomes the initial dev-buy
    const value = fee + parseEther(String(Math.max(0, devBuyEth)));
    const params = {
      name: meta.name,
      symbol: meta.ticker,
      logo: "",
      description: "a quant of quants.family — bred, not hired. every trade public.",
      socials: { twitter: "", telegram: "", discord: "", website: "https://quants.family", farcaster: "" },
      feeWallet,
    };
    const salt: Hex = `0x${Date.now().toString(16).padStart(64, "0")}`;

    const hash = await this.wallet.writeContract({
      chain: this.wallet.chain,
      account: this.account,
      address: this.art.factoryAddr,
      abi: this.art.factoryAbi,
      functionName: this.art.launchFunction,
      args: [params, BigInt(this.art.launchConfigId), BigInt(this.art.dexId), salt],
      value,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Pons launch tx reverted: ${hash} — inspect on blockscout before retrying`);
    }

    // decode the TokenLaunched event for the real token + pool addresses
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: this.art.factoryAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === this.art.launchEvent) {
          const args = decoded.args as unknown as { token: Address; pool: Address };
          return { tokenAddr: args.token, poolAddr: args.pool, tx: hash };
        }
      } catch {
        // not this event; keep scanning
      }
    }
    throw new Error(`Pons launch tx ${hash} succeeded but no ${this.art.launchEvent} event found — verify the artifact against the live contract`);
  }

  async claimFees(tokenAddr: Address): Promise<PonsClaimResult> {
    const pending = await this.readCreatorFees(tokenAddr);
    const hash = await this.wallet.writeContract({
      chain: this.wallet.chain,
      account: this.account,
      address: this.art.lockerAddr,
      abi: this.art.lockerAbi,
      functionName: this.art.claimFunction,
      args: [tokenAddr],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Pons collectFees tx reverted: ${hash}`);
    }
    return { ...pending, tx: hash };
  }

  /**
   * The locker has no pending-fees view; SIMULATE collectFees via eth_call to see what a
   * claim would return right now. (amount0/amount1 order follows the pool's token ordering —
   * we report them as token/weth without resolving isToken0; the dust gate only needs "fees
   * exist and claim works", and the system's flow ledger records actual claimed amounts.)
   */
  async readCreatorFees(tokenAddr: Address, asAddress?: Address): Promise<CreatorFees> {
    const { result } = await this.publicClient.simulateContract({
      address: this.art.lockerAddr,
      abi: this.art.lockerAbi,
      functionName: this.art.claimFunction,
      args: [tokenAddr],
      // eth_call impersonation: lets the daemon read fees from the fee wallet's seat without its key
      account: asAddress ?? this.account,
    });
    const [amount0, amount1] = result as [bigint, bigint];
    return { tokenFees: Number(amount0) / 1e18, wethFees: Number(amount1) / 1e18 };
  }

  /**
   * The M5 dust cycle: launch (dev-buy rides in the launch tx value) → read fees → claim.
   * Everything the gate needs to show on blockscout.
   */
  async dustCycle(meta: TokenMeta & { devBuyEth: number }): Promise<{
    tokenAddr: Address; poolAddr: Address; launchTx: string; feeClaimTx: string; devBuyTx: string;
  }> {
    const launch = await this.launch({ name: meta.name, ticker: meta.ticker }, this.address, meta.devBuyEth);
    const claim = await this.claimFees(launch.tokenAddr);
    return {
      tokenAddr: launch.tokenAddr,
      poolAddr: launch.poolAddr,
      launchTx: launch.tx,
      feeClaimTx: claim.tx,
      // Pons performs the initial buy inside the launch transaction (value = fee + devBuyEth)
      devBuyTx: launch.tx,
    };
  }
}

/**
 * Factory used by build/scripts/dust-launch.mjs. Reads the research artifact from disk and
 * the dust key from env DUST_PRIVATE_KEY (season-0 dust testing: one throwaway funded key,
 * never the treasury key, never persisted anywhere in the repo).
 */
export async function createPonsLive(cfg: {
  rpcUrl: string;
  chainId: number;
  abiPath: string;
}): Promise<PonsLive> {
  const { readFileSync } = await import("node:fs");
  const artifact = validateArtifact(JSON.parse(readFileSync(cfg.abiPath, "utf8")));
  const pk = process.env.DUST_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("createPonsLive: DUST_PRIVATE_KEY missing or malformed — fund a throwaway dust key and export it");
  }
  return new PonsLive({
    rpcUrl: cfg.rpcUrl,
    chainId: cfg.chainId,
    artifact,
    privateKey: pk as Hex,
  });
}
