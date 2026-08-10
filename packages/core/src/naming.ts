/**
 * Naming — the parent's design voice (Charles directive 2026-08-02).
 *
 * A child is named by its PARENT, not drawn from a list: lineage blends, leetspeak, pure random
 * strings, symbol-sprinkled freak names, meme doubles — unconventional names are welcome because
 * attention is a selection factor. Sports (archetype flips) deliberately get freak names more
 * often: the freaks are how the species finds new edges, and edges deserve to be noticed.
 *
 * Display names are free-form; everything derived is sanitized:
 *   ticker  — A-Z0-9 only, ≤ 6 chars, unique in-population
 *   id      — g{gen}-{slug}, lowercase a-z0-9 + dashes (safe for keystore filenames), unique
 *   xHandle — lowercase a-z0-9_ ≤ 15 (X's rules), unique-ified with digits
 * All randomness flows through an explicit Rng — deterministic under a fixed seed.
 */
import type { Genome } from "./genome.js";
import { pick, type Rng } from "./rng.js";
import { QUANT_WORDLIST } from "./wordlist.js";

export interface ChildIdentity {
  /** the display name — free-form, possibly unconventional ("superbob", "d$f<>") */
  name: string;
  ticker: string;
  id: string;
  xHandle: string;
}

export interface NamingContext {
  parent: Genome;
  rng: Rng;
  gen: number;
  /** the child flipped an archetype — freak names get more likely */
  sport: boolean;
  takenNames: ReadonlySet<string>; // case-insensitive
  takenIds: ReadonlySet<string>;
  takenTickers: ReadonlySet<string>;
}

const LEET: Readonly<Record<string, string>> = {
  a: "4", e: "3", i: "1", o: "0", s: "$", t: "7", l: "1", g: "9", b: "8", z: "2",
};
const FREAK_SYMBOLS = "$<>_-*+.#";
const VOWELS = "aeiou";
const CONSONANTS = "bcdfghjklmnpqrstvwxz";

function leetify(word: string, rng: Rng): string {
  const chars = word.toLowerCase().split("");
  const spots = chars.map((c, i) => (LEET[c] ? i : -1)).filter((i) => i >= 0);
  if (spots.length === 0) return word.toLowerCase();
  const n = 1 + Math.floor(rng() * Math.min(2, spots.length));
  for (let k = 0; k < n; k++) {
    const i = spots[Math.floor(rng() * spots.length)]!;
    chars[i] = LEET[chars[i]!]!;
  }
  return chars.join("");
}

function randomWord(rng: Rng): string {
  const len = 4 + Math.floor(rng() * 4); // 4–7
  let out = "";
  for (let i = 0; i < len; i++) {
    const pool = i % 2 === 0 ? CONSONANTS : VOWELS;
    out += pool[Math.floor(rng() * pool.length)];
  }
  return out;
}

function freakify(rng: Rng): string {
  const base = rng() < 0.5 ? randomWord(rng).slice(0, 4) : pick(rng, QUANT_WORDLIST).slice(0, 5);
  const n = 1 + Math.floor(rng() * 3); // 1–3 symbol injections
  const chars = base.split("");
  for (let k = 0; k < n; k++) {
    const sym = FREAK_SYMBOLS[Math.floor(rng() * FREAK_SYMBOLS.length)]!;
    const at = Math.floor(rng() * (chars.length + 1));
    chars.splice(at, 0, sym);
  }
  return chars.join("");
}

function blend(parentName: string, rng: Rng): string {
  const p = parentName.toLowerCase();
  const w = pick(rng, QUANT_WORDLIST);
  const form = rng();
  if (form < 0.25) return `${pick(rng, ["super", "mc", "ultra", "neo", "proto"])}${p}`;
  if (form < 0.55) return `${p}${pick(rng, ["tron", "bot", "ox", "jr", "son", "2.0", "x"])}`;
  if (form < 0.8) return `${p.slice(0, Math.max(2, Math.ceil(p.length / 2)))}${w}`;
  return `${w}${p.slice(0, Math.max(2, Math.ceil(p.length / 2)))}`;
}

function meme(rng: Rng): string {
  const w = pick(rng, QUANT_WORDLIST);
  const form = rng();
  if (form < 0.3) return "superbob";
  if (form < 0.5) return pick(rng, ["bob", "kevin", "steve"]);
  if (form < 0.7) return `lil ${w}`;
  if (form < 0.9) return `big ${w}`;
  return `${w}y mc${w}face`;
}

/** One raw name proposal for the given pattern mix (sport shifts weight to the freak lane). */
function proposeName(parentName: string, rng: Rng, sport: boolean): string {
  const r = rng();
  const [blendW, leetW, randW, freakW] = sport ? [0.2, 0.2, 0.15, 0.3] : [0.4, 0.15, 0.15, 0.15];
  if (r < blendW) return blend(parentName, rng);
  if (r < blendW + leetW) return leetify(rng() < 0.6 ? parentName : pick(rng, QUANT_WORDLIST), rng);
  if (r < blendW + leetW + randW) return randomWord(rng);
  if (r < blendW + leetW + randW + freakW) return freakify(rng);
  return meme(rng);
}

/** Display name → ticker: A-Z0-9 only, ≤ 6 chars, "QNT" when nothing survives. */
export function tickerOf(name: string): string {
  const t = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return t.length > 0 ? t : "QNT";
}

/** Display name → id slug: lowercase a-z0-9 runs joined by dashes, "x" when nothing survives. */
export function slugOf(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : "x";
}

/** Display name → X handle: lowercase a-z0-9_ ≤ 15 chars (X's limit), "quant" fallback. */
export function xHandleOf(name: string): string {
  const h = name.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15);
  return h.length > 0 ? h : "quant";
}

/**
 * The parent designs its child's identity. Retries proposals until the name is unique
 * (case-insensitive) in the population, then derives a collision-safe ticker, id, and handle.
 * Deterministic under the given Rng.
 */
export function designChildIdentity(ctx: NamingContext): ChildIdentity {
  const takenNames = new Set([...ctx.takenNames].map((n) => n.toLowerCase()));

  let name = "";
  for (let attempt = 0; attempt < 48; attempt++) {
    const proposal = proposeName(ctx.parent.meta.name, ctx.rng, ctx.sport);
    const candidate = attempt < 24 ? proposal : `${proposal}${ctx.gen}${attempt - 23}`;
    if (!takenNames.has(candidate.toLowerCase())) {
      name = candidate;
      break;
    }
  }
  if (!name) name = `${randomWord(ctx.rng)}${ctx.gen}`;

  let ticker = tickerOf(name);
  for (let d = 2; ctx.takenTickers.has(ticker) && d < 100; d++) {
    const base = tickerOf(name).slice(0, 5);
    ticker = `${base}${d}`.slice(0, 6);
  }

  let slug = slugOf(name);
  let id = `g${ctx.gen}-${slug}`;
  for (let d = 2; ctx.takenIds.has(id); d++) {
    id = `g${ctx.gen}-${slug}-${d}`;
  }

  let xHandle = xHandleOf(name);
  const takenHandles = new Set(
    [...ctx.takenNames].map((n) => xHandleOf(n)),
  );
  for (let d = 2; takenHandles.has(xHandle) && d < 100; d++) {
    xHandle = `${xHandleOf(name).slice(0, 13)}${d}`.slice(0, 15);
  }

  return { name, ticker, id, xHandle };
}
