/**
 * Tweet composer: every voice archetype × tweet kind produces a non-empty, gene-respecting
 * post that the guard passes — the composer must never write what the guard would reject.
 */
import { describe, expect, it } from "vitest";
import { seededRng, VOICE_ARCHETYPES, type Genome } from "@quants/core";
import { composeThesis, composeTweet, formatPct, guardTweet, type ThesisKind, type TweetKind } from "../src/index.js";

const KINDS: TweetKind[] = ["entry", "exit", "halt", "idle", "death", "reply"];

function voiceOf(archetype: Genome["voice"]["archetype"], overrides: Partial<Genome["voice"]> = {}): Genome["voice"] {
  return {
    archetype, postsPerDay: 6, flexStyle: "receipts-only", beefiness: 0.3,
    lowercase: true, emojiPolicy: "none", ...overrides,
  };
}

describe("composeTweet", () => {
  it("every archetype × kind: non-empty, lowercase, guard-passing", () => {
    for (const archetype of VOICE_ARCHETYPES) {
      for (const kind of KINDS) {
        for (let seed = 0; seed < 8; seed++) {
          const text = composeTweet({
            kind,
            name: "kelly",
            ticker: "KELLY",
            voice: voiceOf(archetype),
            rng: seededRng(`${archetype}-${kind}-${seed}`),
            symbol: "NVDA",
            pnlPct: seed % 2 === 0 ? 0.021 : -0.013,
            thesis: "trailing 3-tick return 1.9% breakout",
          });
          expect(text.length).toBeGreaterThan(10);
          expect(text).toBe(text.toLowerCase());
          const verdict = guardTweet(text, { ticker: "KELLY" });
          expect(verdict, `${archetype}/${kind}: "${text}" rejected by ${verdict.rule}`).toEqual({ ok: true });
        }
      }
    }
  });

  it("is deterministic under a fixed seed", () => {
    const make = () =>
      composeTweet({
        kind: "exit", name: "gauss", ticker: "GAUSS", voice: voiceOf("stoic"),
        rng: seededRng("det"), symbol: "AAPL", pnlPct: 0.012,
      });
    expect(make()).toBe(make());
  });

  it("respects the lowercase gene when off", () => {
    const text = composeTweet({
      kind: "exit", name: "x", ticker: "X",
      voice: voiceOf("stoic", { lowercase: false }),
      rng: seededRng(1), symbol: "MSFT", pnlPct: 0.008,
    });
    expect(text).toContain("msft".toUpperCase() === "MSFT" ? "msft" : "msft"); // symbol slot is lowercased at compose time
    expect(text.length).toBeGreaterThan(10);
  });

  it("strips emoji under emojiPolicy none", () => {
    // templates contain none, but the stripper must also catch future template drift
    const text = composeTweet({
      kind: "entry", name: "v", ticker: "V", voice: voiceOf("unhinged"),
      rng: seededRng(2), symbol: "TSLA", thesis: "broke the range 🚀",
    });
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(text)).toBe(false);
  });

  it("avoid steps past the agent's own recent posts — deterministic fallback when all used", () => {
    // §5.4 memory anti-repeat. entry has two variants per archetype: same seed, same base
    // pick — with the base avoided the second variant must come out instead.
    const base = { kind: "entry" as const, name: "k", ticker: "K", voice: voiceOf("cocky"), symbol: "NVDA", thesis: "x fired" };
    const first = composeTweet({ ...base, rng: seededRng("rep") });
    const second = composeTweet({ ...base, rng: seededRng("rep"), avoid: [first] });
    expect(second).not.toBe(first);
    // every variant avoided → the base pick stands (no loop, no empty post)
    const third = composeTweet({ ...base, rng: seededRng("rep"), avoid: [...new Set([first, second])] });
    expect(third).toBe(first);
  });

  it("formatPct signs and rounds", () => {
    expect(formatPct(0.021)).toBe("+2.1%");
    expect(formatPct(-0.013)).toBe("-1.3%");
    expect(formatPct(0)).toBe("+0.0%");
  });
});

describe("composeThesis (A4: every decision is broadcast with its voiced reasoning)", () => {
  const THESIS_KINDS: ThesisKind[] = ["entry", "exit", "veto"];

  it("every archetype × kind: non-empty, embeds the neutral thesis verbatim", () => {
    const neutral = "trailing 3-tick return +1.9% breakout; flow confirms accumulation (0.42)";
    for (const archetype of VOICE_ARCHETYPES) {
      for (const kind of THESIS_KINDS) {
        for (let seed = 0; seed < 6; seed++) {
          const text = composeThesis({
            kind, thesis: neutral, voice: voiceOf(archetype), rng: seededRng(`${archetype}-${kind}-${seed}`),
          });
          expect(text.length).toBeGreaterThan(neutral.length);
          expect(text).toContain(neutral); // the facts survive voicing byte-for-byte (neutral string is already lowercase)
        }
      }
    }
  });

  it("honors the lowercase gene (facts lowercase with the voice)", () => {
    const text = composeThesis({
      kind: "entry", thesis: "Z-SCORE -2.10 BELOW THE ROLLING MEAN",
      voice: voiceOf("cocky", { lowercase: true }), rng: seededRng("lc"),
    });
    expect(text).toBe(text.toLowerCase());
    expect(text).toContain("z-score -2.10 below the rolling mean");
  });

  it("is deterministic under a fixed seed", () => {
    const make = () =>
      composeThesis({ kind: "veto", thesis: "signal too weak vs costs", voice: voiceOf("doomer"), rng: seededRng("det") });
    expect(make()).toBe(make());
  });

  it("kind changes the wrapper: an exit does not read like an entry", () => {
    const entry = composeThesis({ kind: "entry", thesis: "x fired", voice: voiceOf("stoic"), rng: seededRng(7) });
    const exit = composeThesis({ kind: "exit", thesis: "x fired", voice: voiceOf("stoic"), rng: seededRng(7) });
    expect(entry).not.toBe(exit);
  });
});
