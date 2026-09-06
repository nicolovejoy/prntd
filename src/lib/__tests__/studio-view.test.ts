import { describe, it, expect } from "vitest";
import {
  applyOptimistic,
  bulkDeleteConsequence,
  bulkDeleteSkipNotice,
  bulkDeleteTitle,
  formatClosedDate,
  formatElapsed,
  settleOptimistic,
  timeAgo,
  unseenOptimisticCount,
  type OptimisticEntry,
} from "@/lib/studio-view";
import type { StudioLane } from "@/lib/studio";

import { STALE_OPTIMISTIC_MS } from "../generation-poll";

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

describe("bulkDeleteTitle", () => {
  it("counts and pluralises", () => {
    expect(bulkDeleteTitle(1)).toBe("Delete 1 conversation?");
    expect(bulkDeleteTitle(6)).toBe("Delete 6 conversations?");
  });
});

describe("bulkDeleteConsequence", () => {
  it("says what is kept, singular and plural", () => {
    expect(bulkDeleteConsequence(1)).toBe(
      "This deletes its images too. Images used in an order, another design, or a cart are kept. Conversations with an order are kept instead."
    );
    expect(bulkDeleteConsequence(6)).toMatch(/^This deletes their images too\./);
  });

  it("never repeats the title's question", () => {
    expect(bulkDeleteConsequence(6)).not.toMatch(/^Delete/);
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

function lane(overrides: Partial<StudioLane> = {}): StudioLane {
  return {
    designId: "design-1",
    title: "existing lane",
    lastActiveAt: new Date("2026-09-05T00:00:00Z"),
    cells: [],
    pending: [],
    ...overrides,
  };
}

function entry(overrides: Partial<OptimisticEntry> = {}): OptimisticEntry {
  return {
    localId: "local-1",
    designId: "design-1",
    anchorImageId: null,
    // Now, not a fixed instant: settleOptimistic drops entries older than
    // STALE_OPTIMISTIC_MS, so a hardcoded past date would age these out.
    startedAt: new Date(),
    jobId: null,
    prompt: "",
    ...overrides,
  };
}

describe("applyOptimistic", () => {
  it("appends an anchored entry into its existing lane's pending", () => {
    const lanes = [lane({ designId: "design-1" })];
    const result = applyOptimistic(lanes, [
      entry({ designId: "design-1", anchorImageId: "img-1" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].designId).toBe("design-1");
    expect(result[0].pending).toHaveLength(1);
    expect(result[0].pending[0].optimistic).toBe(true);
  });

  it("synthesizes a new lane at index 0, title null, when the design isn't in server lanes yet", () => {
    const lanes = [lane({ designId: "design-1" })];
    const result = applyOptimistic(lanes, [
      entry({ designId: "design-new", localId: "local-2" }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].designId).toBe("design-new");
    expect(result[0].title).toBeNull();
    expect(result[0].cells).toEqual([]);
    expect(result[0].pending).toHaveLength(1);
    expect(result[1].designId).toBe("design-1");
  });

  it("gives the overlay cell the local id as jobId until a real one is known", () => {
    const result = applyOptimistic([], [entry({ localId: "local-9", jobId: null })]);
    expect(result[0].pending[0].jobId).toBe("local-9");
  });

  it("uses the real jobId once known", () => {
    const result = applyOptimistic(
      [lane({ designId: "design-1" })],
      [entry({ designId: "design-1", jobId: "job-9" })]
    );
    expect(result[0].pending[0].jobId).toBe("job-9");
  });

  it("titles a synthetic lane with the entry's prompt (#203)", () => {
    const result = applyOptimistic(
      [],
      [entry({ designId: "design-new", prompt: "big dogs don't jiggle" })]
    );
    expect(result[0].title).toBe("big dogs don't jiggle");
  });

  it("titles a synthetic lane from the earlier startedAt, not array order", () => {
    const later = entry({
      designId: "design-new",
      localId: "local-a",
      prompt: "second prompt",
      startedAt: new Date("2026-09-06T00:00:05Z"),
    });
    const earlier = entry({
      designId: "design-new",
      localId: "local-b",
      prompt: "first prompt",
      startedAt: new Date("2026-09-06T00:00:01Z"),
    });

    // Passed newest-first, so array order alone would pick the wrong one.
    const result = applyOptimistic([], [later, earlier]);

    expect(result[0].title).toBe("first prompt");
  });

  it("titles a synthetic lane null when the prompt is whitespace-only", () => {
    const result = applyOptimistic(
      [],
      [entry({ designId: "design-new", prompt: "   " })]
    );
    expect(result[0].title).toBeNull();
  });

  it("keeps an existing lane's title over the entry's prompt", () => {
    const result = applyOptimistic(
      [lane({ designId: "design-1", title: "existing lane" })],
      [entry({ designId: "design-1", prompt: "a new prompt" })]
    );
    expect(result[0].title).toBe("existing lane");
  });

  it("gives a null-titled existing lane the entry's prompt", () => {
    const result = applyOptimistic(
      [lane({ designId: "design-1", title: null })],
      [entry({ designId: "design-1", prompt: "a new prompt" })]
    );
    expect(result[0].title).toBe("a new prompt");
  });
});

describe("settleOptimistic", () => {
  it("keeps an entry with a null jobId no matter what server lanes say", () => {
    const withLane = [lane({ designId: "design-1" })];
    const kept = settleOptimistic(withLane, [entry({ jobId: null })]);
    expect(kept).toHaveLength(1);

    const keptStillEmpty = settleOptimistic([], [entry({ jobId: null })]);
    expect(keptStillEmpty).toHaveLength(1);
  });

  it("drops an entry once its jobId shows up in some lane's pending", () => {
    const lanes = [
      lane({
        designId: "design-1",
        pending: [{ jobId: "job-1", generationNumber: 3, startedAt: new Date() }],
      }),
    ];
    const kept = settleOptimistic(lanes, [
      entry({ designId: "design-1", jobId: "job-1" }),
    ]);
    expect(kept).toHaveLength(0);
  });

  it("drops an entry whose jobId isn't pending once its design lane exists (finished or cancelled)", () => {
    const lanes = [lane({ designId: "design-1", pending: [] })];
    const kept = settleOptimistic(lanes, [
      entry({ designId: "design-1", jobId: "job-1" }),
    ]);
    expect(kept).toHaveLength(0);
  });

  it("keeps an entry whose jobId isn't pending while its design lane isn't visible yet", () => {
    const kept = settleOptimistic([], [
      entry({ designId: "design-new", jobId: "job-1" }),
    ]);
    expect(kept).toHaveLength(1);
  });
});

describe("unseenOptimisticCount", () => {
  it("excludes entries already visible server-side, counts the rest", () => {
    const lanes = [
      lane({
        designId: "design-1",
        pending: [{ jobId: "job-visible", generationNumber: 1, startedAt: new Date() }],
      }),
    ];
    const entries = [
      entry({ designId: "design-1", jobId: "job-visible" }), // visible — excluded
      entry({ designId: "design-1", jobId: null, localId: "local-a" }), // in flight — counted
      entry({ designId: "design-2", jobId: "job-unseen", localId: "local-b" }), // queued but not yet in any lane — counted
    ];

    expect(unseenOptimisticCount(lanes, entries)).toBe(2);
  });

  it("is zero when there are no entries", () => {
    expect(unseenOptimisticCount([], [])).toBe(0);
  });
});

describe("applyOptimistic ordering of synthetic lanes", () => {
  it("renders two unanchored submits newest-first", () => {
    const older = entry({
      localId: "local-a",
      designId: "design-a",
      startedAt: new Date("2026-09-05T00:00:01Z"),
    });
    const newer = entry({
      localId: "local-b",
      designId: "design-b",
      startedAt: new Date("2026-09-05T00:00:05Z"),
    });

    // Submit order is oldest-first, the way the client appends them.
    const result = applyOptimistic([], [older, newer]);

    expect(result.map((l) => l.designId)).toEqual(["design-b", "design-a"]);
  });

  it("dates a synthetic lane by the newest of its own entries", () => {
    const first = entry({
      localId: "local-a",
      designId: "design-a",
      startedAt: new Date("2026-09-05T00:00:01Z"),
    });
    const second = entry({
      localId: "local-b",
      designId: "design-a",
      startedAt: new Date("2026-09-05T00:00:09Z"),
    });

    const result = applyOptimistic([], [first, second]);

    expect(result).toHaveLength(1);
    expect(result[0].lastActiveAt).toEqual(new Date("2026-09-05T00:00:09Z"));
    expect(result[0].pending).toHaveLength(2);
  });
});

describe("settleOptimistic against a stale snapshot (#187 review)", () => {
  const knownAt = new Date("2026-09-05T00:00:10Z").getTime();

  it("keeps an entry when the snapshot's fetch began before the jobId was known", () => {
    // The poll's getStudioLanes went out before generateDesign wrote the row,
    // so "lane exists and doesn't list the job" says nothing about this job.
    const lanes = [lane({ designId: "design-1", pending: [] })];
    const kept = settleOptimistic(
      lanes,
      [entry({ jobId: "job-9", jobIdKnownAtMs: knownAt })],
      { snapshotStartedAtMs: knownAt - 500, nowMs: knownAt + 1000 }
    );
    expect(kept).toHaveLength(1);
  });

  it("drops it once a snapshot fetched after the jobId was known still omits it", () => {
    const lanes = [lane({ designId: "design-1", pending: [] })];
    const kept = settleOptimistic(
      lanes,
      [entry({ jobId: "job-9", jobIdKnownAtMs: knownAt })],
      { snapshotStartedAtMs: knownAt + 500, nowMs: knownAt + 1000 }
    );
    expect(kept).toHaveLength(0);
  });

  it("still drops a job the stale snapshot DOES list as pending", () => {
    const lanes = [
      lane({
        designId: "design-1",
        pending: [
          { jobId: "job-9", generationNumber: 1, startedAt: new Date(knownAt) },
        ],
      }),
    ];
    const kept = settleOptimistic(
      lanes,
      [entry({ jobId: "job-9", jobIdKnownAtMs: knownAt })],
      { snapshotStartedAtMs: knownAt - 500, nowMs: knownAt + 1000 }
    );
    expect(kept).toHaveLength(0);
  });

  it("drops an entry older than the client's stale window, jobId or not", () => {
    const startedAt = new Date("2026-09-05T00:00:00Z");
    const now = startedAt.getTime() + STALE_OPTIMISTIC_MS + 1;
    expect(
      settleOptimistic([], [entry({ startedAt, jobId: null })], { nowMs: now })
    ).toHaveLength(0);
    expect(
      settleOptimistic(
        [],
        [entry({ startedAt, jobId: "job-9", jobIdKnownAtMs: startedAt.getTime() })],
        { nowMs: now }
      )
    ).toHaveLength(0);
    // One tick inside the window it survives.
    expect(
      settleOptimistic([], [entry({ startedAt, jobId: null })], {
        nowMs: startedAt.getTime() + STALE_OPTIMISTIC_MS - 1,
      })
    ).toHaveLength(1);
  });
});
