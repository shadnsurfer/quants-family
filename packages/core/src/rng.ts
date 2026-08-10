/**
 * Seeded deterministic RNG (mulberry32). Everything evolutionary — inheritance draws,
 * mutation rolls, name picks — takes an explicit Rng so simulations and tests reproduce exactly.
 */

export type Rng = () => number;

/** mulberry32: fast, decent-quality 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash so string seeds ("sim-evolution-1") map to numeric seeds. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seededRng(seed: number | string): Rng {
  return mulberry32(typeof seed === "string" ? hashSeed(seed) : seed);
}

/** Uniform pick from a non-empty array. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pick: empty array");
  return arr[Math.floor(rng() * arr.length) % arr.length]!;
}
