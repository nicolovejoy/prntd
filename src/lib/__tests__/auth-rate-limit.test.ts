import { describe, expect, it } from "vitest";
import {
  parseSigninRateMax,
  signinRateLimitRules,
} from "../auth-rate-limit";

describe("parseSigninRateMax", () => {
  it("accepts a positive integer", () => {
    expect(parseSigninRateMax("30", undefined)).toBe(30);
    expect(parseSigninRateMax(" 5 ", undefined)).toBe(5);
  });

  it("ignores unset, empty, zero, negative and non-integer values", () => {
    for (const v of [undefined, "", "0", "-3", "2.5", "abc", "1e3", "0x10"]) {
      expect(parseSigninRateMax(v, undefined)).toBeNull();
    }
  });

  it("ignores absurdly large values", () => {
    expect(parseSigninRateMax("99999999999999999999", undefined)).toBeNull();
  });

  it("is ignored on any Vercel deployment", () => {
    for (const env of ["production", "preview", "development"]) {
      expect(parseSigninRateMax("30", env)).toBeNull();
    }
  });
});

describe("signinRateLimitRules", () => {
  it("returns nothing without an override", () => {
    expect(signinRateLimitRules(null)).toBeUndefined();
  });

  it("covers the paths of the default 3/10 s rule with the given max", () => {
    const rules = signinRateLimitRules(30)!;
    expect(Object.keys(rules).sort()).toEqual([
      "/change-email",
      "/change-password",
      "/sign-in/*",
      "/sign-up/*",
    ]);
    for (const r of Object.values(rules)) {
      expect(r).toEqual({ window: 10, max: 30 });
    }
  });
});
