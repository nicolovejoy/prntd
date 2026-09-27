import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDisplayDate, formatDisplayDateTime } from "../display-time-zone";

// ICU versions disagree on whether the space before AM/PM is a plain U+0020
// or a narrow no-break space (U+202F) — collapse all whitespace to a plain
// space before comparing so the assertions below don't pin one ICU's choice.
function norm(value: string): string {
  return value.replace(/\s/g, " ");
}

// Run the process in Tokyo so dropping the zone option fails on any machine:
// the Tokyo, UTC and Pacific calendar days of these instants all differ.
let originalTz: string | undefined;
beforeAll(() => {
  originalTz = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("formatDisplayDate", () => {
  it("shows the Pacific day, not the UTC or process day", () => {
    // Tokyo 9/26 12:00, UTC 9/26 03:00, Pacific 9/25 20:00.
    expect(formatDisplayDate(new Date("2026-09-26T03:00:00Z"))).toBe("9/25/2026");
  });

  it("accepts string and number inputs", () => {
    expect(formatDisplayDate("2026-09-26T03:00:00Z")).toBe("9/25/2026");
    expect(formatDisplayDate(Date.parse("2026-09-26T03:00:00Z"))).toBe("9/25/2026");
  });
});

describe("formatDisplayDateTime", () => {
  it("shows the Pacific hour with a PDT label in summer", () => {
    expect(norm(formatDisplayDateTime("2026-09-26T03:04:05Z"))).toBe("9/25/26, 8:04 PM PDT");
  });

  it("labels winter times PST", () => {
    expect(norm(formatDisplayDateTime("2026-01-15T03:04:05Z"))).toBe("1/14/26, 7:04 PM PST");
  });

  it("includes seconds only when asked", () => {
    expect(
      norm(formatDisplayDateTime("2026-09-26T03:04:05Z", { seconds: true })),
    ).toBe("9/25/26, 8:04:05 PM PDT");
  });
});
