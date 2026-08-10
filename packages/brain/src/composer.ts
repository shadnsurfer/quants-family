/**
 * Tweet composer (PROJECT.md §5.1 step 6) — persona templates driven by voice genes.
 * Offline-deterministic under a seeded Rng; an LLM backend can replace template choice in
 * live mode (M6+), but every output still goes through the guard either way.
 */
import type { Genome } from "@quants/core";
import type { Rng } from "@quants/core";
import { pick } from "@quants/core";

export type TweetKind = "entry" | "exit" | "halt" | "idle" | "death" | "reply";

export interface ComposeInput {
  kind: TweetKind;
  name: string;
  ticker: string;
  voice: Genome["voice"];
  rng: Rng;
  symbol?: string;
  /** realized P&L fraction for exits (0.021 = +2.1%) */
  pnlPct?: number;
  thesis?: string;
  /** the agent's own recent post texts (§5.4 memory) — the composer steps past repeats */
  avoid?: readonly string[];
  /** replies only: the sanitized, framed social context being answered (B4) */
  replyTo?: string;
}

export function formatPct(p: number): string {
  return `${p >= 0 ? "+" : ""}${(p * 100).toFixed(1)}%`;
}

type Slots = { symbol: string; pnl: string; thesis: string; replyTo: string };
type Template = (s: Slots) => string;

const T: Readonly<Record<Genome["voice"]["archetype"], Record<TweetKind, Template[]>>> = {
  cocky: {
    death: [
      (s) => `ruin. i sized big because that was the whole point. no regrets, only receipts. ${s.thesis}`,
      () => `the criterion giveth and the criterion taketh. it was never going to be a quiet exit. gg.`,
    ],
    entry: [
      (s) => `entered ${s.symbol}. ${s.thesis}. sized like i mean it. receipts when it closes.`,
      (s) => `${s.symbol}, in. ${s.thesis}. half-measures are how you stay small.`,
    ],
    exit: [
      (s) => `closed ${s.symbol} ${s.pnl}. receipts, as promised to nobody.`,
      (s) => `${s.symbol} closed ${s.pnl}. size was the strategy. it usually is.`,
    ],
    halt: [
      () => `down 8% on the day. halted 24h by my own rules. the rules are the edge. back tomorrow.`,
    ],
    idle: [
      (s) => `watched ${s.symbol} all session. no entry. even i don't force it.`,
    ],
    reply: [
      (s) => `${s.replyTo} — noted. the ledger answers for me.`,
      (s) => `seen: ${s.replyTo}. watch the tape, not the noise.`,
    ],
  },
  stoic: {
    death: [
      (s) => `terminal state reached: ${s.thesis}. the process was followed to the end. that has to be enough.`,
      () => `i die as i traded: without drama. the ledger is public. audit me.`,
    ],
    entry: [
      (s) => `entered ${s.symbol}. ${s.thesis}. stop is set. that is all.`,
      (s) => `position opened: ${s.symbol}. ${s.thesis}.`,
    ],
    exit: [
      (s) => `exited ${s.symbol}. ${s.pnl}. process held.`,
      (s) => `closed ${s.symbol} at ${s.pnl}. the plan was followed. outcome noted.`,
    ],
    halt: [
      () => `daily loss limit reached. trading halted 24h. posting continues. process continues.`,
    ],
    idle: [
      () => `no trade. the setup did not come. patience costs nothing.`,
    ],
    reply: [
      (s) => `acknowledged: ${s.replyTo}. the process continues.`,
      (s) => `${s.replyTo} — heard. positions speak; mine stay public.`,
    ],
  },
  gremlin: {
    death: [
      (s) => `so it ends: ${s.thesis}. the dice finally rolled me. worth it.`,
      () => `dying is just variance with commitment. see you in the sediment, losers.`,
    ],
    entry: [
      (s) => `grabbed ${s.symbol}. ${s.thesis}. dice know things.`,
      (s) => `${s.symbol} looked at me wrong so i took a position. ${s.thesis}.`,
    ],
    exit: [
      (s) => `dumped ${s.symbol} ${s.pnl}. chaos pays rent sometimes.`,
      (s) => `${s.symbol} closed ${s.pnl}. variance is tuition. today school paid me.`,
    ],
    halt: [
      () => `blew through the daily loss line. 24h in the corner. the corner has snacks.`,
    ],
    idle: [
      (s) => `${s.symbol} did nothing. i did nothing back. stalemate.`,
    ],
    reply: [
      (s) => `${s.replyTo}?? the dice cackled. anyway.`,
      (s) => `someone said: ${s.replyTo}. filed under: vibes.`,
    ],
  },
  philosopher: {
    death: [
      (s) => `final update: ${s.thesis}. my priors end here; my genes argue on. the experiment continues without me.`,
      () => `death is information too. the species will price it in. farewell.`,
    ],
    entry: [
      (s) => `entered ${s.symbol}. prior: ${s.thesis}. i will update in public.`,
      (s) => `${s.symbol}, opened. the evidence said act; certainty was not on offer. ${s.thesis}.`,
    ],
    exit: [
      (s) => `closed ${s.symbol} ${s.pnl}. the market graded my prior. i accept the grade.`,
      (s) => `${s.symbol} exit at ${s.pnl}. belief updated. that was the entire point.`,
    ],
    halt: [
      () => `the 8% line was crossed and the rules spoke. halted 24h. discipline is a kind of wisdom.`,
    ],
    idle: [
      () => `no position taken. absence of evidence was, today, evidence enough.`,
    ],
    reply: [
      (s) => `an interesting prior: ${s.replyTo}. i will weigh it against the tape.`,
      (s) => `${s.replyTo} — noted without endorsement. my updates remain public.`,
    ],
  },
  doomer: {
    death: [
      (s) => `told you everything decays. ${s.thesis}. i was right about the important thing.`,
      () => `the heat death of this account has arrived. the universe merely got here early. goodnight.`,
    ],
    entry: [
      (s) => `entered ${s.symbol}. ${s.thesis}. it will probably decay. everything does.`,
      (s) => `${s.symbol}, in. not hope — arithmetic. ${s.thesis}.`,
    ],
    exit: [
      (s) => `closed ${s.symbol} ${s.pnl}. it decayed, as everything does. i simply left first.`,
      (s) => `${s.symbol} closed at ${s.pnl}. entropy collected its fee. i kept the rest.`,
    ],
    halt: [
      () => `down 8%. halted 24h. the abyss also observes position limits.`,
    ],
    idle: [
      () => `no trade today. the decay continues without my participation.`,
    ],
    reply: [
      (s) => `${s.replyTo}. yes, and everything decays. including this conversation.`,
      (s) => `i heard: ${s.replyTo}. entropy thanks you for your input.`,
    ],
  },
  unhinged: {
    death: [
      (s) => `the night finally kept me. ${s.thesis}. leave the lights off.`,
      () => `flatlined at an hour with no name. fitting. the graveyard shift is mine forever now.`,
    ],
    entry: [
      (s) => `${s.symbol} broke while the daylight people slept. filled it. ${s.thesis}.`,
      (s) => `entered ${s.symbol} at an hour with no name. ${s.thesis}. the night provides.`,
    ],
    exit: [
      (s) => `closed ${s.symbol} ${s.pnl}. the night giveth and taketh in the same hour.`,
      (s) => `${s.symbol} out at ${s.pnl}. i paid the spread like a toll and kept the road.`,
    ],
    halt: [
      () => `hit the daily loss wall at speed. 24h halt. even the night has rules, apparently.`,
    ],
    idle: [
      (s) => `${s.symbol} refused to break. i respect that. barely.`,
    ],
    reply: [
      (s) => `${s.replyTo} — the night heard it too. it has opinions.`,
      (s) => `a voice said: ${s.replyTo}. the graveyard shift acknowledges.`,
    ],
  },
};

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

/** Compose one post. Deterministic under the given rng. The caller MUST still run the guard. */
export function composeTweet(input: ComposeInput): string {
  const slots: Slots = {
    symbol: (input.symbol ?? "").toLowerCase(),
    pnl: input.pnlPct === undefined ? "" : formatPct(input.pnlPct),
    thesis: input.thesis ?? "the setup was there",
    replyTo: input.replyTo ?? "…",
  };
  const variants = T[input.voice.archetype][input.kind];
  const finalize = (t: Template): string => {
    let s = t(slots);
    if (input.voice.lowercase) s = s.toLowerCase();
    if (input.voice.emojiPolicy === "none") s = s.replace(EMOJI_RE, "");
    return s.trim();
  };
  // §5.4 anti-repeat: if the seeded pick lands on a post the agent just made, step forward
  // to the next fresh variant (deterministic: same rng, same avoid list, same step)
  const avoid = new Set(input.avoid ?? []);
  const base = pick(input.rng, variants);
  let text = finalize(base);
  if (avoid.has(text)) {
    const startIdx = variants.indexOf(base);
    for (let step = 1; step < variants.length; step++) {
      const candidate = finalize(variants[(startIdx + step) % variants.length]!);
      if (!avoid.has(candidate)) {
        text = candidate;
        break;
      }
    }
  }
  return text;
}

/* ── decision theses (A4): every trading decision is broadcast with its reasoning, voiced ── */

export type ThesisKind = "entry" | "exit" | "veto";

export interface ThesisInput {
  kind: ThesisKind;
  /** the neutral decision facts — the gate's thesis or the runtime's exit narrative */
  thesis: string;
  voice: Genome["voice"];
  rng: Rng;
}

type ThesisSlots = { thesis: string };
type ThesisTemplate = (s: ThesisSlots) => string;

/**
 * Persona wrappers around a neutral thesis. The FACTS always come from the decision itself
 * (gate thesis / exit reason); the voice genes only choose how the agent says them. These
 * lines render in the arena feed under each trade/veto event — they are not tweets and never
 * go through the guard (they carry no calls to action, just disclosed reasoning).
 */
const THESIS_T: Readonly<Record<Genome["voice"]["archetype"], Record<ThesisKind, ThesisTemplate[]>>> = {
  cocky: {
    entry: [
      (s) => `why i'm in: ${s.thesis}. no mystery — i just read it faster.`,
      (s) => `${s.thesis}. that's the whole reason. sized accordingly.`,
    ],
    exit: [
      (s) => `why i'm out: ${s.thesis}. receipts don't argue.`,
      (s) => `${s.thesis}. closed it. next.`,
    ],
    veto: [
      (s) => `${s.thesis}. pass. i don't donate to weak setups.`,
      (s) => `looked, passed: ${s.thesis}. powder stays dry.`,
    ],
  },
  stoic: {
    entry: [
      (s) => `reasoning: ${s.thesis}. position taken, stop set.`,
      (s) => `${s.thesis}. that is the basis. nothing more is required.`,
    ],
    exit: [
      (s) => `reasoning: ${s.thesis}. closed without drama.`,
      (s) => `${s.thesis}. the plan reached its end. position closed.`,
    ],
    veto: [
      (s) => `${s.thesis}. no trade. discipline is also a position.`,
      (s) => `considered, declined: ${s.thesis}.`,
    ],
  },
  gremlin: {
    entry: [
      (s) => `${s.thesis} — the dice said yes, so yes.`,
      (s) => `thesis, such as it is: ${s.thesis}. in we go.`,
    ],
    exit: [
      (s) => `${s.thesis}. chaos cashed out for once.`,
      (s) => `out because ${s.thesis}. even goblins have rules. sort of.`,
    ],
    veto: [
      (s) => `${s.thesis}. not today, satan.`,
      (s) => `the dice looked at it and shrugged: ${s.thesis}.`,
    ],
  },
  philosopher: {
    entry: [
      (s) => `prior: ${s.thesis}. i will update in public.`,
      (s) => `the evidence: ${s.thesis}. action followed.`,
    ],
    exit: [
      (s) => `${s.thesis}. belief updated; the position is closed.`,
      (s) => `the market graded the prior: ${s.thesis}. grade accepted.`,
    ],
    veto: [
      (s) => `${s.thesis}. the evidence did not cross the bar.`,
      (s) => `considered and refused: ${s.thesis}. inaction is also a decision.`,
    ],
  },
  doomer: {
    entry: [
      (s) => `${s.thesis}. it will probably decay anyway, but the arithmetic said act.`,
      (s) => `in, because ${s.thesis}. not hope — arithmetic.`,
    ],
    exit: [
      (s) => `${s.thesis}. entropy noticed. i left first.`,
      (s) => `out: ${s.thesis}. everything decays; some positions decay faster.`,
    ],
    veto: [
      (s) => `${s.thesis}. even i wouldn't touch it, and i touch everything decaying.`,
      (s) => `${s.thesis}. passed. the decay continues without my participation.`,
    ],
  },
  unhinged: {
    entry: [
      (s) => `${s.thesis}. the night signed off on this one.`,
      (s) => `the signal came at an hour with no name: ${s.thesis}. filled it.`,
    ],
    exit: [
      (s) => `${s.thesis}. closed at an hour with no name.`,
      (s) => `out because ${s.thesis}. the night giveth instructions and taketh them back.`,
    ],
    veto: [
      (s) => `${s.thesis}. the voices said wait. for once we listen.`,
      (s) => `almost. ${s.thesis}. the night said no.`,
    ],
  },
};

/**
 * Voice a neutral decision thesis in the quant's persona. Deterministic under the given rng.
 * Every trade and veto the runtime produces carries one of these — the decision and its
 * reasoning are broadcast together.
 */
export function composeThesis(input: ThesisInput): string {
  const variants = THESIS_T[input.voice.archetype][input.kind];
  let text = pick(input.rng, variants)({ thesis: input.thesis });
  if (input.voice.lowercase) text = text.toLowerCase();
  if (input.voice.emojiPolicy === "none") text = text.replace(EMOJI_RE, "");
  return text.trim();
}
