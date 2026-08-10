/**
 * Flow desk — on-chain flow research (chain-native, deterministic, no browsing, no injection
 * surface). Reads what actually exists 24/7 where the quants live: pool swap volume, buy/sell
 * imbalance, holder growth, and fee velocity per stock token, from Uniswap v3 Swap events and
 * ERC-20 Transfer counts. Feeds a `FlowSignal` the reasoning gate can weigh — a genuinely
 * different research axis from pure price action, with zero web dependency.
 *
 * The MATH (imbalance → conviction, volume → confidence) is pure and unit-tested; the network
 * reads are a thin viem layer around it. Paper mode uses a deterministic synthetic desk so
 * sims stay byte-identical.
 */
import { parseAbi, type Address, type PublicClient } from "viem";
import { seededRng } from "@quants/core";

export interface FlowWindow {
  /** net taker flow in the window: buys − sells, in quote (WETH) units */
  netFlowWeth: number;
  /** gross two-sided volume, quote units */
  grossVolumeWeth: number;
  /** distinct addresses that received the token in the window (holder-growth proxy) */
  newHolders: number;
  /** creator-fee accrual rate over the window, quote units/hour (charisma-adjacent) */
  feeVelocityWethPerHour: number;
}

export interface FlowSignal {
  symbol: string;
  /** −1..1: sell-dominated → buy-dominated (netFlow / grossVolume) */
  imbalance: number;
  /** 0..1 confidence that there is enough flow to trust the imbalance */
  confidence: number;
  /** 0..1 accumulation pressure blending imbalance, holder growth, fee velocity */
  accumulation: number;
  window: FlowWindow;
}

/**
 * Pure flow math — the desk's brain. Deterministic, no I/O. `refVolumeWeth` normalizes
 * confidence: flow at or above the reference is fully trusted, below it scales down.
 */
export function analyzeFlow(symbol: string, w: FlowWindow, refVolumeWeth = 5): FlowSignal {
  const imbalance = w.grossVolumeWeth > 0 ? clamp(w.netFlowWeth / w.grossVolumeWeth, -1, 1) : 0;
  const confidence = clamp(w.grossVolumeWeth / refVolumeWeth, 0, 1);
  // accumulation: buy pressure, weighted by how much flow backs it, plus small holder/fee bonuses
  const holderBonus = clamp(w.newHolders / 50, 0, 0.2);
  const feeBonus = clamp(w.feeVelocityWethPerHour / 0.05, 0, 0.15);
  const accumulation = clamp(
    ((imbalance + 1) / 2) * confidence + (imbalance > 0 ? holderBonus + feeBonus : 0),
    0,
    1,
  );
  return { symbol, imbalance, confidence, accumulation, window: w };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** The desk interface the runtime consumes — paper and live share it. */
export interface FlowDesk {
  read(symbol: string, tick: number): Promise<FlowSignal> | FlowSignal;
}

/**
 * Deterministic paper desk: seeded, market-shaped flow that trends with a symbol's tick so
 * sims are reproducible and flow-aware quants behave distinctly without a chain.
 */
export class PaperFlowDesk implements FlowDesk {
  read(symbol: string, tick: number): FlowSignal {
    const r = seededRng(`flow:${symbol}:${Math.floor(tick / 3)}`);
    const gross = 1 + r() * 9;
    const net = (r() - 0.45) * gross; // slight buy bias baseline
    const window: FlowWindow = {
      netFlowWeth: net,
      grossVolumeWeth: gross,
      newHolders: Math.floor(r() * 40),
      feeVelocityWethPerHour: r() * 0.06,
    };
    return analyzeFlow(symbol, window, 5);
  }
}

const SWAP_ABI = parseAbi([
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);
const TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/**
 * Live flow desk: reconstructs a FlowWindow from Uniswap v3 Swap logs (net/gross flow) and
 * ERC-20 Transfer logs (new-holder proxy) over the last `windowBlocks`. Read-only — this never
 * signs anything, so it needs no wallet and no live gate. `blocksPerHour` scales the fee
 * velocity to an honest per-hour rate (default 1,800 ≈ 2s blocks — L2 estimate).
 */
export class LiveFlowDesk implements FlowDesk {
  constructor(
    private readonly client: PublicClient,
    private readonly poolOf: (symbol: string) => { pool: Address; token: Address; tokenIsToken0: boolean } | null,
    private readonly windowBlocks = 300n,
    private readonly blocksPerHour = 1_800n,
  ) {}

  async read(symbol: string, _tick: number): Promise<FlowSignal> {
    const p = this.poolOf(symbol);
    if (!p) return analyzeFlow(symbol, { netFlowWeth: 0, grossVolumeWeth: 0, newHolders: 0, feeVelocityWethPerHour: 0 });
    const head = await this.client.getBlockNumber();
    const fromBlock = head > this.windowBlocks ? head - this.windowBlocks : 0n;

    const [swaps, transfers] = await Promise.all([
      this.client.getLogs({ address: p.pool, event: SWAP_ABI[0], fromBlock, toBlock: head }),
      this.client.getLogs({ address: p.token, event: TRANSFER_ABI[0], fromBlock, toBlock: head }),
    ]);

    let net = 0, gross = 0;
    for (const s of swaps) {
      // quote (WETH) leg is whichever side is NOT the token
      const quoteDelta = p.tokenIsToken0 ? s.args.amount1! : s.args.amount0!;
      const q = Number(quoteDelta) / 1e18;
      gross += Math.abs(q);
      // taker paid quote in (positive to pool) → a BUY of the token
      net += q;
    }
    const recipients = new Set(transfers.map((t) => t.args.to));
    // 1% pool fee accrual proxy, scaled from the block window to an actual per-hour rate
    const windowsPerHour = Number(this.blocksPerHour) / Number(this.windowBlocks);
    const window: FlowWindow = {
      netFlowWeth: net,
      grossVolumeWeth: gross,
      newHolders: recipients.size,
      feeVelocityWethPerHour: gross > 0 ? gross * 0.01 * windowsPerHour : 0,
    };
    return analyzeFlow(symbol, window, 5);
  }
}
