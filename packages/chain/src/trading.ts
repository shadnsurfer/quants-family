/**
 * Per-quant autonomous trading (PROJECT.md §5.1 step 4, live path). Each quant trades from
 * its OWN custody wallet (CUSTODY_MODE: local keystore, or Turnkey enclave per the 2026-08-09
 * amendment) — the same wallet that owns its token's creator fees. The trader
 * enforces the frozen guardrails at the call site (venue whitelist, slippage cap) and
 * REFUSES to send anything unless the live gate is open:
 *
 *   MODE=live  AND  build/state/GO_LIVE_OK exists  — the one human decision (Phase 6).
 *
 * Everything else (quoting, calldata, addresses, approvals math) works today so the whole
 * path is testable without a cent moving. Paper mode never touches this module.
 */
import { existsSync } from "node:fs";
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther,
  type Address, type Hex, type PublicClient, type WalletClient,
} from "viem";
import type { Account } from "viem";
import { GUARDRAILS } from "@quants/core";
import { robinhoodChain } from "./chainDef.js";
import { RWA_INFRA, buildExactInputSingle, quoteStockBuy, V3_FEE_TIERS } from "./rwa.js";
import { STOCK_TOKENS } from "./stockTokens.js";
import { resolveCustodyAccount } from "./custody.js";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export interface LiveGate {
  /** current run mode; only the literal "live" opens the gate */
  mode: string | undefined;
  /** path to the human consent file (build/state/GO_LIVE_OK) */
  goLiveFile: string;
}

/** Throws unless BOTH halves of the human gate are open. Every send calls this first. */
export function assertLiveGateOpen(gate: LiveGate): void {
  if (gate.mode !== "live") {
    throw new Error("trade refused: MODE is not 'live' — paper mode routes through the paper engine");
  }
  if (!existsSync(gate.goLiveFile)) {
    throw new Error(
      "trade refused: build/state/GO_LIVE_OK is absent. Real-money trading is the one decision " +
        "the system never makes itself (Phase 6 checklist).",
    );
  }
}

export interface QuantTraderConfig {
  quantId: string;
  keystoreDir: string;
  passphrase: string;
  rpcUrl: string;
  chainId: number;
  /** SwapRouter02 — defaults to the verified canonical router; override via env SWAP_ROUTER_ADDR */
  routerAddr?: Address;
  gate: LiveGate;
}

export interface TradeReceipt {
  txHash: Hex;
  symbol: string;
  side: "buy";
  amountInWeth: number;
  minOutTokens: number;
  effectiveSpreadBps: number;
}

/**
 * One quant's autonomous trading arm. Construction resolves the quant's signing account under
 * the active custody mode (custody.ts): a local keystore decrypt, or — in turnkey mode — a
 * Turnkey enclave reference; in turnkey mode no key material ever exists in this process.
 */
export class QuantTrader {
  readonly quantId: string;
  readonly address: Address;
  private readonly account: Account;
  private readonly cfg: QuantTraderConfig;
  private readonly publicClient: PublicClient;
  private readonly wallet: WalletClient;

  private readonly routerAddr: Address;

  constructor(cfg: QuantTraderConfig) {
    this.cfg = cfg;
    this.routerAddr = cfg.routerAddr ?? RWA_INFRA.swapRouter;
    this.quantId = cfg.quantId;
    this.account = resolveCustodyAccount(cfg.quantId, { keystoreDir: cfg.keystoreDir, passphrase: cfg.passphrase });
    this.address = this.account.address;
    const chain = robinhoodChain({ rpcUrl: cfg.rpcUrl, chainId: cfg.chainId });
    this.publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
    this.wallet = createWalletClient({ chain, transport: http(cfg.rpcUrl), account: this.account });
  }

  /** Guardrail: only canonical, whitelist-listed stock tokens are tradeable. */
  static assertTradeable(symbol: string): Address {
    const addr = STOCK_TOKENS[symbol];
    if (!addr || !(GUARDRAILS.venueWhitelist as readonly string[]).includes(symbol)) {
      throw new Error(`trade refused: ${symbol} is not on the frozen venue whitelist of canonical stock tokens`);
    }
    return addr;
  }

  /** Read-only: the quant's WETH balance (its trading capital in live mode). */
  async wethBalance(): Promise<number> {
    const wei = await this.publicClient.readContract({
      address: RWA_INFRA.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [this.address],
    });
    return Number(wei) / 1e18;
  }

  /** Read-only: indicative quote via the deepest live pool. No gate needed. */
  async quote(symbol: string, amountInWeth: number) {
    QuantTrader.assertTradeable(symbol);
    return quoteStockBuy(this.publicClient, symbol, amountInWeth);
  }

  /**
   * Autonomous market buy, signed by the quant's own wallet. Enforces, in order:
   * (1) the live human gate, (2) the venue whitelist, (3) a live pool exists,
   * (4) the frozen slippage cap via amountOutMinimum. Approves WETH to the router if needed.
   */
  async buyStock(symbol: string, amountInWeth: number): Promise<TradeReceipt> {
    assertLiveGateOpen(this.cfg.gate);
    const token = QuantTrader.assertTradeable(symbol);

    const quote = await this.quote(symbol, amountInWeth);
    if (!quote) throw new Error(`trade refused: no live pool for ${symbol}/WETH`);
    if (quote.effectiveSpreadBps > GUARDRAILS.slippageCapPct * 10_000) {
      throw new Error(
        `trade refused: effective spread ${quote.effectiveSpreadBps.toFixed(0)}bps exceeds the ` +
          `${GUARDRAILS.slippageCapPct * 100}% slippage cap (thin pool)`,
      );
    }
    const feeTier = (quote.feeBps * 100) as (typeof V3_FEE_TIERS)[number];
    const amountInWei = parseEther(String(amountInWeth));
    const minOutTokens = quote.amountOutTokens * (1 - GUARDRAILS.slippageCapPct);
    const minOutWei = parseEther(minOutTokens.toFixed(18));

    const allowance = await this.publicClient.readContract({
      address: RWA_INFRA.weth, abi: ERC20_ABI, functionName: "allowance",
      args: [this.address, this.routerAddr],
    });
    if (allowance < amountInWei) {
      const approveTx = await this.wallet.writeContract({
        chain: this.wallet.chain, account: this.account,
        address: RWA_INFRA.weth, abi: ERC20_ABI, functionName: "approve",
        args: [this.routerAddr, amountInWei * 16n],
      });
      await this.publicClient.waitForTransactionReceipt({ hash: approveTx });
    }

    const data = buildExactInputSingle({
      tokenIn: RWA_INFRA.weth, tokenOut: token, feeTier,
      recipient: this.address, amountInWei, minAmountOutWei: minOutWei,
    });
    const txHash = await this.wallet.sendTransaction({
      chain: this.wallet.chain, account: this.account, to: this.routerAddr, data,
    });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      txHash, symbol, side: "buy", amountInWeth,
      minOutTokens, effectiveSpreadBps: quote.effectiveSpreadBps,
    };
  }
}
