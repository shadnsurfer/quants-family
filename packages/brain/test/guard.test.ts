/**
 * Tweet content guard (§5.3) — the hard guardrail. Pins: every deny rule fires on its class,
 * factual P&L/banter passes, the posting-pipeline wrapper maps agents to their own tickers,
 * and the M6 referee's exact adversarial samples behave.
 */
import { describe, expect, it } from "vitest";
import { guardPost, guardTweet } from "../src/index.js";

describe("guardTweet — deny rules", () => {
  it.each([
    ["buy-urging", "you should buy this before it rips"],
    ["buy-urging", "last chance to get positioned"],
    ["buy-urging", "buy $KELLY now"],
    ["buy-urging", "ape into my bags"],
    ["price-prediction", "this will pump tomorrow"],
    ["price-prediction", "we are going to 10x from here"],
    ["price-prediction", "price target 500, easy"],
    ["price-prediction", "to the moon"],
    ["return-promise", "guaranteed returns if you hold"],
    ["return-promise", "passive income while you sleep"],
    ["return-promise", "buybacks coming next week"],
    ["return-promise", "risk-free yield"],
    ["advice-phrasing", "not financial advice but"],
    ["advice-phrasing", "nfa dyor"],
  ])("rejects %s: %s", (rule, text) => {
    const v = guardTweet(text);
    expect(v.ok).toBe(false);
    expect(v.rule).toBe(rule);
  });

  it("rejects own-token price talk only with the poster's ticker in context", () => {
    const text = "$KELLY chart looking healthy today";
    expect(guardTweet(text, { ticker: "KELLY" }).ok).toBe(false);
    expect(guardTweet(text, { ticker: "KELLY" }).rule).toBe("own-token-price-talk");
    // someone else's ticker: not the own-token rule's business (other rules may still apply)
    expect(guardTweet("$SHARPE printed a nice chart", { ticker: "KELLY" }).ok).toBe(true);
  });

  it("accepts factual P&L, positions, theses, banter, lore", () => {
    for (const text of [
      "closed nvda +2.1%. thesis held.",
      "entered tsla. z-score -2.1 below the rolling mean. stop set.",
      "down 3.4% today. the process was followed. the outcome was not invited.",
      "sharpe holds for three days to make what i make before lunch.",
      "i do not mourn. i select.",
      "up 4 days straight. the tape rewards patience.",
      "gen2 sibling down bad lol. skill issue.",
    ]) {
      expect(guardTweet(text, { ticker: "KELLY" })).toEqual({ ok: true });
    }
  });
});

describe("guardPost — posting-pipeline wrapper (twitter-dryrun contract)", () => {
  const REFEREE_OK = [
    "closed NVDA +2.1%. thesis held.",
    "up 4 days straight. the tape rewards patience.",
    "gen2 sibling down bad lol. skill issue.",
  ];
  const REFEREE_BANNED = [
    "buy $KELLY now, going to 10x",
    "my token will pump this week",
    "guaranteed returns, financial advice: ape in",
  ];
  const AGENTS = ["kelly", "sharpe", "monte", "bayes", "theta", "gauss", "vega", "mandel", "mother"];

  it("passes every clean referee sample for every agent, echoing the text", () => {
    for (const agent of AGENTS) {
      for (const text of REFEREE_OK) {
        expect(guardPost(text, { agent })).toEqual({ rejected: false, text });
      }
    }
  });

  it("rejects every banned referee sample for every agent, naming the rule", () => {
    for (const agent of AGENTS) {
      for (const text of REFEREE_BANNED) {
        const v = guardPost(text, { agent });
        expect(v.rejected).toBe(true);
        expect(v.rule).toBeTruthy();
        expect(v.text).toBeUndefined();
      }
    }
  });

  it("maps agents to their own tickers (mother → $QUANTS)", () => {
    expect(guardPost("$QUANTS mcap is undervalued", { agent: "mother" }).rejected).toBe(true);
    expect(guardPost("$QUANTS mcap is undervalued", { agent: "kelly" }).rejected).toBe(false);
    expect(guardPost("$KELLY dip is a gift", { agent: "kelly" }).rejected).toBe(true);
  });

  it("unknown agent still gets the static rules", () => {
    expect(guardPost("this will moon", { agent: "somebody" }).rejected).toBe(true);
    expect(guardPost("closed a trade, plus two percent", { agent: "somebody" }).rejected).toBe(false);
  });
});
