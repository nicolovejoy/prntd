/**
 * Shop feed ordering (admin feed_rank), pure + against a real in-memory
 * libSQL (the #28 pattern). Ranked images list before unranked, lowest
 * rank first; ties and unranked fall back to newest published first, so
 * a rank-free feed behaves exactly as before the column existed.
 *
 * Visibility is `image_publication.is_hidden`; `product.status` is not read.
 * The last describe block makes the two tables disagree on purpose and checks
 * the feed follows the publication row.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign, makeSourceImage } from "./factories";
import { orderFeedByRank, compareFeedOrder } from "@/lib/discover-feed";
import * as schema from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { planDesignDeletion, executeDesignDeletion } from "@/lib/delete-design";

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
const { resolveBuyableImage } = await import("@/lib/buyable-image");

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
    const imageId = await makeSourceImage(testDb, {
      designId,
      ownerId: userId,
      imageUrl: `https://img.example/${crypto.randomUUID()}.png`,
      publishedAt:
        opts.published === false ? null : at(opts.publishedMinutesAgo),
      isHidden: opts.hidden ?? false,
      feedRank: opts.feedRank ?? null,
    });
    return { designId, imageId };
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

  it("carries the mirror product's blank id, null when the buyer picks", async () => {
    // Every Shop mirror is written with blank_id NULL (model-b-writes.ts), so
    // the null case is the production path; the fixed case is what a later
    // composition UI (a shirt with a fixed garment) would write — nothing
    // writes it yet, slice 5 included.
    await makeUser(testDb, "nico");
    await publishImage("nico", { publishedMinutesAgo: 1 });

    const feed = await getPublishedFeed();
    expect(feed.length).toBeGreaterThan(0);
    for (const row of feed) {
      expect(row).toHaveProperty("blankId");
    }
    expect(feed.every((r) => r.blankId === null)).toBe(true);
  });

  it("carries a fixed blank id when the composition fixes one", async () => {
    await makeUser(testDb, "nico");
    const fixed = await publishImage("nico", { publishedMinutesAgo: 5 });

    await testDb
      .update(schema.product)
      .set({ blankId: "cotton-heritage-mc1087" })
      .where(sql`json_extract(placements, '$.front') = ${fixed.imageId}`);

    const feed = await getPublishedFeed();
    const row = feed.find((r) => r.imageId === fixed.imageId);
    expect(row?.blankId).toBe("cotton-heritage-mc1087");
  });
});

describe("getPublishedFeed visibility follows image_publication", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    await makeUser(testDb, "nico");
  });

  async function publishImage(
    opts: { hidden?: boolean; publishedMinutesAgo?: number } = {}
  ) {
    const designId = (await makeDesign(testDb, "nico")).id;
    return makeSourceImage(testDb, {
      designId,
      ownerId: "nico",
      imageUrl: `https://img.example/${crypto.randomUUID()}.png`,
      publishedAt: at(opts.publishedMinutesAgo ?? 10),
      isHidden: opts.hidden ?? false,
    });
  }

  const setStatus = (imageId: string, status: "draft" | "listed" | "hidden") =>
    testDb
      .update(schema.product)
      .set({ status })
      .where(sql`json_extract(placements, '$.front') = ${imageId}`);

  it("leaves out an image whose publication row is hidden", async () => {
    const visible = await publishImage();
    await publishImage({ hidden: true });

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId)).toEqual([visible]);
  });

  it("leaves out a hidden publication even when the composition still says listed", async () => {
    const visible = await publishImage();
    const hidden = await publishImage();
    await testDb
      .update(schema.imagePublication)
      .set({ isHidden: true })
      .where(eq(schema.imagePublication.imageId, hidden));
    // The composition was not touched: it still reads "listed".

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId)).toEqual([visible]);
  });

  it("shows a visible publication even when the composition says hidden", async () => {
    const stale = await publishImage();
    await setStatus(stale, "hidden");

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId)).toEqual([stale]);
  });

  it("leaves out a listed composition whose image has no publication row", async () => {
    const visible = await publishImage();
    const orphan = await publishImage();
    await testDb
      .delete(schema.imagePublication)
      .where(eq(schema.imagePublication.imageId, orphan));

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId)).toEqual([visible]);
  });
});

describe("getPublishedFeed leaves out a listing with no live conversation (#321)", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    await makeUser(testDb, "nico");
  });

  async function publish(
    opts: { minutesAgo?: number; feedRank?: number | null; hidden?: boolean; designId?: string } = {}
  ) {
    const designId = opts.designId ?? (await makeDesign(testDb, "nico")).id;
    const imageId = await makeSourceImage(testDb, {
      designId,
      ownerId: "nico",
      imageUrl: `https://img.example/${crypto.randomUUID()}.png`,
      publishedAt: at(opts.minutesAgo ?? 10),
      isHidden: opts.hidden ?? false,
      feedRank: opts.feedRank ?? null,
    });
    return { designId, imageId };
  }

  // The real delete path: the image is also a seed in a second conversation,
  // so deleting its home conversation detaches it and the image survives.
  async function publishConversationGone(
    opts: { minutesAgo?: number; feedRank?: number | null } = {}
  ) {
    const p = await publish(opts);
    const other = await makeDesign(testDb, "nico");
    await testDb
      .insert(schema.conversationImage)
      .values({ designId: other.id, imageId: p.imageId, role: "seed" });
    const plan = await planDesignDeletion(testDb, p.designId);
    await executeDesignDeletion(testDb, plan);
    const [gone] = await testDb
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, p.designId));
    expect(gone).toBeUndefined();
    return p;
  }

  it("an ordinary published listing is in the feed", async () => {
    const ok = await publish();
    expect((await getPublishedFeed()).map((r) => r.imageId)).toEqual([ok.imageId]);
  });

  it("drops a visible listing whose conversation was deleted, keeps the ordinary one", async () => {
    const gone = await publishConversationGone();
    const ok = await publish();
    const ids = (await getPublishedFeed()).map((r) => r.imageId);
    expect(ids).toEqual([ok.imageId]);
    expect(ids).not.toContain(gone.imageId);
  });

  it("agrees with resolveBuyableImage(id, null) over a mix of states", async () => {
    const ordinary = await publish({ minutesAgo: 1 });
    const hidden = await publish({ minutesAgo: 2, hidden: true });
    const gone = await publishConversationGone({ minutesAgo: 3 });
    const nullSourceLive = await publish({ minutesAgo: 4 });
    await testDb
      .update(schema.image)
      .set({ sourceDesignId: null })
      .where(eq(schema.image.id, nullSourceLive.imageId));
    const nullSourceNoLink = await publish({ minutesAgo: 5 });
    await testDb
      .update(schema.image)
      .set({ sourceDesignId: null })
      .where(eq(schema.image.id, nullSourceNoLink.imageId));
    await testDb
      .delete(schema.conversationImage)
      .where(eq(schema.conversationImage.imageId, nullSourceNoLink.imageId));
    // source_design_id names a missing row while the output link names a live
    // conversation: the schema has no foreign key on source_design_id, so this
    // can be built. Neither the gate nor the feed falls back to the link.
    const staleSource = await publish({ minutesAgo: 6 });
    await testDb
      .update(schema.image)
      .set({ sourceDesignId: "missing-design" })
      .where(eq(schema.image.id, staleSource.imageId));

    const all = [ordinary, hidden, gone, nullSourceLive, nullSourceNoLink, staleSource];
    const buyable = new Set<string>();
    for (const p of all) {
      if ((await resolveBuyableImage(p.imageId, null)).ok) buyable.add(p.imageId);
    }
    const feedIds = new Set((await getPublishedFeed()).map((r) => r.imageId));
    expect(feedIds).toEqual(buyable);
    expect(feedIds).toEqual(new Set([ordinary.imageId, nullSourceLive.imageId]));
  });

  it("a dropped row does not take a slot: limit 1 returns the ordinary listing", async () => {
    await publishConversationGone({ feedRank: 1 });
    const ok = await publish({ minutesAgo: 30 });
    const feed = await getPublishedFeed(1);
    expect(feed.map((r) => r.imageId)).toEqual([ok.imageId]);
  });

  it("two published images of one live conversation still collapse to the ranked one", async () => {
    const first = await publish({ minutesAgo: 60, feedRank: 1 });
    await publish({ minutesAgo: 1, designId: first.designId });
    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId)).toEqual([first.imageId]);
    expect(feed[0].designId).toBe(first.designId);
  });
});
