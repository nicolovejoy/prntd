import { describe, it, expect } from "vitest";
import { dayKeyUTC } from "@/lib/generation-quota";

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
