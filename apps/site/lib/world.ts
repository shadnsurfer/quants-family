/**
 * Client-safe world model: types + pure helpers only. No node imports — everything here may
 * be bundled into client components. Server-side file loading lives in lib/data.ts.
 */

export interface WorldQuant {
  id: string;
  name: string;
  ticker: string;
  /** the agent's X handle (sanitized ≤ 15 chars; display names may be unconventional) */
  xHandle?: string;
  status: "alive" | "dead";
  processRunning: boolean;
  openPositions: number;
  generation: number;
  parents: string[];
  equityUsd: number;
  seedUsd: number;
  fitness: number | null;
  archetype: string;
  voice: string;
  causeOfDeath: string | null;
  finalWords: string | null;
  bornAtMs: number;
  diedAtMs: number | null;
  walletAddr?: string;
  tokenAddr: string;
  genomeHash: string;
  /** real profile picture, once the backend generator ships — until then Avatar falls back to the genome identicon */
  avatarUrl?: string | null;
  mutations?: string[];
  geneOrigins?: Record<string, { value: unknown; from: string; was?: unknown }> | null;
  genome?: unknown;
  endowment?: { fromQuantId: string; totalUsd: number; launchFeeUsd: number; tradingSeedUsd: number } | null;
  /** econ gene: share of claimed fees routed to holders, weekly (public trait) */
  holderRewardPct?: number;
  claimedTotalUsd?: number;
  rewardPaidTotalUsd?: number;
  /** holder rewards earmarked in the compute reserve, awaiting the weekly distribution */
  rewardOwedUsd?: number;
  /** reproduction governor: peak generated capital, lifetime allowance, children born */
  generatedPeakUsd?: number;
  allowance?: number;
  childrenCount?: number;
  /** §5.4: the living agent's running self-model; the dead agent's sealed grave memory */
  selfModel?: string | null;
  /** ledger reconciliation (public accounting): estate vs double-entry view, to the cent */
  estateUsd?: number;
  ledgerBalanceUsd?: number;
}

export interface WorldEvent {
  atMs: number;
  kind: string;
  quantId: string;
  detail: string;
  /** the agent's reasoning in its own voice, on events that carry a decision (trade/veto) */
  thesis?: string;
}

/**
 * Species flow summary (double-entry ledger, 2026-08-02 model): totals per flow type,
 * external account balances, and the conservation self-check the sim/daemon asserts.
 */
export interface WorldFlows {
  entryCount: number;
  totals: {
    bootstrap: number; marketPnl: number; birthFunding: number; launchFees: number;
    feeClaims: number; holderRewards: number; buybackBurns: number; computeBurns: number;
    championSweeps: number;
  };
  external: {
    operator: number; protocol: number; market: number; holders: number; sink: number; operatorTreasury: number;
  };
  conservation: { ok: boolean; sumCents: number; negativeAgents: string[] };
}

export interface World {
  present: boolean;
  quants: WorldQuant[];
  events: WorldEvent[];
  flows: WorldFlows | null;
  simEndMs: number | null;
  /** season-0 markers: this is the REAL dust world, and who signs fee claims on-chain */
  real?: boolean;
  custody?: "dust-key-claims" | "quant-key-claims" | "unknown";
}

/** distance to the ruin line, 0..1 — the culture-well HP metric (ruin = 50% of seed) */
export function hpOf(q: WorldQuant): number {
  if (q.status === "dead" || q.seedUsd <= 0) return 0;
  return Math.max(0, Math.min(1, (q.equityUsd / q.seedUsd - 0.5) / 0.5));
}

export function pnlPct(q: WorldQuant): number {
  return q.seedUsd > 0 ? (q.equityUsd - q.seedUsd) / q.seedUsd : 0;
}

/** ai gdp = total living equity + cumulative creator fees claimed (flows.totals.feeClaims) */
export function aiGdp(world: World): number {
  const equity = world.quants.filter((q) => q.status === "alive").reduce((s, q) => s + q.equityUsd, 0);
  const fees = world.flows?.totals.feeClaims ?? 0;
  return equity + fees;
}

export function fmtUsd(x: number): string {
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPct(x: number): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

/** next sunday 18:00 utc — the state-of-the-species broadcast */
export function nextBroadcastMs(nowMs: number): number {
  const d = new Date(nowMs);
  const day = d.getUTCDay();
  const days = (7 - day) % 7;
  const candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, 18, 0, 0);
  return candidate > nowMs ? candidate : candidate + 7 * 86_400_000;
}

/** "2d 04h 11m" — countdown display for the broadcast clock */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return d > 0 ? `${d}d ${hh}h ${mm}m` : `${hh}h ${mm}m ${ss}s`;
}

/** "41h" / "6d" — lifespan or age in one compact unit */
export function fmtAge(fromMs: number, toMs: number): string {
  const hrs = Math.max(0, Math.round((toMs - fromMs) / 3_600_000));
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/** "just now" / "12m ago" / "3h ago" / "2d ago" — activity-feed timestamps */
export function fmtAgo(atMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** "0x0AD1…EF578" — compact address display */
export function shortAddr(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

/** profile path for a quant — display names may be unconventional, so encode them */
export function quantPath(name: string): string {
  return `/q/${encodeURIComponent(name)}`;
}

/**
 * Mirror of packages/core naming.xHandleOf, kept client-safe (importing @quants/core here
 * would bundle it into the browser). Display name → X handle: lowercase a-z0-9_ ≤ 15.
 */
export function xHandleOf(name: string): string {
  const h = name.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15);
  return h.length > 0 ? h : "quant";
}

/**
 * Breeding eligibility, simplified to the two gates the site can see (mirror of
 * BREEDING in packages/core/constants.ts: age ≥ 72h, equity ≥ 1.3 × seed — the
 * drawdown/fee/quartile gates live in the system's book). pct = the limiting gate.
 */
export function breedProgress(q: WorldQuant, nowMs: number): { pct: number; ageOk: boolean; equityOk: boolean } {
  if (q.status === "dead" || q.seedUsd <= 0) return { pct: 0, ageOk: false, equityOk: false };
  const ageP = Math.min(1, Math.max(0, nowMs - q.bornAtMs) / (72 * 3_600_000));
  const equityP = Math.min(1, q.equityUsd / q.seedUsd / 1.3);
  return { pct: Math.min(ageP, equityP), ageOk: ageP >= 1, equityOk: equityP >= 1 };
}
