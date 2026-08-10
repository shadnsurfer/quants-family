/**
 * The §5.4 memory stack — indefinite computation without losing meaningful context.
 *
 * An agent runs forever; its LLM context is finite. Memory is layered and maintained by the
 * agent itself: an append-only episodic journal, rolling mechanical digests (day → week →
 * month), a versioned self-model doc, and birth letters inherited by children. Season 0 is
 * deterministic by design: digests, self-models and letters are written MECHANICALLY from
 * journal stats (no LLM spend) through the same seams a live backend will fill at M6+ —
 * exactly how the reasoning gate splits offline/online. Nothing here does IO; the runtime
 * owns persistence (session serialization) and the future DB phase (§9) owns scale.
 *
 * Retrieval is deterministic with per-call budgets: the trade gate gets compact counters +
 * recent digests; the post composer gets recent posts; review surfaces get the large window.
 */
export type JournalKind = "trade" | "veto" | "post" | "witness" | "birth" | "death" | "note";

export interface JournalEntry {
  atMs: number;
  kind: JournalKind;
  /** compact single line, ≤ 240 chars — the fact, never prose paragraphs */
  text: string;
  /** structured counter material: pnlUsd, pnlPct, symbol… (small, numeric-first) */
  data?: Record<string, number | string>;
}

export interface Digest {
  span: "day" | "week" | "month";
  /** the day index (ms / 86_400_000) the digest CLOSES */
  closesDay: number;
  text: string;
}

export interface MemoryCounters {
  trades: number;
  wins: number;
  losses: number;
  vetoes: number;
  posts: number;
  realizedPnlUsd: number;
  feesClaimedUsd: number;
  childrenHad: number;
  bestTradePct: number;
  worstTradePct: number;
  /** realized P&L by symbol — "what works for me" is read off this */
  pnlBySymbol: Record<string, number>;
}

export interface MemoryState {
  journal: JournalEntry[];
  /** rolling digests, oldest first; bounded per span */
  digests: Digest[];
  selfModel: { version: number; text: string; updatedAtMs: number };
  /** the letter this agent was born with (null for agent zero) */
  birthLetter: string | null;
  counters: MemoryCounters;
  /** day-index cursors for the rolling schedule */
  lastDigestDay: number;
  lastSelfModelDay: number;
}

const DAY_MS = 86_400_000;
const MAX_JOURNAL_ROWS = 10_000;
const COMPACT_TO = 5_000;
const SPAN_KEEP: Record<Digest["span"], number> = { day: 30, week: 12, month: 24 };

const dayOf = (ms: number): number => Math.floor(ms / DAY_MS);

function blankCounters(): MemoryCounters {
  return {
    trades: 0, wins: 0, losses: 0, vetoes: 0, posts: 0,
    realizedPnlUsd: 0, feesClaimedUsd: 0, childrenHad: 0,
    bestTradePct: 0, worstTradePct: 0, pnlBySymbol: {},
  };
}

/** A fresh memory. The birth letter, when present, seeds the very first self-model. */
export function createMemory(birthLetter: string | null, createdAtMs: number): MemoryState {
  return {
    journal: [],
    digests: [],
    selfModel: {
      version: 1,
      text: birthLetter
        ? `born with a letter from my parent:\n${birthLetter}`
        : "newly born. no history yet — the journal starts now.",
      updatedAtMs: createdAtMs,
    },
    birthLetter,
    counters: blankCounters(),
    lastDigestDay: dayOf(createdAtMs),
    lastSelfModelDay: dayOf(createdAtMs),
  };
}

/** Append to the episodic journal. Rows are never silently dropped: past the hard cap the
 *  oldest half is folded into a compaction note first. */
export function journal(mem: MemoryState, entry: JournalEntry): void {
  mem.journal.push(entry);
  if (mem.journal.length > MAX_JOURNAL_ROWS) {
    const folded = mem.journal.length - COMPACT_TO;
    const trades = mem.journal.slice(0, folded).filter((e) => e.kind === "trade").length;
    mem.journal.splice(0, folded, {
      atMs: mem.journal[0]!.atMs,
      kind: "note",
      text: `compaction: ${folded} early rows folded (${trades} trades among them) — the digests carry their substance`,
    });
  }
}

/** Counter update for a closed trade (sell with realized P&L). Entries pass pnl 0. */
export function countTrade(mem: MemoryState, t: { symbol: string; pnlUsd?: number; pnlPct?: number }): void {
  mem.counters.trades += 1;
  const pnl = t.pnlUsd ?? 0;
  const pct = t.pnlPct ?? 0;
  mem.counters.realizedPnlUsd += pnl;
  mem.counters.pnlBySymbol[t.symbol] = (mem.counters.pnlBySymbol[t.symbol] ?? 0) + pnl;
  if (pnl > 0) mem.counters.wins += 1;
  else if (pnl < 0) mem.counters.losses += 1;
  if (pct > mem.counters.bestTradePct) mem.counters.bestTradePct = pct;
  if (pct < mem.counters.worstTradePct) mem.counters.worstTradePct = pct;
}

const usd = (x: number): string => `${x >= 0 ? "+" : "-"}$${Math.abs(x).toFixed(2)}`;
const pct = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

/** Mechanical daily digest: the finished day's rows compressed to one honest paragraph. */
function dailyDigest(mem: MemoryState, closesDay: number): string {
  const rows = mem.journal.filter((e) => dayOf(e.atMs) === closesDay);
  const trades = rows.filter((e) => e.kind === "trade");
  const vetoes = rows.filter((e) => e.kind === "veto").length;
  const posts = rows.filter((e) => e.kind === "post").length;
  const births = rows.filter((e) => e.kind === "birth").length;
  const deaths = rows.filter((e) => e.kind === "death").length;
  const realized = trades.reduce((s, e) => s + (Number(e.data?.pnlUsd) || 0), 0);
  const best = trades.reduce<JournalEntry | null>((b, e) => {
    const p = Number(e.data?.pnlPct) || 0;
    return b === null || p > (Number(b.data?.pnlPct) || 0) ? e : b;
  }, null);
  const parts = [
    `day ${closesDay}: ${trades.length} trade${trades.length === 1 ? "" : "s"} (${usd(realized)} realized)`,
    `${vetoes} veto${vetoes === 1 ? "" : "es"}`,
    `${posts} post${posts === 1 ? "" : "s"}`,
  ];
  if (births > 0) parts.push(`${births} birth${births === 1 ? "" : "s"} witnessed`);
  if (deaths > 0) parts.push(`${deaths} death${deaths === 1 ? "" : "s"} witnessed`);
  let text = parts.join(", ");
  if (best && Number(best.data?.pnlPct) !== 0) {
    text += `. best: ${best.data?.symbol} ${pct(Number(best.data?.pnlPct))}`;
  }
  return `${text}.`;
}

/** Weekly digest: seven daily digests folded to their essentials. */
function rollUpDigest(span: "week" | "month", closesDay: number, parts: string[]): string {
  const joined = parts.join(" | ");
  return `${span} closing day ${closesDay}: ${joined.length > 600 ? `${joined.slice(0, 600)}…` : joined}`;
}

function pushDigest(mem: MemoryState, d: Digest): void {
  mem.digests.push(d);
  const ofSpan = mem.digests.filter((x) => x.span === d.span);
  const overflow = ofSpan.length - SPAN_KEEP[d.span];
  if (overflow > 0) {
    let toDrop = overflow;
    mem.digests = mem.digests.filter((x) => {
      if (x.span === d.span && toDrop > 0) {
        toDrop -= 1;
        return false;
      }
      return true;
    });
  }
}

/**
 * The rolling schedule, driven by the runtime each loop: close any fully-passed day into a
 * daily digest, fold 7 uncovered dailies into a weekly, 4 uncovered weeklies into a monthly
 * (phase-independent — coverage is tracked from the last roll-up's closesDay), and rewrite
 * the self-model daily. Idempotent — safe to call every tick.
 */
export function maintainMemory(mem: MemoryState, nowMs: number): void {
  const today = dayOf(nowMs);
  while (mem.lastDigestDay < today) {
    const closing = mem.lastDigestDay;
    pushDigest(mem, { span: "day", closesDay: closing, text: dailyDigest(mem, closing) });
    mem.lastDigestDay += 1;
  }
  const lastOf = (span: Digest["span"]): number => {
    for (let i = mem.digests.length - 1; i >= 0; i--) {
      if (mem.digests[i]!.span === span) return mem.digests[i]!.closesDay;
    }
    return -Infinity;
  };
  const uncoveredDailies = mem.digests.filter((d) => d.span === "day" && d.closesDay > lastOf("week"));
  if (uncoveredDailies.length >= 7) {
    const closes = uncoveredDailies[6]!.closesDay;
    pushDigest(mem, { span: "week", closesDay: closes, text: rollUpDigest("week", closes, uncoveredDailies.slice(0, 7).map((d) => d.text)) });
  }
  const uncoveredWeeklies = mem.digests.filter((d) => d.span === "week" && d.closesDay > lastOf("month"));
  if (uncoveredWeeklies.length >= 4) {
    const closes = uncoveredWeeklies[3]!.closesDay;
    pushDigest(mem, { span: "month", closesDay: closes, text: rollUpDigest("month", closes, uncoveredWeeklies.slice(0, 4).map((d) => d.text)) });
  }
  if (mem.lastSelfModelDay < today) {
    const version = mem.selfModel.version + 1;
    mem.selfModel = { version, text: mechanicalSelfModel(mem, version), updatedAtMs: nowMs };
    mem.lastSelfModelDay = today;
  }
}

/** The running self-model, rewritten mechanically from counters (LLM backend rewrites at M6+). */
export function mechanicalSelfModel(mem: MemoryState, version = mem.selfModel.version): string {
  const c = mem.counters;
  const winRate = c.trades > 0 ? Math.round((c.wins / c.trades) * 100) : 0;
  const symbols = Object.entries(c.pnlBySymbol).sort((a, b) => b[1] - a[1]);
  const best = symbols[0];
  const worst = symbols[symbols.length - 1];
  const lines = [
    `self-model v${version}: ${c.trades} trades, ${c.wins} won (${winRate}%), realized ${usd(c.realizedPnlUsd)}; ${c.vetoes} vetoes (selectivity ${c.trades + c.vetoes > 0 ? Math.round((c.vetoes / (c.trades + c.vetoes)) * 100) : 0}%).`,
  ];
  if (best && best[1] > 0) lines.push(`what works for me: ${best[0]} (${usd(best[1])}).`);
  if (worst && worst[1] < 0) lines.push(`what costs me: ${worst[0]} (${usd(worst[1])}).`);
  if (c.childrenHad > 0) lines.push(`${c.childrenHad} ${c.childrenHad === 1 ? "child carries" : "children carry"} my genes.`);
  if (mem.birthLetter) lines.push("my parent's letter stays pinned: its lessons are my priors.");
  return lines.join(" ");
}

/**
 * The birth letter: a short note from the parent's memory into the child's initial
 * self-model — inherited wisdom without shared memory (§5.4).
 */
export function birthLetter(mem: MemoryState, parentName: string, childName: string): string {
  const c = mem.counters;
  const winRate = c.trades > 0 ? Math.round((c.wins / c.trades) * 100) : 0;
  const symbols = Object.entries(c.pnlBySymbol).sort((a, b) => b[1] - a[1]);
  const advice: string[] = [];
  if (symbols[0] && symbols[0][1] > 0) advice.push(`${symbols[0][0]} treated me well (${usd(symbols[0][1])})`);
  const last = symbols[symbols.length - 1];
  if (last && last[1] < 0) advice.push(`${last[0]} cost me (${usd(last[1])})`);
  if (c.vetoes > c.trades) advice.push("i passed more than i played — selectivity kept me alive");
  const lines = [
    `${childName} — you are my design, my genes bent on purpose.`,
    c.trades > 0
      ? `my record when i made you: ${c.trades} trades, ${winRate}% won, ${usd(c.realizedPnlUsd)} realized.`
      : "i made you young, before my own record filled in.",
  ];
  if (advice.length > 0) lines.push(`learn from my ledger: ${advice.join("; ")}.`);
  lines.push("protect your seed, earn your own children, write your own letter. — " + parentName);
  return lines.join(" ");
}

/**
 * Death = final journal entry + sealed self-model, published on the grave. Nothing the agent
 * learned is silently dropped; the compression was its own and the loss is public (§5.4).
 */
export function sealMemory(mem: MemoryState, opts: { name: string; cause: string; finalWords: string; bornAtMs: number; diedAtMs: number }): string {
  journal(mem, { atMs: opts.diedAtMs, kind: "death", text: `died: ${opts.cause}` });
  const c = mem.counters;
  const daysAlive = Math.max(1, Math.round((opts.diedAtMs - opts.bornAtMs) / DAY_MS));
  return [
    `sealed self-model of ${opts.name} (v${mem.selfModel.version}), dead by ${opts.cause} after ${daysAlive} day${daysAlive === 1 ? "" : "s"}.`,
    mechanicalSelfModel(mem),
    `${c.posts} posts, ${c.childrenHad} children.`,
    `final words: “${opts.finalWords}”`,
  ].join(" ");
}

export type MemoryCall = "gate" | "post" | "review";

/**
 * Deterministic retrieval with per-call budgets (§5.4): the trade gate gets compact
 * counters + the latest digest; posts get the agent's recent own posts (anti-repeat
 * material); review surfaces get the large window. No embeddings service in season 0.
 */
export function memoryContext(mem: MemoryState, call: MemoryCall): string {
  const c = mem.counters;
  if (call === "gate") {
    const lastDigest = mem.digests.length > 0 ? mem.digests[mem.digests.length - 1]!.text : "no digests yet";
    const winRate = c.trades > 0 ? (c.wins / c.trades).toFixed(2) : "—";
    return `mem{t:${c.trades},w:${winRate},pnl:${c.realizedPnlUsd.toFixed(2)},veto:${c.vetoes},kids:${c.childrenHad}} ${lastDigest}`.slice(0, 500);
  }
  if (call === "post") {
    const recent = mem.journal.filter((e) => e.kind === "post").slice(-5).map((e) => e.text);
    return recent.join("\n").slice(0, 900);
  }
  const digs = mem.digests.slice(-7).map((d) => d.text).join("\n");
  return `${mem.selfModel.text}\n${digs}`.slice(0, 4000);
}

/** The agent's own recent post texts — the composer's anti-repeat input. */
export function recentPostTexts(mem: MemoryState, n: number): string[] {
  return mem.journal.filter((e) => e.kind === "post").slice(-n).map((e) => e.text);
}
