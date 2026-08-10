/**
 * Pons launchpad adapter surface (PROJECT.md §7). One transaction deploys a fixed-supply
 * token + a locked Uniswap v3 WETH pool + an immutable creator-fee wallet. Two impls:
 * PonsMock (paper/CI) and PonsLive (M5+, real chain, human-gated).
 */

export interface TokenMeta {
  name: string;
  ticker: string;
}

export interface PonsLaunchResult {
  tokenAddr: `0x${string}`;
  poolAddr: `0x${string}`;
  tx: string;
}

export interface CreatorFees {
  /** claimable fees on the token side, in whole-token units */
  tokenFees: number;
  /** claimable fees on the WETH side, in ETH units */
  wethFees: number;
}

export interface PonsClaimResult extends CreatorFees {
  tx: string;
}

export interface PonsAdapter {
  /** Deploy token + locked pool; creator-fee wallet is immutable after this call. */
  launch(meta: TokenMeta, feeWallet: `0x${string}`, devBuyEth: number): Promise<PonsLaunchResult>;
  /** Claim all accrued creator fees to the fee wallet. */
  claimFees(tokenAddr: `0x${string}`): Promise<PonsClaimResult>;
  /** Read accrued-but-unclaimed creator fees. */
  readCreatorFees(tokenAddr: `0x${string}`): Promise<CreatorFees>;
}

/** Launch fee charged by Pons, in ETH (PROJECT.md §0). */
export const PONS_LAUNCH_FEE_ETH = 0.0005;
