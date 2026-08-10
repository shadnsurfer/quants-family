/**
 * Breeding: eligibility, brood size, inheritance, mutation, child naming (PROJECT.md §4.4).
 * All randomness flows through an explicit Rng — deterministic under a fixed seed.
 */
import { BREEDING, GENE_RANGES, MUTATION, offspringAllowance } from "./constants.js";
import { EDGE_ARCHETYPES, RESEARCH_STYLES, VOICE_ARCHETYPES, type Genome } from "./genome.js";
import { pick, type Rng } from "./rng.js";
import { usdToCents } from "./flows.js";
import type { BreedingCandidate, EligibilityFailure, EligibilityResult } from "./types.js";
import { GENESIS_NAMES, QUANT_WORDLIST } from "./wordlist.js";

const HOUR_MS = 3_600_000;

/**
 * Top-quartile membership: rank living quants by fitness DESC (ties broken by id ASC for
 * determinism); the top ceil(n * 0.25) ids are in the quartile — but never fewer than
 * BREEDING.topQuartileMinSlots (capped by n): in a small arena the floor keeps reproduction
 * from collapsing into a champion monopoly. n=1 → that one quant is in it.
 */
export function topQuartileIds(fitnessById: ReadonlyMap<string, number>): Set<string> {
  const ranked = [...fitnessById.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const take = Math.min(
    ranked.length,
    Math.max(BREEDING.topQuartileMinSlots, Math.ceil(ranked.length * BREEDING.topQuartileFraction)),
  );
  return new Set(ranked.slice(0, take).map(([id]) => id));
}

/**
 * All conditions (PROJECT.md §4.4, amended 2026-08-02) — health gates plus the lifetime
 * offspring allowance:
 *   1. age ≥ 72h                       (exactly 72h → passes)
 *   2. equity ≥ 1.3 × seed             (exactly 1.3× → passes; compared in whole cents)
 *   3. maxDrawdown < 0.40              (exactly 0.40 → FAILS)
 *   4. id ∈ top quartile by fitness    ("only the successful spawn"; floored at
 *      BREEDING.topQuartileMinSlots slots so small arenas keep ≥ 2 eligible)
 *   5. lastBroodAtMs null, or nowMs - lastBroodAtMs ≥ 72h in ms
 *   6. childrenBorn < offspringAllowance(lifetimeGeneratedPeakUsd)
 * Returns every failed condition's reason code, not just the first.
 */
export function checkEligibility(
  candidate: BreedingCandidate,
  fitnessById: ReadonlyMap<string, number>,
  nowMs: number,
): EligibilityResult {
  const failed: EligibilityFailure[] = [];
  if (!(candidate.ageHours >= BREEDING.minAgeHours)) {
    failed.push("too-young");
  }
  const equityCents = usdToCents(candidate.equityUsd);
  const minEquityCents = usdToCents(candidate.seedUsd * BREEDING.minEquityMultipleOfSeed);
  if (!(equityCents >= minEquityCents)) {
    failed.push("equity-below-1.3x-seed");
  }
  if (!(candidate.maxDrawdown < BREEDING.maxDrawdownLimit)) {
    failed.push("drawdown-too-deep");
  }
  if (!topQuartileIds(fitnessById).has(candidate.id)) {
    failed.push("not-top-quartile");
  }
  const cooldownMs = BREEDING.cooldownHours * HOUR_MS;
  if (candidate.lastBroodAtMs !== null && nowMs - candidate.lastBroodAtMs < cooldownMs) {
    failed.push("cooldown");
  }
  if (!(candidate.childrenBorn < offspringAllowance(candidate.lifetimeGeneratedPeakUsd))) {
    failed.push("allowance-exhausted");
  }
  return { id: candidate.id, eligible: failed.length === 0, failed };
}

/**
 * The heritable gene units — the registry the inheritance report (selfGeneOrigins) and the
 * test suites walk. Under the lineage model a child starts as an exact copy of its parent;
 * every unit is "parent" unless the mutation log touched it.
 * (universe inherits as a whole list; patience/signal inherit per subfield.)
 */
export const INHERIT_UNITS = Object.freeze([
  "edge.archetype",
  "edge.universe",
  "edge.aggression",
  "edge.patience.minHoldMin",
  "edge.patience.maxHoldHrs",
  "edge.fear",
  "edge.conviction",
  "edge.cadenceMin",
  "edge.darkHours",
  "edge.entryThesisStyle",
  "edge.signal.momentumLookback",
  "edge.signal.momentumEntryPct",
  "edge.signal.meanRevertWindow",
  "edge.signal.meanRevertEntryZ",
  "edge.signal.breakoutRange",
  "edge.signal.breakoutExpansion",
  "edge.signal.eventGapPct",
  "edge.signal.eventWindowMult",
  "edge.researchStyle",
  "edge.flowWeight",
  "edge.flowSkepticism",
  "econ.holderRewardPct",
  "voice.archetype",
  "voice.postsPerDay",
  "voice.flexStyle",
  "voice.beefiness",
  "voice.lowercase",
  "voice.emojiPolicy",
] as const);

function getAtPath(genome: Genome, path: string): unknown {
  let cur: unknown = genome;
  for (const part of path.split(".")) cur = (cur as Record<string, unknown>)[part];
  return cur;
}

/**
 * Asexual inheritance (lineage model): the child IS the parent, deep-copied, with fresh
 * meta — generation = parent + 1, parents = [parent.meta.id]. No inheritance randomness at
 * all: every gram of diversity comes from mutate(), which the breeder runs right after.
 */
export function spawnGenome(
  parent: Genome,
  child: { name: string; ticker: string; id: string },
): Genome {
  const out = structuredClone(parent);
  out.meta = {
    id: child.id,
    name: child.name,
    ticker: child.ticker,
    generation: parent.meta.generation + 1,
    parents: [parent.meta.id],
    mutations: [],
    birthTx: null,
    genomeHash: null,
  };
  return out;
}

/** Where one gene of a child came from. ("mate"/"both" are retired sexual-era values.) */
export interface GeneOrigin {
  value: unknown;
  from: "parent" | "mate" | "both" | "mutated";
  /** pre-mutation value when from === "mutated" */
  was?: unknown;
}

/**
 * Post-hoc inheritance report for a self-spawned child: every gene unit is the parent's
 * unless the child's mutation log touched it. This is what the dashboard renders per birth.
 */
export function selfGeneOrigins(parent: Genome, child: Genome): Record<string, GeneOrigin> {
  const mutatedPaths = new Map<string, string>();
  for (const line of child.meta.mutations) {
    const m = line.match(/^(?:SPORT: )?([a-zA-Z.]+): (.+?)→.+$/);
    if (m) mutatedPaths.set(m[1]!, m[2]!);
  }
  const out: Record<string, GeneOrigin> = {};
  for (const unit of INHERIT_UNITS) {
    const value = getAtPath(child, unit);
    if (mutatedPaths.has(unit)) {
      out[unit] = { value, from: "mutated", was: mutatedPaths.get(unit) };
      continue;
    }
    const same = JSON.stringify(getAtPath(parent, unit)) === JSON.stringify(value);
    // patience-fix and similar consistency repairs land here as "mutated" without a log hit
    out[unit] = { value, from: same ? "parent" : "mutated" };
  }
  return out;
}

/** Optional DNA-vote bias: scales the ±20% perturbation window per gene path (M3 wires this). */
export interface MutationBias {
  perturbScale?: Readonly<Record<string, number>>;
}

function getNumAtPath(genome: Genome, path: string): number {
  let cur: unknown = genome;
  for (const part of path.split(".")) {
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur !== "number") throw new Error(`gene path ${path} is not numeric`);
  return cur;
}

function setNumAtPath(genome: Genome, path: string, value: number): void {
  const parts = path.split(".");
  const last = parts[parts.length - 1]!;
  let cur: unknown = genome;
  for (const part of parts.slice(0, -1)) {
    cur = (cur as Record<string, unknown>)[part];
  }
  (cur as Record<string, number>)[last] = value;
}

/**
 * Mutation (PROJECT.md §4.4): each numeric gene in GENE_RANGES mutates with probability
 * MUTATION.geneChance; perturbation is value * (1 + uniform(-p, +p)) with
 * p = MUTATION.perturbFraction * (bias.perturbScale?.[path] ?? 1), clamped to the gene's range
 * (integer genes rounded). Each archetype gene (edge.archetype, voice.archetype) independently
 * flips with probability MUTATION.sportChance to a uniformly-picked DIFFERENT archetype — log
 * such flips prefixed "SPORT:". Every change appends a "path: old→new" line to the returned log
 * AND to the child's meta.mutations. Returns a new genome; never mutates the input.
 * Roll order (for seeded reproducibility): numeric genes in GENE_RANGES key order — for each,
 * one rng() call for the gate and, only if it mutates, one rng() for the delta — then
 * edge.archetype gate (+pick if flipped), then voice.archetype gate (+pick if flipped).
 * Afterwards (no rng consumed) patience consistency is enforced: minHoldMin ≤ maxHoldHrs*60.
 */
export function mutate(genome: Genome, rng: Rng, bias?: MutationBias): { genome: Genome; log: string[] } {
  const g = structuredClone(genome);
  const log: string[] = [];

  for (const path of Object.keys(GENE_RANGES)) {
    const range = GENE_RANGES[path]!;
    if (!(rng() < MUTATION.geneChance)) continue;
    const roll = rng();
    const p = MUTATION.perturbFraction * (bias?.perturbScale?.[path] ?? 1);
    const oldVal = getNumAtPath(g, path);
    const delta = (2 * roll - 1) * p;
    let next = oldVal * (1 + delta);
    next = Math.min(range.max, Math.max(range.min, next));
    if (range.integer) {
      next = Math.min(range.max, Math.max(range.min, Math.round(next)));
      // minimum-step rule: a fired mutation must MOVE an integer gene. Small values would
      // otherwise swallow ±20% in rounding (at 3, ~83% of fired gates changed nothing).
      // Step in the perturbation's direction; if the range boundary swallows that, step the
      // other way — any 2+-integer range always moves.
      if (next === oldVal) {
        const step = delta >= 0 ? 1 : -1;
        next = Math.min(range.max, Math.max(range.min, oldVal + step));
        if (next === oldVal) next = Math.min(range.max, Math.max(range.min, oldVal - step));
      }
    }
    if (next !== oldVal) {
      setNumAtPath(g, path, next);
      log.push(`${path}: ${oldVal}→${next}`);
    }
  }

  if (rng() < MUTATION.sportChance) {
    const oldArchetype = g.edge.archetype;
    const flipped = pick(rng, EDGE_ARCHETYPES.filter((a) => a !== oldArchetype));
    g.edge.archetype = flipped;
    log.push(`SPORT: edge.archetype: ${oldArchetype}→${flipped}`);
  }
  if (rng() < MUTATION.sportChance) {
    const oldArchetype = g.voice.archetype;
    const flipped = pick(rng, VOICE_ARCHETYPES.filter((a) => a !== oldArchetype));
    g.voice.archetype = flipped;
    log.push(`SPORT: voice.archetype: ${oldArchetype}→${flipped}`);
  }
  if (rng() < MUTATION.sportChance) {
    const oldStyle = g.edge.researchStyle;
    const flipped = pick(rng, RESEARCH_STYLES.filter((s) => s !== oldStyle));
    g.edge.researchStyle = flipped;
    log.push(`SPORT: edge.researchStyle: ${oldStyle}→${flipped}`);
  }

  const maxAllowedMinHold = g.edge.patience.maxHoldHrs * 60;
  if (g.edge.patience.minHoldMin > maxAllowedMinHold) {
    log.push(`patience-fix: minHoldMin ${g.edge.patience.minHoldMin}→${maxAllowedMinHold}`);
    g.edge.patience.minHoldMin = maxAllowedMinHold;
  }

  g.meta.mutations = [...g.meta.mutations, ...log];
  return { genome: g, log };
}

/**
 * Child naming from QUANT_WORDLIST with collision check against `taken` (case-insensitive;
 * GENESIS_NAMES are always considered taken). Start at an rng-picked index and probe forward
 * cyclically to the first free word. If the whole list is taken, suffix the generation number
 * (e.g. "ito7"). Ticker = name uppercased, truncated to 6 chars.
 */
export function childName(
  rng: Rng,
  taken: ReadonlySet<string>,
  generation: number,
): { name: string; ticker: string } {
  const reserved = new Set<string>(GENESIS_NAMES);
  for (const t of taken) reserved.add(t.toLowerCase());

  const n = QUANT_WORDLIST.length;
  const start = Math.floor(rng() * n) % n;
  for (let i = 0; i < n; i++) {
    const candidate = QUANT_WORDLIST[(start + i) % n]!;
    if (!reserved.has(candidate.toLowerCase())) {
      return { name: candidate, ticker: tickerOf(candidate) };
    }
  }
  const fallback = `${QUANT_WORDLIST[start]!}${generation}`;
  return { name: fallback, ticker: tickerOf(fallback) };
}

function tickerOf(name: string): string {
  return name.toUpperCase().slice(0, 6);
}
