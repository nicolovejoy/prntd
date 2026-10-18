import { describe, it, expect, vi } from "vitest";
import { dayKeyUTC, parseDailyCap } from "@/lib/generation-quota";

describe("dayKeyUTC", () => {
  it("formats a UTC date as YYYY-MM-DD", () => {
    expect(dayKeyUTC(new Date("2026-06-08T15:30:00Z"))).toBe("2026-06-08");
  });

  it("buckets by UTC day, not local time", () => {
    // Just before midnight UTC and just after fall on different day keys.
    expect(dayKeyUTC(new Date("2026-06-08T23:59:59Z"))).toBe("2026-06-08");
    expect(dayKeyUTC(new Date("2026-06-09T00:00:01Z"))).toBe("2026-06-09");
  });
});

describe("checkout caps (#316)", () => {
  const KEYS = ["USER_CHECKOUT_DAILY_CAP", "USER_IP_CHECKOUT_DAILY_CAP"] as const;

  async function withEnv(value: string | undefined) {
    const saved = KEYS.map((k) => process.env[k]);
    KEYS.forEach((k) => {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    });
    try {
      vi.resetModules();
      return await import("@/lib/generation-quota");
    } finally {
      KEYS.forEach((k, i) => {
        const v = saved[i];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      });
      vi.resetModules();
    }
  }

  it("defaults to 30 and 100 when the env vars are unset", async () => {
    const mod = await withEnv(undefined);
    expect(mod.USER_CHECKOUT_DAILY_CAP).toBe(30);
    expect(mod.USER_IP_CHECKOUT_DAILY_CAP).toBe(100);
  });

  it("falls back to the defaults when the env vars are garbage", async () => {
    const mod = await withEnv("abc");
    expect(mod.USER_CHECKOUT_DAILY_CAP).toBe(30);
    expect(mod.USER_IP_CHECKOUT_DAILY_CAP).toBe(100);
  });

  it("takes an override", async () => {
    const mod = await withEnv("7");
    expect(mod.USER_CHECKOUT_DAILY_CAP).toBe(7);
    expect(mod.USER_IP_CHECKOUT_DAILY_CAP).toBe(7);
  });
});

describe("parseDailyCap", () => {
  it("falls back when unset, empty or whitespace", () => {
    expect(parseDailyCap(undefined, 7)).toBe(7);
    expect(parseDailyCap("", 7)).toBe(7);
    expect(parseDailyCap("   ", 7)).toBe(7);
  });

  it("falls back for non-numeric, NaN, Infinity or negative values", () => {
    expect(parseDailyCap("abc", 7)).toBe(7);
    expect(parseDailyCap("NaN", 7)).toBe(7);
    expect(parseDailyCap("Infinity", 7)).toBe(7);
    expect(parseDailyCap("-1", 7)).toBe(7);
  });

  it("takes a number, including 0 and fractions", () => {
    expect(parseDailyCap("12", 7)).toBe(12);
    expect(parseDailyCap("0", 7)).toBe(0);
    expect(parseDailyCap("2.5", 7)).toBe(2.5);
  });
});

describe("generation caps", () => {
  const KEYS = [
    "GUEST_GEN_DAILY_CAP",
    "USER_GEN_DAILY_CAP",
    "IP_GEN_DAILY_CAP",
    "USER_IP_GEN_DAILY_CAP",
  ] as const;

  async function withEnv(value: string | undefined) {
    const saved = KEYS.map((k) => process.env[k]);
    KEYS.forEach((k) => {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    });
    try {
      vi.resetModules();
      return await import("@/lib/generation-quota");
    } finally {
      KEYS.forEach((k, i) => {
        const v = saved[i];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      });
      vi.resetModules();
    }
  }

  it("defaults to 8/50/20/100 when the env vars are unset", async () => {
    const mod = await withEnv(undefined);
    expect(mod.GUEST_GEN_DAILY_CAP).toBe(8);
    expect(mod.USER_GEN_DAILY_CAP).toBe(50);
    expect(mod.IP_GEN_DAILY_CAP).toBe(20);
    expect(mod.USER_IP_GEN_DAILY_CAP).toBe(100);
  });

  it("falls back to the defaults when the env vars are garbage", async () => {
    const mod = await withEnv("abc");
    expect(mod.GUEST_GEN_DAILY_CAP).toBe(8);
    expect(mod.USER_GEN_DAILY_CAP).toBe(50);
    expect(mod.IP_GEN_DAILY_CAP).toBe(20);
    expect(mod.USER_IP_GEN_DAILY_CAP).toBe(100);
  });
});
