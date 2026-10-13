// @vitest-environment node
/**
 * `checkFeedVisibilityParity` against a real in-memory libSQL built from
 * schema.ts. Agreeing data is seeded through `makeSourceImage` (publication
 * row and composition written together); each disagreement is made by
 * changing one table afterwards.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Client } from "@libsql/client";
import { eq, sql } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign, makeSourceImage } from "./factories";
import * as schema from "@/lib/db/schema";
import { checkFeedVisibilityParity } from "@/lib/feed-visibility-parity";
import { planDesignDeletion, executeDesignDeletion } from "@/lib/delete-design";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

// vi.mock is hoisted; the getter defers db access until call time.
vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { getPublishedFeed } = await import("@/lib/discover-feed");

const client = () => (testDb as any).$client as Client;
const check = () => checkFeedVisibilityParity(client());

async function seed(opts: { hidden?: boolean } = {}): Promise<string> {
  const designId = (await makeDesign(testDb, "nico")).id;
  return makeSourceImage(testDb, {
    designId,
    ownerId: "nico",
    imageUrl: `https://img.example/${crypto.randomUUID()}.png`,
    publishedAt: new Date(Date.UTC(2026, 0, 1, 12, 0)),
    isHidden: opts.hidden ?? false,
  });
}

const setStatus = (imageId: string, status: "draft" | "listed" | "hidden") =>
  testDb
    .update(schema.product)
    .set({ status })
    .where(sql`json_extract(placements, '$.front') = ${imageId}`);

const setHidden = (imageId: string, isHidden: boolean) =>
  testDb
    .update(schema.imagePublication)
    .set({ isHidden })
    .where(eq(schema.imagePublication.imageId, imageId));

const dropPublication = (imageId: string) =>
  testDb
    .delete(schema.imagePublication)
    .where(eq(schema.imagePublication.imageId, imageId));

const dropProduct = (imageId: string) =>
  testDb
    .delete(schema.product)
    .where(sql`json_extract(placements, '$.front') = ${imageId}`);

describe("checkFeedVisibilityParity", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    await makeUser(testDb, "nico");
  });

  it("is clean when the tables agree, and matches the feed getPublishedFeed serves", async () => {
    const listed = await seed();
    const hidden = await seed({ hidden: true });
    // What unpublish leaves behind: a draft composition, no publication row.
    const draft = await seed();
    await setStatus(draft, "draft");
    await dropPublication(draft);
    // An image that was never published has neither row.
    await makeSourceImage(testDb, {
      designId: (await makeDesign(testDb, "nico")).id,
      ownerId: "nico",
      imageUrl: "https://img.example/never-published.png",
    });

    const report = await check();
    expect(report.disagreements).toEqual([]);
    expect(report.clean).toBe(true);
    expect(report.onlyOld).toEqual([]);
    expect(report.onlyNew).toEqual([]);
    expect(report.oldFeedImageIds).toEqual([listed]);
    expect(report.newFeedImageIds).toEqual([listed]);
    expect(report.counts).toMatchObject({
      publications: 2,
      publicationsHidden: 1,
      compositions: 3,
      compositionsListed: 1,
      compositionsHidden: 1,
      compositionsDraft: 1,
    });

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId).sort()).toEqual(report.newFeedImageIds);
    expect(feed.map((r) => r.imageId)).not.toContain(hidden);
  });

  it("direction A: a hidden publication on a listed composition is only in the old feed", async () => {
    const stale = await seed();
    const ok = await seed();
    await setHidden(stale, true);

    const report = await check();
    expect(report.clean).toBe(false);
    expect(report.onlyOld).toEqual([stale]);
    expect(report.onlyNew).toEqual([]);
    expect(report.oldFeedImageIds).toContain(stale);
    expect(report.newFeedImageIds).toEqual([ok]);
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0]).toMatchObject({
      kind: "publication",
      imageId: stale,
      productStatus: "listed",
      isHidden: true,
    });
    expect(report.disagreements[0].productId).toEqual(expect.any(String));
    expect(report.disagreements[0].reason).toContain("expects status hidden");
  });

  it("direction B: a visible publication on a hidden composition is only in the new feed", async () => {
    const stale = await seed();
    const ok = await seed();
    await setStatus(stale, "hidden");

    const report = await check();
    expect(report.clean).toBe(false);
    expect(report.onlyOld).toEqual([]);
    expect(report.onlyNew).toEqual([stale]);
    expect(report.oldFeedImageIds).toEqual([ok]);
    expect(report.newFeedImageIds).toContain(stale);
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0]).toMatchObject({
      kind: "publication",
      imageId: stale,
      productStatus: "hidden",
      isHidden: false,
    });
    expect(report.disagreements[0].reason).toContain("expects status listed");
  });

  it("a visible publication on a draft composition is only in the new feed", async () => {
    const stale = await seed();
    await setStatus(stale, "draft");

    const report = await check();
    expect(report.clean).toBe(false);
    expect(report.onlyNew).toEqual([stale]);
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0]).toMatchObject({
      kind: "publication",
      imageId: stale,
      productStatus: "draft",
      isHidden: false,
    });
  });

  it("a listed composition with no publication row is a composition-side disagreement and only in the old feed", async () => {
    const orphan = await seed();
    await dropPublication(orphan);

    const report = await check();
    expect(report.clean).toBe(false);
    expect(report.onlyOld).toEqual([orphan]);
    expect(report.onlyNew).toEqual([]);
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0]).toMatchObject({
      kind: "composition",
      imageId: orphan,
      productStatus: "listed",
      isHidden: null,
    });
    expect(report.disagreements[0].reason).toContain("no image_publication row");
  });

  it("a hidden composition with no publication row disagrees but leaves the feeds equal", async () => {
    const orphan = await seed({ hidden: true });
    await dropPublication(orphan);

    const report = await check();
    expect(report.clean).toBe(true);
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0]).toMatchObject({
      kind: "composition",
      imageId: orphan,
      productStatus: "hidden",
      isHidden: null,
    });
  });

  it("a publication with no composition is reported with a null product, and neither feed shows it", async () => {
    const lone = await seed();
    await dropProduct(lone);

    const report = await check();
    expect(report.clean).toBe(true);
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0]).toMatchObject({
      kind: "publication",
      imageId: lone,
      productId: null,
      productStatus: null,
      isHidden: false,
    });
    expect(report.newFeedImageIds).toEqual([]);
  });

  it("lists the visible listing whose conversation is gone, and only that one", async () => {
    const ordinary = await seed();
    const hidden = await seed({ hidden: true });

    // Real delete path: the image is also a seed elsewhere, so it survives.
    const homeId = (await makeDesign(testDb, "nico")).id;
    const gone = await makeSourceImage(testDb, {
      designId: homeId,
      ownerId: "nico",
      imageUrl: "https://img.example/gone.png",
      publishedAt: new Date(Date.UTC(2026, 0, 1, 12, 0)),
      title: "Gone title",
    });
    const other = await makeDesign(testDb, "nico");
    await testDb
      .insert(schema.conversationImage)
      .values({ designId: other.id, imageId: gone, role: "seed" });
    await executeDesignDeletion(testDb, await planDesignDeletion(testDb, homeId));

    const report = await check();
    expect(report.feedImageIds).toEqual([ordinary]);
    expect(report.leftOutNoConversation).toHaveLength(1);
    expect(report.leftOutNoConversation[0]).toMatchObject({
      imageId: gone,
      title: "Gone title",
      conversationId: homeId,
    });
    expect(report.leftOutNoConversation[0].productId).toEqual(expect.any(String));
    expect(report.leftOutNoConversation.map((l) => l.imageId)).not.toContain(hidden);

    // The old-versus-new comparison is untouched by the conversation rule.
    expect(report.clean).toBe(true);
    expect(report.disagreements).toEqual([]);
    expect(report.onlyOld).toEqual([]);
    expect(report.onlyNew).toEqual([]);
    expect(report.newFeedImageIds).toEqual([ordinary, gone].sort());

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId).sort()).toEqual(report.feedImageIds);
  });

  it("reports a null conversation id for a listing with no source and no output link", async () => {
    const orphan = await seed();
    await testDb
      .update(schema.image)
      .set({ sourceDesignId: null })
      .where(eq(schema.image.id, orphan));
    await testDb
      .delete(schema.conversationImage)
      .where(eq(schema.conversationImage.imageId, orphan));

    const report = await check();
    expect(report.feedImageIds).toEqual([]);
    expect(report.leftOutNoConversation.map((l) => [l.imageId, l.conversationId])).toEqual([
      [orphan, null],
    ]);
  });

  it("a null source_design_id with a live output link is in the feed, not left out, and listed as null-source", async () => {
    const ordinary = await seed();
    const legacy = await seed();
    await testDb
      .update(schema.image)
      .set({ sourceDesignId: null })
      .where(eq(schema.image.id, legacy));

    const report = await check();
    expect(report.feedImageIds).toEqual([ordinary, legacy].sort());
    expect(report.leftOutNoConversation).toEqual([]);
    expect(report.nullSourceListings.map((l) => l.imageId)).toEqual([legacy]);
    expect(report.nullSourceListings[0].conversationId).toEqual(expect.any(String));
    expect(report.clean).toBe(true);
  });

  it("reports no null-source listings when every image has a source_design_id", async () => {
    await seed();
    expect((await check()).nullSourceListings).toEqual([]);
  });

  it("writes nothing", async () => {
    const stale = await seed();
    await setHidden(stale, true);
    const rows = async () =>
      JSON.stringify([
        (await client().execute("select * from `product` order by id")).rows,
        (await client().execute("select * from `image_publication` order by image_id")).rows,
      ]);
    const before = await rows();

    await check();
    expect(await rows()).toBe(before);
  });
});
