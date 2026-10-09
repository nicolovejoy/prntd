import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  pacificDayKey,
  pacificDayStart,
  pacificWindowStarts,
} from "../pacific-day";

// Run the process in Tokyo so a helper that leans on the process zone fails
// on any machine.
let originalTz: string | undefined;
beforeAll(() => {
  originalTz = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("pacificDayKey", () => {
  it("is the Pacific calendar day, not the UTC one", () => {
    // 2026-10-08 03:30Z is 8:30 PM on Oct 7 in Pacific (PDT).
    expect(pacificDayKey(new Date("2026-10-08T03:30:00Z"))).toBe("2026-10-07");
    // 2026-10-08 07:00Z is exactly Pacific midnight (PDT = UTC-7).
    expect(pacificDayKey(new Date("2026-10-08T07:00:00Z"))).toBe("2026-10-08");
    expect(pacificDayKey(new Date("2026-10-08T06:59:59Z"))).toBe("2026-10-07");
  });
});

describe("pacificDayStart", () => {
  it("returns the UTC instant of Pacific midnight in daylight time", () => {
    expect(pacificDayStart(new Date("2026-10-08T20:00:00Z")).toISOString()).toBe(
      "2026-10-08T07:00:00.000Z",
    );
  });

  it("returns the UTC instant of Pacific midnight in standard time", () => {
    expect(pacificDayStart(new Date("2026-12-15T20:00:00Z")).toISOString()).toBe(
      "2026-12-15T08:00:00.000Z",
    );
  });

  it("uses the Pacific day for an instant late on the previous UTC day", () => {
    // 2026-10-08 03:30Z is still Oct 7 in Pacific.
    expect(pacificDayStart(new Date("2026-10-08T03:30:00Z")).toISOString()).toBe(
      "2026-10-07T07:00:00.000Z",
    );
  });

  it("handles the spring-forward day (23 hours long)", () => {
    // 2026-03-08: PST until 2:00 AM, then PDT. Midnight is still PST.
    expect(pacificDayStart(new Date("2026-03-08T20:00:00Z")).toISOString()).toBe(
      "2026-03-08T08:00:00.000Z",
    );
    // The next day's midnight is PDT.
    expect(pacificDayStart(new Date("2026-03-09T20:00:00Z")).toISOString()).toBe(
      "2026-03-09T07:00:00.000Z",
    );
  });

  it("handles the fall-back day (25 hours long)", () => {
    // 2026-11-01: PDT until 2:00 AM, then PST. Midnight is still PDT.
    expect(pacificDayStart(new Date("2026-11-01T20:00:00Z")).toISOString()).toBe(
      "2026-11-01T07:00:00.000Z",
    );
    expect(pacificDayStart(new Date("2026-11-02T20:00:00Z")).toISOString()).toBe(
      "2026-11-02T08:00:00.000Z",
    );
  });
});

describe("pacificWindowStarts", () => {
  it("today starts at Pacific midnight; the 7-day window covers today and the 6 days before", () => {
    const w = pacificWindowStarts(new Date("2026-10-08T20:00:00Z"));
    expect(w.todayStart.toISOString()).toBe("2026-10-08T07:00:00.000Z");
    expect(w.weekStart.toISOString()).toBe("2026-10-02T07:00:00.000Z");
  });

  it("keeps Pacific midnight on both ends across a DST change", () => {
    // Week of 2026-11-01 fall-back: today Nov 4 (PST), week start Oct 29 (PDT).
    const w = pacificWindowStarts(new Date("2026-11-04T20:00:00Z"));
    expect(w.todayStart.toISOString()).toBe("2026-11-04T08:00:00.000Z");
    expect(w.weekStart.toISOString()).toBe("2026-10-29T07:00:00.000Z");
  });

  it("is anchored on the Pacific day when UTC has already rolled over", () => {
    // 2026-10-08 03:30Z is Oct 7 evening in Pacific.
    const w = pacificWindowStarts(new Date("2026-10-08T03:30:00Z"));
    expect(w.todayStart.toISOString()).toBe("2026-10-07T07:00:00.000Z");
    expect(w.weekStart.toISOString()).toBe("2026-10-01T07:00:00.000Z");
  });
});
