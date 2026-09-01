import { describe, it, expect } from "vitest";
import { formatElapsed, timeAgo } from "@/lib/studio-view";

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
