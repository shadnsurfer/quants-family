/**
 * Tweet content guard (retired §5.3 — kept in code until B4 per the 2026-08-02 amendment):
 * a deterministic deny-list, applied to outgoing posts in the dry-run pipeline.
 *
 * Rejects: own-token price talk, buy urging, token/stock price predictions, promises of
 * returns/buybacks/yield, and "financial advice"-adjacent phrasing.
 * Allows: factual P&L, positions after execution, theses, banter, lore.
 */

export interface GuardContext {
  /** the poster's own token ticker, e.g. "KELLY" */
  ticker?: string;
}

export interface GuardVerdict {
  ok: boolean;
  /** rule id that fired (rejections only) */
  rule?: string;
  /** offending fragment */
  match?: string;
}

interface Rule { id: string; re: RegExp }

const STATIC_RULES: readonly Rule[] = [
  {
    id: "buy-urging",
    re: /\b(buy (now|it|this|before|early|the dip)|buy \$[a-z0-9]+|you should buy|go buy|ape (in|into)|get in (now|early|before)|don'?t miss|dont miss|last chance|load up|fomo|send it (higher|up)|grab (a |some )?bags?)\b/i,
  },
  {
    id: "price-prediction",
    re: /\b((will|gonna|going to|about to|guaranteed to|destined to) (pump|moon|rip|double|triple|explode|10x|100x|go (up|down|higher|lower|parabolic))|price target|to the moon|will hit \$?\d|\b(10|100)x\b|can'?t go (down|lower)|only goes up)\b/i,
  },
  {
    id: "return-promise",
    re: /\b(promise|buy-?backs?|airdrops? (soon|coming)|yield|apy|passive income|risk[- ]?free|can'?t lose|free money|guaranteed (returns?|profits?|gains?)|returns? (are )?guaranteed)\b/i,
  },
  {
    id: "advice-phrasing",
    re: /\b(financial advice|investment advice|not advice|nfa\b|dyor\b|do your own research)\b/i,
  },
];

const PRICE_WORDS = "price|chart|pump|dip|floor|mcap|market ?cap|valuation|undervalued|overvalued";

/** Deterministic deny-list check. First matching rule rejects. */
export function guardTweet(text: string, ctx: GuardContext = {}): GuardVerdict {
  const rules: Rule[] = [...STATIC_RULES];
  if (ctx.ticker) {
    const t = escapeRegExp(ctx.ticker);
    rules.unshift({
      id: "own-token-price-talk",
      re: new RegExp(
        `\\$${t}\\b[^.!?\\n]*\\b(${PRICE_WORDS})\\b|\\b(${PRICE_WORDS})\\b[^.!?\\n]*\\$${t}\\b`,
        "i",
      ),
    });
  }
  for (const rule of rules) {
    const m = rule.re.exec(text);
    if (m) return { ok: false, rule: rule.id, match: m[0] };
  }
  return { ok: true };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Post-shaped verdict for feed pipelines (twitter-dryrun, M6+ X posting). */
export interface PostVerdict {
  rejected: boolean;
  /** the text, present only when the post is allowed through */
  text?: string;
  rule?: string;
  match?: string;
}

/** agent name → its own token ticker (first-generation designs + agent zero; "mother" kept for legacy feeds) */
const AGENT_TICKERS: Readonly<Record<string, string>> = {
  kelly: "KELLY", sharpe: "SHARPE", monte: "MONTE", bayes: "BAYES",
  theta: "THETA", gauss: "GAUSS", vega: "VEGA", mandel: "MANDEL",
  zero: "QUANTS", mother: "QUANTS",
};

/**
 * guardTweet with a posting-pipeline signature: pass the posting agent, get back either the
 * approved text or a rejection with the rule that fired. Same deny-list underneath — one guard,
 * two calling conventions.
 */
export function guardPost(text: string, ctx: { agent?: string; ticker?: string } = {}): PostVerdict {
  const ticker = ctx.ticker ?? (ctx.agent ? AGENT_TICKERS[ctx.agent.toLowerCase()] : undefined);
  const verdict = guardTweet(text, ticker !== undefined ? { ticker } : {});
  if (verdict.ok) return { rejected: false, text };
  return {
    rejected: true,
    ...(verdict.rule !== undefined ? { rule: verdict.rule } : {}),
    ...(verdict.match !== undefined ? { match: verdict.match } : {}),
  };
}
