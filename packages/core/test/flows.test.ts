/**
 * Money flows (§4.6, amended 2026-08-02 — replaces the retired gene-pool treasury): exact
 * integer-cent conversions, the fee-claim split (compute reserve / holder reward / discretion)
 * with EXACT conservation, the parent-funded child endowment, and the $200 minimum-seed check.
 */
import { describe, expect, it } from "vitest";
import {
  centsToUsd,
  childEndowmentCents,
  childSeedOk,
  MONEY,
  splitFeeClaimCents,
  usdToCents,
} from "../src/index.js";

describe("usdToCents / centsToUsd", () => {
  it("converts cleanly at the edges: $200 ↔ 20000¢, $0 ↔ 0¢", () => {
    expect(usdToCents(200)).toBe(20000);
    expect(usdToCents(0)).toBe(0);
    expect(centsToUsd(20000)).toBe(200);
    expect(centsToUsd(0)).toBe(0);
  });

  it("round-trips integer cents exactly (cents → usd → cents is the identity)", () => {
    for (const c of [0, 1, 2, 99, 100, 101, 19999, 20000, 123456, 1_000_000_000]) {
      expect(usdToCents(centsToUsd(c))).toBe(c);
    }
  });

  it("round-trips two-decimal dollars exactly (usd → cents → usd is the identity)", () => {
    for (const u of [0.01, 0.99, 1, 12.34, 200, 1234.56, 9999999.99]) {
      expect(centsToUsd(usdToCents(u))).toBe(u);
    }
  });
});

describe("splitFeeClaimCents (compute reserve 10% / holder reward r / discretion remainder)", () => {
  it("r = 0: holders get nothing, discretion takes everything after the reserve", () => {
    expect(splitFeeClaimCents(10000, 0)).toEqual({
      computeReserveCents: 1000,
      holderRewardCents: 0,
      discretionCents: 9000,
    });
  });

  it("r = 0.2 (the genome default): 10/20/70 on a round total", () => {
    expect(splitFeeClaimCents(10000, 0.2)).toEqual({
      computeReserveCents: 1000,
      holderRewardCents: 2000,
      discretionCents: 7000,
    });
  });

  it("r = 0.4 (the anti-rug ceiling): 10/40/50 on a round total", () => {
    expect(splitFeeClaimCents(10000, 0.4)).toEqual({
      computeReserveCents: 1000,
      holderRewardCents: 4000,
      discretionCents: 5000,
    });
  });

  it("floors the reserve and reward, and the ODD CENT always lands in discretion", () => {
    // 999¢ at r=0.2: reserve floor(99.9)=99, reward floor(199.8)=199, discretion 999-99-199=701
    expect(splitFeeClaimCents(999, 0.2)).toEqual({
      computeReserveCents: 99,
      holderRewardCents: 199,
      discretionCents: 701,
    });
    // a single cent: both floored shares are 0, discretion keeps it
    expect(splitFeeClaimCents(1, 0.4)).toEqual({
      computeReserveCents: 0,
      holderRewardCents: 0,
      discretionCents: 1,
    });
    // nothing in, nothing out
    expect(splitFeeClaimCents(0, 0.2)).toEqual({
      computeReserveCents: 0,
      holderRewardCents: 0,
      discretionCents: 0,
    });
  });

  it("conserves EXACTLY across a sweep of odd/even totals and reward rates, parts always ≥ 0", () => {
    const rates = [0, 0.05, 0.2, 0.333, 0.4];
    for (let total = 0; total <= 1000; total += 7) {
      for (const r of rates) {
        const s = splitFeeClaimCents(total, r);
        expect(s.computeReserveCents + s.holderRewardCents + s.discretionCents).toBe(total);
        expect(s.computeReserveCents).toBeGreaterThanOrEqual(0);
        expect(s.holderRewardCents).toBeGreaterThanOrEqual(0);
        expect(s.discretionCents).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(s.computeReserveCents)).toBe(true);
        expect(Number.isInteger(s.holderRewardCents)).toBe(true);
        expect(Number.isInteger(s.discretionCents)).toBe(true);
        // the floored shares can never exceed their exact proportional values
        expect(s.computeReserveCents).toBeLessThanOrEqual(total * MONEY.computeReserveSplit);
        expect(s.holderRewardCents).toBeLessThanOrEqual(total * r);
      }
    }
  });

  it("throws RangeError on a non-integer or negative total", () => {
    expect(() => splitFeeClaimCents(100.5, 0.2)).toThrow(RangeError);
    expect(() => splitFeeClaimCents(-1, 0.2)).toThrow(RangeError);
  });

  it("throws RangeError when r leaves 0..0.4; the boundaries 0 and 0.4 do not throw", () => {
    expect(() => splitFeeClaimCents(100, -0.01)).toThrow(RangeError);
    expect(() => splitFeeClaimCents(100, 0.41)).toThrow(RangeError);
    expect(() => splitFeeClaimCents(100, Number.NaN)).toThrow(RangeError);
    expect(() => splitFeeClaimCents(100, 0)).not.toThrow();
    expect(() => splitFeeClaimCents(100, 0.4)).not.toThrow();
  });
});

describe("childEndowmentCents (20% of the parent's own equity, rounded)", () => {
  it("is exactly parentEndowmentPct of the parent equity on round numbers", () => {
    expect(childEndowmentCents(1000)).toBe(200);
    expect(childEndowmentCents(0)).toBe(0);
    expect(childEndowmentCents(1_000_000)).toBe(200_000);
  });

  it("rounds to the nearest cent: 1002 → 200 (200.4), 1003 → 201 (200.6)", () => {
    expect(childEndowmentCents(1002)).toBe(200);
    expect(childEndowmentCents(1003)).toBe(201);
  });
});

describe("childSeedOk (endowment − launch fee must clear the $200 minimum trading seed)", () => {
  // $200 == 20000 cents; the check is ≥, with NO maximum (Charles 2026-08-02)
  it("pins the threshold derivation: minChildTradingUsd $200 → 20000 cents", () => {
    expect(usdToCents(MONEY.minChildTradingUsd)).toBe(20000);
  });

  it("a seed of EXACTLY $200 after the fee passes", () => {
    expect(childSeedOk(20500, 500)).toBe(true); // 20500 − 500 = 20000
    expect(childSeedOk(20000, 0)).toBe(true); // no fee at all
  });

  it("a seed of $199.99 after the fee fails", () => {
    expect(childSeedOk(20499, 500)).toBe(false); // 20499 − 500 = 19999
    expect(childSeedOk(19999, 0)).toBe(false);
  });

  it("has no maximum: an arbitrarily large endowment is fine", () => {
    expect(childSeedOk(1_000_000_000, 500)).toBe(true);
  });

  it("the funding cascade end-to-end: endowment from parent equity gates on the launch fee", () => {
    // parent equity $1025.00 → endowment round(20%) = 20500¢ → minus 500¢ fee = exactly $200 → OK
    expect(childSeedOk(childEndowmentCents(102500), 500)).toBe(true);
    // parent equity $1024.95 → endowment 20499¢ → seed $199.99 → NOT viable
    expect(childSeedOk(childEndowmentCents(102495), 500)).toBe(false);
  });
});
