/**
 * Death triggers (§4.5, amended 2026-08-02). Boundaries per the contract in death.ts:
 *   ruin:       equity ≤ 0.50 × seed          (exactly at the line → DEAD)
 *   starvation: equity + fees < 7 × dailyBurn (exactly 7 days of runway → alive)
 * Ruin is evaluated first: both-ruined-and-starving dies of ruin.
 */
import { describe, expect, it } from "vitest";
import { DEATH, deathCheck, type DeathInput } from "../src/index.js";

function input(overrides: Partial<DeathInput> = {}): DeathInput {
  // Healthy baseline: equity well above ruin, runway well above 7 days.
  return { equityUsd: 150, seedUsd: 100, unclaimedFeesUsd: 10, dailyBurnUsd: 0.4, ...overrides };
}

describe("deathCheck — ruin (§4.5)", () => {
  it("dies of ruin at exactly 0.35 × seed", () => {
    const seed = 200;
    const verdict = deathCheck(
      input({ equityUsd: DEATH.ruinEquityFractionOfSeed * seed, seedUsd: seed, dailyBurnUsd: 0 }),
    );
    expect(verdict).toEqual({ dead: true, cause: "ruin" });
  });

  it("survives just above the ruin line (robust to float dust)", () => {
    const seed = 200;
    const verdict = deathCheck(
      input({
        equityUsd: DEATH.ruinEquityFractionOfSeed * seed + 1e-6,
        seedUsd: seed,
        unclaimedFeesUsd: 100,
        dailyBurnUsd: 1,
      }),
    );
    expect(verdict).toEqual({ dead: false, cause: null });
  });

  it("dies of ruin clearly below the line", () => {
    expect(deathCheck(input({ equityUsd: 69, seedUsd: 200 }))).toEqual({ dead: true, cause: "ruin" });
  });

  it("equity 0 is ruin", () => {
    expect(deathCheck(input({ equityUsd: 0, seedUsd: 100 }))).toEqual({ dead: true, cause: "ruin" });
  });

  it("both ruined AND starving → cause is ruin (ruin evaluated first)", () => {
    const verdict = deathCheck(
      input({ equityUsd: 10, seedUsd: 200, unclaimedFeesUsd: 0, dailyBurnUsd: 100 }),
    );
    // 10 ≤ 100 (ruined) and 10 < 700 (starving) → ruin wins.
    expect(verdict).toEqual({ dead: true, cause: "ruin" });
  });
});

describe("deathCheck — starvation (§4.5)", () => {
  it("dies of starvation strictly below 7 days of burn", () => {
    // Needs 7 × 10 = 70; has 55 + 14.99 = 69.99. Not ruined (0.5 × 100 = 50 < 55).
    const verdict = deathCheck(
      input({ equityUsd: 55, seedUsd: 100, unclaimedFeesUsd: 14.99, dailyBurnUsd: 10 }),
    );
    expect(verdict).toEqual({ dead: true, cause: "starvation" });
  });

  it("survives at exactly 7 days of runway", () => {
    // 60 + 10 = 70 = 7 × 10 exactly → alive (strict <).
    const verdict = deathCheck(
      input({ equityUsd: 60, seedUsd: 100, unclaimedFeesUsd: 10, dailyBurnUsd: 10 }),
    );
    expect(verdict).toEqual({ dead: false, cause: null });
  });

  it("one cent under 7 days of runway starves", () => {
    const verdict = deathCheck(
      input({ equityUsd: 60, seedUsd: 100, unclaimedFeesUsd: 9.99, dailyBurnUsd: 10 }),
    );
    expect(verdict).toEqual({ dead: true, cause: "starvation" });
  });

  it("unclaimed fees count toward runway", () => {
    // Equity alone (55) is under 70 but above the ruin line, fees push it to 70 → alive.
    const verdict = deathCheck(
      input({ equityUsd: 55, seedUsd: 100, unclaimedFeesUsd: 15, dailyBurnUsd: 10 }),
    );
    expect(verdict).toEqual({ dead: false, cause: null });
  });

  it("dailyBurn 0 → never starves", () => {
    const verdict = deathCheck(
      input({ equityUsd: 51, seedUsd: 100, unclaimedFeesUsd: 0, dailyBurnUsd: 0 }),
    );
    expect(verdict).toEqual({ dead: false, cause: null });
  });
});

describe("deathCheck — healthy", () => {
  it("a healthy quant returns exactly {dead: false, cause: null}", () => {
    expect(deathCheck(input())).toEqual({ dead: false, cause: null });
  });
});
