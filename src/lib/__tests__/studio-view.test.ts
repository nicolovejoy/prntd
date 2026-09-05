import { describe, it, expect } from "vitest";
import {
  bulkDeleteConfirm,
  bulkDeleteSkipNotice,
  formatClosedDate,
  formatElapsed,
  timeAgo,
} from "@/lib/studio-view";

describe("formatElapsed", () => {
  it("formats seconds under a minute", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_000)).toBe("0:07");
    expect(formatElapsed(59_999)).toBe("0:59");
  });

  it("rolls into minutes", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(83_000)).toBe("1:23");
    expect(formatElapsed(600_000)).toBe("10:00");
  });

  it("clamps clock skew to zero instead of going negative", () => {
    expect(formatElapsed(-3_000)).toBe("0:00");
  });
});

describe("timeAgo", () => {
  const now = Date.UTC(2026, 7, 31, 12, 0, 0);

  it("steps through the scales", () => {
    expect(timeAgo(new Date(now - 30 * 1000), now)).toBe("just now");
    expect(timeAgo(new Date(now - 5 * 60 * 1000), now)).toBe("5m ago");
    expect(timeAgo(new Date(now - 3 * 60 * 60 * 1000), now)).toBe("3h ago");
    expect(timeAgo(new Date(now - 2 * 24 * 60 * 60 * 1000), now)).toBe(
      "2d ago"
    );
  });
});

describe("formatClosedDate", () => {
  const now = new Date("2026-09-04T12:00:00Z");

  it("renders month and day, no year, within the current year", () => {
    expect(formatClosedDate(new Date("2026-09-04T12:00:00Z"), now)).toBe("Sep 4");
  });

  it("adds the year once the date is not this year", () => {
    expect(formatClosedDate(new Date("2025-12-31T12:00:00Z"), now)).toBe(
      "Dec 31, 2025"
    );
  });

  it("buckets by the Pacific day, not the UTC one", () => {
    // 2026-09-05T02:00Z is still Sep 4 in Los Angeles; a UTC format would
    // print Sep 5 — the phantom-tomorrow bug this helper exists to avoid.
    expect(formatClosedDate(new Date("2026-09-05T02:00:00Z"), now)).toBe("Sep 4");
  });

  it("uses the Pacific year for the same-year test", () => {
    // 2027-01-01T02:00Z is Dec 31 2026 in Los Angeles — same year as `now`.
    expect(formatClosedDate(new Date("2027-01-01T02:00:00Z"), now)).toBe("Dec 31");
  });
});

describe("bulkDeleteConfirm", () => {
  it("counts and pluralises, and says what is kept", () => {
    expect(bulkDeleteConfirm(1)).toBe(
      "Delete 1 conversation and its images? Images used in an order, another design, or a cart are kept. Conversations with an order are kept."
    );
    expect(bulkDeleteConfirm(6)).toMatch(
      /^Delete 6 conversations and their images\?/
    );
  });
});

describe("bulkDeleteSkipNotice", () => {
  it("is null when nothing was skipped", () => {
    expect(bulkDeleteSkipNotice([])).toBeNull();
  });

  it("says nothing about ids that weren't the caller's", () => {
    expect(bulkDeleteSkipNotice([{ id: "x", reason: "not_found" }])).toBeNull();
  });

  it("counts by reason, one plain sentence each", () => {
    expect(
      bulkDeleteSkipNotice([
        { id: "a", reason: "ordered" },
        { id: "b", reason: "ordered" },
        { id: "c", reason: "product" },
        { id: "d", reason: "failed" },
      ])
    ).toBe(
      "2 kept — they have orders. 1 kept — a shop product uses it. 1 couldn't be deleted. Try again."
    );
    expect(bulkDeleteSkipNotice([{ id: "a", reason: "ordered" }])).toBe(
      "1 kept — it has an order."
    );
  });
});
