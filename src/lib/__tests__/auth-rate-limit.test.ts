import { describe, expect, it } from "vitest";
import {
  RATE_MAX_CEILING,
  e2eRateLimitOptions,
  parseRateMax,
  signinRateLimitRules,
} from "../auth-rate-limit";

const ON = { vercelEnv: undefined, trustLocalhost: "true" };

describe("parseRateMax", () => {
  it("accepts a positive integer", () => {
    expect(parseRateMax("30", ON)).toBe(30);
    expect(parseRateMax(" 5 ", ON)).toBe(5);
    expect(parseRateMax(String(RATE_MAX_CEILING), ON)).toBe(RATE_MAX_CEILING);
  });

  it("ignores unset, empty, zero, negative and non-integer values", () => {
    for (const v of [undefined, "", "0", "-3", "2.5", "abc", "1e3", "0x10"]) {
      expect(parseRateMax(v, ON)).toBeNull();
    }
  });

  it("ignores values above the ceiling", () => {
    expect(parseRateMax(String(RATE_MAX_CEILING + 1), ON)).toBeNull();
    expect(parseRateMax("99999999999999999999", ON)).toBeNull();
  });

  it("is ignored on any Vercel deployment", () => {
    for (const env of ["production", "preview", "development"]) {
      expect(parseRateMax("30", { ...ON, vercelEnv: env })).toBeNull();
    }
  });

  it("needs E2E_TRUST_LOCALHOST to be exactly 'true'", () => {
    for (const t of [undefined, "", "false", "1", "TRUE"]) {
      expect(parseRateMax("30", { ...ON, trustLocalhost: t })).toBeNull();
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

describe("e2eRateLimitOptions", () => {
  it("returns nothing without an override", () => {
    expect(e2eRateLimitOptions(null, null)).toBeUndefined();
  });

  it("sets both ceilings, and nothing else", () => {
    const o = e2eRateLimitOptions(1000, 10000)!;
    expect(o.max).toBe(10000);
    expect(o.customRules).toEqual(signinRateLimitRules(1000));
    expect(Object.keys(o).sort()).toEqual(["customRules", "max"]);
  });

  it("sets only what was given", () => {
    expect(e2eRateLimitOptions(null, 500)).toEqual({ max: 500 });
    expect(Object.keys(e2eRateLimitOptions(7, null)!)).toEqual(["customRules"]);
  });
});
