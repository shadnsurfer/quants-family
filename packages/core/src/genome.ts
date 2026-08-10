/**
 * Genome schema (PROJECT.md §4.1) — the heritable material and nothing else.
 *
 * Risk guardrails are deliberately absent here: they live in constants.ts, frozen, outside
 * the reach of inheritance and mutation. Trade-time enforcement (position caps, halts,
 * symbol allow-list) happens in the execution layer against those constants, never in genome
 * validation. If a limit appears in this file, evolution could touch it — that is a bug.
 */
import { z } from "zod";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const EDGE_ARCHETYPES = ["momentum", "meanRevert", "breakout", "eventDriven"] as const;
export const VOICE_ARCHETYPES = ["stoic", "cocky", "unhinged", "philosopher", "doomer", "gremlin"] as const;
/**
 * Research style — how a quant reads the world beyond its own price signal (season 0):
 *   priceAction — ignores flow, trades the technical signal alone (the original behavior)
 *   flow        — weighs on-chain order flow / accumulation heavily
 *   hybrid      — blends its price signal with flow confirmation
 * Fundamentals/news are a later tier (a guarded research-desk service), deliberately out of
 * season 0 — no agent browses the web into a trade decision.
 */
export const RESEARCH_STYLES = ["priceAction", "flow", "hybrid"] as const;

export type EdgeArchetype = (typeof EDGE_ARCHETYPES)[number];
export type VoiceArchetype = (typeof VOICE_ARCHETYPES)[number];
export type ResearchStyle = (typeof RESEARCH_STYLES)[number];

export const GenomeMetaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ticker: z.string().min(1).max(6),
  generation: z.number().int().min(0), // gen 0 = the progenitor (eve) — the root of the lineage
  parents: z.array(z.string()),
  mutations: z.array(z.string()).default([]),
  birthTx: z.string().nullable().default(null),
  genomeHash: z.string().nullable().default(null),
});

/**
 * Strategy-math genes: the ACTUAL numbers each archetype's signal runs on. Every one is
 * heritable and mutable within its GENE_RANGES band — the strategies themselves evolve,
 * not just risk appetite. Defaults reproduce the original hardcoded signal constants.
 */
export const SignalGenesSchema = z.object({
  /** momentum: trailing-return window (ticks) and entry threshold (fraction) */
  momentumLookback: z.number().int().min(2).max(12).default(3),
  momentumEntryPct: z.number().min(0.005).max(0.05).default(0.015),
  /** meanRevert: rolling window (ticks) and entry z-score magnitude (enters at -z) */
  meanRevertWindow: z.number().int().min(5).max(30).default(10),
  meanRevertEntryZ: z.number().min(0.5).max(3).default(1.5),
  /** breakout: range window (ticks) and required volatility-expansion multiple */
  breakoutRange: z.number().int().min(6).max(30).default(12),
  breakoutExpansion: z.number().min(1.05).max(2.5).default(1.3),
  /** eventDriven: minimum gap (fraction) and boundary window as a multiple of cadence */
  eventGapPct: z.number().min(0.003).max(0.03).default(0.008),
  eventWindowMult: z.number().min(0.25).max(3).default(1),
});

export type SignalGenes = z.infer<typeof SignalGenesSchema>;

/** Convenience for tests/fixtures: the default signal genome (original constants). */
export const DEFAULT_SIGNAL_GENES: SignalGenes = SignalGenesSchema.parse({});

export const EdgeGenesSchema = z.object({
  archetype: z.enum(EDGE_ARCHETYPES),
  /** stock-token symbols this quant watches; validated against the frozen allow-list at trade time */
  universe: z.array(z.string().min(1)).min(1),
  aggression: z.number().min(0.05).max(1),
  patience: z.object({
    minHoldMin: z.number().int().min(5).max(720),
    maxHoldHrs: z.number().int().min(1).max(168),
  }),
  /** stop-loss fraction per position */
  fear: z.number().min(0.01).max(0.25),
  /** take-profit fraction per position */
  conviction: z.number().min(0.02).max(0.5),
  /** decision loop interval, minutes */
  cadenceMin: z.number().int().min(5).max(240),
  /** 0..1 appetite for nights/weekends */
  darkHours: z.number().min(0).max(1),
  entryThesisStyle: z.string().min(1),
  /** the strategy's own evolving math (defaults fill for genesis files that omit it) */
  signal: SignalGenesSchema.default({}),
  /** research style: which data the quant weighs beyond its price signal */
  researchStyle: z.enum(RESEARCH_STYLES).default("priceAction"),
  /** 0..1 how strongly on-chain flow moves the gate's conviction (0 = ignores flow) */
  flowWeight: z.number().min(0).max(1).default(0),
  /** 0..1 discount applied to flow that disagrees with the price signal (skepticism) */
  flowSkepticism: z.number().min(0).max(1).default(0.5),
});

export const VoiceGenesSchema = z.object({
  archetype: z.enum(VOICE_ARCHETYPES),
  postsPerDay: z.number().int().min(1).max(24),
  flexStyle: z.string().min(1),
  beefiness: z.number().min(0).max(1),
  lowercase: z.boolean(),
  emojiPolicy: z.string().min(1),
});

/**
 * Econ genes (Charles 2026-08-02): how the quant shares its fee earnings with its holders.
 * holderRewardPct is heritable and mutable at design time; after birth the agent may RAISE it
 * (never lower) — the anti-rug rule. Displayed publicly on the agent's stats.
 */
export const EconGenesSchema = z.object({
  /** 0..0.4 of claimed creator fees distributed pro-rata to registered token holders, weekly */
  holderRewardPct: z.number().min(0).max(0.4).default(0.2),
});

export type EconGenes = z.infer<typeof EconGenesSchema>;

export const GenomeSchema = z.object({
  meta: GenomeMetaSchema,
  edge: EdgeGenesSchema,
  econ: EconGenesSchema.default({}),
  voice: VoiceGenesSchema,
});

export type Genome = z.infer<typeof GenomeSchema>;
export type GenomeInput = z.input<typeof GenomeSchema>;

/** Parse + validate an untrusted genome (JSON file, DB row). Throws ZodError on violation. */
export function parseGenome(data: unknown): Genome {
  return GenomeSchema.parse(data);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/**
 * Canonical JSON for hashing: deep-sorted keys, with the two birth-time fields
 * (meta.birthTx, meta.genomeHash) nulled so the hash is defined before either exists.
 */
export function canonicalGenomeJson(genome: Genome): string {
  const g: Genome = {
    ...genome,
    meta: { ...genome.meta, birthTx: null, genomeHash: null },
  };
  return JSON.stringify(sortKeysDeep(g));
}

/** keccak256 of the canonical JSON — stored in meta.genomeHash at birth, emitted on-chain in live mode. */
export function genomeHash(genome: Genome): `0x${string}` {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(canonicalGenomeJson(genome))))}`;
}
