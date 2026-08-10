/** System-side domain types: the orchestrator's view of the species. */
import type { DeathCause, GeneOrigin, Genome } from "@quants/core";

export type QuantStatus = "alive" | "dead";

/** One row of the system's book per quant — the sim/DB record, not the trading engine. */
export interface QuantRecord {
  id: string;
  name: string;
  ticker: string;
  /** the agent's X handle (sanitized ≤ 15 chars; unconventional display names welcome) */
  xHandle: string;
  generation: number;
  parents: string[];
  genome: Genome;
  genomeHash: string;
  status: QuantStatus;
  bornAtMs: number;
  diedAtMs: number | null;
  causeOfDeath: DeathCause | null;
  finalWords: string | null;
  /** original seed capital (fitness + death baselines) */
  seedUsd: number;
  processRunning: boolean;
  lastBroodAtMs: number | null;
  /** highest observed equity (drawdown baseline) */
  peakEquityUsd: number;
  /** charisma proxy: Pons creator-fee inflow rate */
  feeRatePerHourUsd: number;
  /** actual compute cost (VPS share + LLM spend; scales with cadence) */
  dailyBurnUsd: number;
  computeReserveUsd: number;
  unclaimedFeesUsd: number;
  /** the quant's own EVM wallet — creator-fee wallet at launch, trading wallet in live mode */
  walletAddr: string;
  /** per-gene inheritance report for bred quants (parent/mutated), null for genesis */
  geneOrigins?: Record<string, GeneOrigin> | null;
  /** the funding cascade: how this child was endowed from its parent's own balance */
  endowment?: {
    fromQuantId: string;
    totalUsd: number;
    launchFeeUsd: number;
    tradingSeedUsd: number;
  } | null;
  tokenAddr: string;
  poolAddr: string;
  birthTx: string;
  /** cumulative creator fees claimed, USD (monotonic) */
  claimedTotalUsd: number;
  /** cumulative holder rewards distributed, USD (monotonic) */
  rewardPaidTotalUsd: number;
  /** accrued holder rewards owed but not yet distributed, USD */
  rewardOwedUsd: number;
  /**
   * Peak lifetime generated capital, USD (monotonic): realized trading P&L + cumulative fees
   * claimed, at its historical maximum. The reproduction allowance is read from this peak —
   * milestones once earned are never revoked (§4.4).
   */
  generatedPeakUsd: number;
  /** children born to this quant (lifetime) */
  childrenCount: number;
  /** the parent's letter into this quant's initial self-model (§5.4), null for agent zero */
  birthLetter?: string | null;
  /** the sealed self-model published on the grave at death (§5.4), null while alive */
  sealedMemory?: string | null;
}

/**
 * Wallet issuance at birth. Sims inject a deterministic paper provider (reproducibility);
 * the live path routes through @quants/chain birthCustodyWallet (local keystore, or a
 * Turnkey enclave key per CUSTODY_MODE — only the address ever leaves either way).
 * Awaitable like PonsLike: turnkey birth is an API round-trip, so the executor awaits either.
 */
export type WalletProvider = (quantId: string) => string | Promise<string>;

export interface LaunchResult {
  tokenAddr: string;
  poolAddr: string;
  tx: string;
}

/**
 * Pons adapter surface the system needs for births (PROJECT.md §7). PaperPons fabricates
 * deterministic addresses synchronously; PonsLive (packages/chain) sends a real launch tx —
 * so the surface is awaitable and the birth executor awaits either.
 */
export interface PonsLike {
  launch(meta: { name: string; ticker: string }, feeWallet: string, devBuyEth: number): LaunchResult | Promise<LaunchResult>;
}

export interface EvolutionEvent {
  atMs: number;
  kind: "birth" | "death" | "fee-claim" | "trade" | "tweet" | "halt" | "reward" | "sweep" | "veto" | "milestone";
  quantId: string;
  detail: string;
  /**
   * The agent's reasoning in its own voice, when the event carries a decision (A4: every
   * trading decision — entry, exit, veto — is broadcast together with its thesis).
   */
  thesis?: string;
}
