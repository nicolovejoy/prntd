import { describe, it, expect } from "vitest";
import { quotaDecision, dayKeyUTC } from "@/lib/generation-quota";

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

describe("quotaDecision", () => {
  const caps = { identityCap: 8, ipCap: 20 };

  it("allows a count at the cap", () => {
    expect(quotaDecision({ identityCount: 8, ipCount: 1, ...caps })).toEqual({
      allowed: true,
    });
  });

  it("blocks the first count past the identity cap", () => {
    expect(quotaDecision({ identityCount: 9, ipCount: 1, ...caps })).toEqual({
      allowed: false,
      reason: "identity",
    });
  });

  it("blocks on the IP cap when identity is still under", () => {
    expect(quotaDecision({ identityCount: 2, ipCount: 21, ...caps })).toEqual({
      allowed: false,
      reason: "ip",
    });
  });

  it("reports identity first when both are over", () => {
    expect(quotaDecision({ identityCount: 9, ipCount: 21, ...caps })).toEqual({
      allowed: false,
      reason: "identity",
    });
  });

  it("allows when both are under", () => {
    expect(quotaDecision({ identityCount: 1, ipCount: 1, ...caps })).toEqual({
      allowed: true,
    });
  });
});
