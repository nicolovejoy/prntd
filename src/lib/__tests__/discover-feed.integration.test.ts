/**
 * Shop feed ordering (admin feed_rank), pure + against a real in-memory
 * libSQL (the #28 pattern). Ranked images list before unranked, lowest
 * rank first; ties and unranked fall back to newest published first, so
 * a rank-free feed behaves exactly as before the column existed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign } from "./factories";
import { orderFeedByRank, compareFeedOrder } from "@/lib/discover-feed";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

// vi.mock is hoisted; the getter defers db access until call time, by when
// beforeEach has assigned the per-test database.
vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { getPublishedFeed } = await import("@/lib/discover-feed");

const at = (minutesAgo: number) =>
  new Date(Date.UTC(2026, 0, 1, 12, 0) - minutesAgo * 60_000);

function row(
  designId: string,
  opts: { publishedMinutesAgo: number; feedRank?: number | null }
) {
  return {
    designId,
    publishedAt: at(opts.publishedMinutesAgo),
    feedRank: opts.feedRank ?? null,
  };
}

describe("orderFeedByRank (pure)", () => {
  it("keeps a rank-free feed newest first (legacy behavior)", () => {
    const out = orderFeedByRank([
      row("a", { publishedMinutesAgo: 30 }),
      row("b", { publishedMinutesAgo: 10 }),
      row("c", { publishedMinutesAgo: 20 }),
    ]);
    expect(out.map((r) => r.designId)).toEqual(["b", "c", "a"]);
  });

  it("lists ranked before unranked, lowest rank first", () => {
    const out = orderFeedByRank([
      row("old-ranked", { publishedMinutesAgo: 60, feedRank: 2 }),
      row("newest-unranked", { publishedMinutesAgo: 1 }),
      row("older-ranked-first", { publishedMinutesAgo: 90, feedRank: 1 }),
    ]);
    expect(out.map((r) => r.designId)).toEqual([
      "older-ranked-first",
      "old-ranked",
      "newest-unranked",
    ]);
  });

  it("equal ranks fall back to newest published first", () => {
    const out = orderFeedByRank([
      row("older", { publishedMinutesAgo: 50, feedRank: 3 }),
      row("newer", { publishedMinutesAgo: 5, feedRank: 3 }),
    ]);
    expect(out.map((r) => r.designId)).toEqual(["newer", "older"]);
  });

  it("dedupes per design; a ranked image beats a newer unranked sibling", () => {
    const ranked = { ...row("d", { publishedMinutesAgo: 40, feedRank: 1 }), tag: "ranked" };
    const newer = { ...row("d", { publishedMinutesAgo: 2 }), tag: "newer" };
    const out = orderFeedByRank([newer, ranked]);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe("ranked");
  });

  it("comparator is antisymmetric on the rank/unranked boundary", () => {
    const a = row("a", { publishedMinutesAgo: 10, feedRank: 5 });
    const b = row("b", { publishedMinutesAgo: 1 });
    expect(compareFeedOrder(a, b)).toBeLessThan(0);
    expect(compareFeedOrder(b, a)).toBeGreaterThan(0);
  });
});

describe("getPublishedFeed (real DB)", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  async function publishImage(
    userId: string,
    opts: {
      publishedMinutesAgo: number;
      feedRank?: number | null;
      hidden?: boolean;
      published?: boolean;
      designId?: string;
    }
  ) {
    const designId = opts.designId ?? (await makeDesign(testDb, userId)).id;
    const [img] = await testDb
      .insert(schema.designImage)
      .values({
        designId,
        aspectRatio: "1:1",
        imageUrl: `https://img.example/${crypto.randomUUID()}.png`,
        publishedAt:
          opts.published === false ? null : at(opts.publishedMinutesAgo),
        isHidden: opts.hidden ?? false,
        feedRank: opts.feedRank ?? null,
      })
      .returning();
    return { designId, imageId: img.id };
  }

  it("serves ranked designs first, then the rest newest first", async () => {
    await makeUser(testDb, "nico");
    const unrankedNew = await publishImage("nico", { publishedMinutesAgo: 1 });
    const rank2 = await publishImage("nico", {
      publishedMinutesAgo: 120,
      feedRank: 2,
    });
    const rank1 = await publishImage("nico", {
      publishedMinutesAgo: 240,
      feedRank: 1,
    });
    const unrankedOld = await publishImage("nico", { publishedMinutesAgo: 30 });

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId)).toEqual([
      rank1.imageId,
      rank2.imageId,
      unrankedNew.imageId,
      unrankedOld.imageId,
    ]);
    expect(feed[0].feedRank).toBe(1);
    expect(feed[2].feedRank).toBeNull();
  });

  it("still excludes hidden and unpublished images, ranked or not", async () => {
    await makeUser(testDb, "nico");
    const visible = await publishImage("nico", { publishedMinutesAgo: 10 });
    await publishImage("nico", {
      publishedMinutesAgo: 5,
      feedRank: 1,
      hidden: true,
    });
    await publishImage("nico", {
      publishedMinutesAgo: 5,
      feedRank: 2,
      published: false,
    });

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId)).toEqual([visible.imageId]);
  });

  it("one card per design; the ranked image represents its design", async () => {
    await makeUser(testDb, "nico");
    const first = await publishImage("nico", {
      publishedMinutesAgo: 60,
      feedRank: 1,
    });
    // A newer unranked publish in the same design must not displace the
    // admin's ranked pick.
    await publishImage("nico", {
      publishedMinutesAgo: 1,
      designId: first.designId,
    });
    const other = await publishImage("nico", { publishedMinutesAgo: 15 });

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId)).toEqual([
      first.imageId,
      other.imageId,
    ]);
  });

  it("respects the limit after dedupe", async () => {
    await makeUser(testDb, "nico");
    for (let i = 0; i < 5; i++) {
      await publishImage("nico", { publishedMinutesAgo: i + 1 });
    }
    const feed = await getPublishedFeed(3);
    expect(feed).toHaveLength(3);
  });
});
