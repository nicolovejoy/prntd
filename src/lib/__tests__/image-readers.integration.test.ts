/**
 * Model B slice-2 read swap (docs/model-b-migration-plan.md). Every reader in
 * design-images / back-sources / discover-feed now resolves against `image`,
 * `conversation_image`, `listing` and `placement_render`. This file drives them
 * against a real in-memory libSQL in both shapes that exist in production:
 *
 *  - dual-written: rows the live write paths landed (insertDesignImage).
 *  - legacy/backfilled: rows that only ever existed as design_image, promoted
 *    by scripts/backfill-model-b.ts.
 *
 * Both must read identically — that equivalence is the whole safety argument
 * for the swap. Also locks the id-reuse contract (§2/§5): a pinned placement id
 * resolves whether it was minted as an artifact or as a placement render.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser } from "./factories";
import { backfillModelB } from "../../../scripts/backfill-model-b";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const {
  insertDesignImage,
  getDesignSourceImages,
  getDesignImageById,
  getDesignImageWithOwner,
  getDesignPlacementRenders,
  findPlacementRender,
  findDesignImageByUrl,
  resolveImagesByIds,
  resolveOrderImageUrls,
  resolveDesignDisplayImageUrls,
} = await import("@/lib/design-images");
const { getPublishedFeed } = await import("@/lib/discover-feed");
const { getBackSourceGroups } = await import("@/lib/back-sources");

const at = (minutesAgo: number) =>
  new Date(Date.UTC(2026, 0, 1, 12, 0) - minutesAgo * 60_000);

beforeEach(async () => {
  testDb = await createTestDb();
});

/**
 * A design whose images exist ONLY as design_image rows — the pre-Model-B
 * shape every historical row is in until the backfill runs.
 */
async function seedLegacyDesign(userId: string) {
  const [design] = await testDb
    .insert(schema.design)
    .values({ userId })
    .returning();

  const [first] = await testDb
    .insert(schema.designImage)
    .values({
      designId: design.id,
      aspectRatio: "1:1",
      imageUrl: "https://cdn/legacy/1.png",
      prompt: "a fox",
      createdAt: at(120),
    })
    .returning();
  const [second] = await testDb
    .insert(schema.designImage)
    .values({
      designId: design.id,
      aspectRatio: "1:1",
      imageUrl: "https://cdn/legacy/2.png",
      prompt: "a fox, bolder",
      parentImageId: first.id,
      publishedAt: at(60),
      title: "Fox",
      description: "A fox",
      backgroundColor: "Black",
      createdAt: at(90),
    })
    .returning();
  const [render] = await testDb
    .insert(schema.designImage)
    .values({
      designId: design.id,
      aspectRatio: "1:2",
      productId: "bella-canvas-3001",
      placementId: "back",
      parentImageId: second.id,
      imageUrl: "https://cdn/legacy/back.png",
      createdAt: at(30),
    })
    .returning();

  await testDb
    .update(schema.design)
    .set({ primaryImageId: second.id })
    .where(eq(schema.design.id, design.id));

  return {
    designId: design.id,
    firstId: first.id,
    secondId: second.id,
    renderId: render.id,
  };
}

describe("readers on legacy rows promoted by the backfill", () => {
  async function seed() {
    await makeUser(testDb, "nico");
    const ids = await seedLegacyDesign("nico");
    await backfillModelB(testDb);
    return ids;
  }

  it("serves the thread gallery oldest → newest with publish state", async () => {
    const ids = await seed();
    const sources = await getDesignSourceImages(ids.designId);
    // The render is not an artifact — it never appears in the gallery.
    expect(sources.map((s) => s.id)).toEqual([ids.firstId, ids.secondId]);
    expect(sources[0].publishedAt).toBeNull();
    expect(sources[1].publishedAt).toEqual(at(60));
    expect(sources[1].prompt).toBe("a fox, bolder");
  });

  it("resolves an id whether it was an artifact or a render (id reuse)", async () => {
    const ids = await seed();

    const artifact = await getDesignImageById(ids.secondId);
    expect(artifact?.imageUrl).toBe("https://cdn/legacy/2.png");
    expect(artifact?.designId).toBe(ids.designId);
    expect(artifact?.publishedAt).toEqual(at(60));

    const render = await getDesignImageById(ids.renderId);
    expect(render?.imageUrl).toBe("https://cdn/legacy/back.png");
    expect(render?.designId).toBe(ids.designId);
    expect(render?.publishedAt).toBeNull();

    const both = await resolveImagesByIds([ids.secondId, ids.renderId, "nope"]);
    expect(both.get(ids.secondId)?.imageUrl).toBe("https://cdn/legacy/2.png");
    expect(both.get(ids.renderId)?.aspectRatio).toBe("1:2");
    expect(both.has("nope")).toBe(false);
  });

  it("carries the owner and moderation state onto the guard input", async () => {
    const ids = await seed();
    const img = await getDesignImageWithOwner(ids.secondId);
    expect(img?.ownerId).toBe("nico");
    expect(img?.isHidden).toBe(false);
    expect(img?.publishedAt).toEqual(at(60));

    // A render's owner comes from its conversation.
    const render = await getDesignImageWithOwner(ids.renderId);
    expect(render?.ownerId).toBe("nico");
  });

  it("keeps the placement-render cache keyed on design/blank/placement/source", async () => {
    const ids = await seed();
    const hit = await findPlacementRender(
      ids.designId,
      "bella-canvas-3001",
      "back",
      ids.secondId
    );
    expect(hit?.id).toBe(ids.renderId);
    // Anchored on a different source → miss.
    expect(
      await findPlacementRender(
        ids.designId,
        "bella-canvas-3001",
        "back",
        ids.firstId
      )
    ).toBeNull();

    const groups = await getDesignPlacementRenders(ids.designId);
    expect(groups).toHaveLength(1);
    expect(groups[0].productId).toBe("bella-canvas-3001");
    expect(groups[0].images.map((i) => i.id)).toEqual([ids.renderId]);
    expect(groups[0].images[0].placementId).toBe("back");
  });

  it("pins an order's image by url and resolves it back", async () => {
    const ids = await seed();
    const pinned = await findDesignImageByUrl(
      ids.designId,
      "https://cdn/legacy/2.png"
    );
    expect(pinned).toBe(ids.secondId);

    const urls = await resolveOrderImageUrls(
      [
        { id: "o1", designId: ids.designId, placements: { front: pinned! } },
        { id: "o2", designId: ids.designId, placements: { front: ids.renderId } },
        { id: "o3", designId: ids.designId, placements: null },
      ],
      new Map([[ids.designId, "https://cdn/fallback.png"]])
    );
    expect(urls.get("o1")).toBe("https://cdn/legacy/2.png");
    expect(urls.get("o2")).toBe("https://cdn/legacy/back.png");
    expect(urls.get("o3")).toBe("https://cdn/fallback.png");
  });

  it("resolves the display image via primary, then latest artifact", async () => {
    const ids = await seed();
    let urls = await resolveDesignDisplayImageUrls([ids.designId]);
    expect(urls.get(ids.designId)).toBe("https://cdn/legacy/2.png");

    // Drop the primary pointer → newest output artifact wins (which the
    // backfill's carried-over timestamps make deterministic).
    await testDb
      .update(schema.design)
      .set({ primaryImageId: null })
      .where(eq(schema.design.id, ids.designId));
    urls = await resolveDesignDisplayImageUrls([ids.designId]);
    expect(urls.get(ids.designId)).toBe("https://cdn/legacy/2.png");
  });

  it("lists the published image in the feed and the Shop back-source group", async () => {
    const ids = await seed();

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId)).toEqual([ids.secondId]);
    expect(feed[0].title).toBe("Fox");
    expect(feed[0].backgroundColor).toBe("Black");
    expect(feed[0].designerName).toBe("nico");
    expect(feed[0].designerId).toBe("nico");

    // From another user's thread, the same image is the Shop group.
    await makeUser(testDb, "stranger");
    const [other] = await testDb
      .insert(schema.design)
      .values({ userId: "stranger" })
      .returning();
    const groups = await getBackSourceGroups({
      designId: other.id,
      userId: "stranger",
    });
    expect(
      groups.find((g) => g.id === "shop")?.images.map((i) => i.id)
    ).toEqual([ids.secondId]);
  });

  it("moves fork lineage onto the image graph", async () => {
    await makeUser(testDb, "nico");
    const seedIds = await seedLegacyDesign("nico");
    const [forked] = await testDb
      .insert(schema.design)
      .values({
        userId: "nico",
        forkedFromImageId: seedIds.secondId,
        originalDesignerId: "nico",
      })
      .returning();
    await testDb.insert(schema.designImage).values({
      designId: forked.id,
      aspectRatio: "1:1",
      imageUrl: "https://cdn/forked/1.png",
    });
    await backfillModelB(testDb);

    const [child] = await testDb
      .select()
      .from(schema.image)
      .where(eq(schema.image.sourceDesignId, forked.id));
    expect(child.seedImageId).toBe(seedIds.secondId);
    expect(child.originalDesignerId).toBe("nico");

    const seedLinks = await testDb
      .select()
      .from(schema.conversationImage)
      .where(eq(schema.conversationImage.role, "seed"));
    expect(seedLinks.map((l) => l.designId)).toEqual([forked.id]);
  });
});

describe("readers on dual-written rows", () => {
  async function seed() {
    await makeUser(testDb, "nico");
    const [design] = await testDb
      .insert(schema.design)
      .values({ userId: "nico" })
      .returning();

    const firstId = await insertDesignImage({
      designId: design.id,
      imageUrl: "https://cdn/live/1.png",
      aspectRatio: "1:1",
      prompt: "a fox",
      generationCost: 0.03,
    });
    const secondId = await insertDesignImage({
      designId: design.id,
      imageUrl: "https://cdn/live/2.png",
      aspectRatio: "1:1",
      prompt: "a fox, bolder",
      generationCost: 0.03,
    });
    const renderId = await insertDesignImage({
      designId: design.id,
      imageUrl: "https://cdn/live/back.png",
      aspectRatio: "1:2",
      generationCost: 0.03,
      productId: "bella-canvas-3001",
      placementId: "back",
      parentImageId: secondId,
    });
    return { designId: design.id, firstId, secondId, renderId };
  }

  it("serves the gallery, the render cache, and the id lookups", async () => {
    const ids = await seed();

    const sources = await getDesignSourceImages(ids.designId);
    expect(sources.map((s) => s.id)).toEqual([ids.firstId, ids.secondId]);

    // The provenance chain anchors on the previous artifact, not the render.
    const [second] = await testDb
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, ids.secondId));
    expect(second.parentImageId).toBe(ids.firstId);

    expect(
      (await findPlacementRender(
        ids.designId,
        "bella-canvas-3001",
        "back",
        ids.secondId
      ))?.id
    ).toBe(ids.renderId);
    expect((await getDesignImageById(ids.renderId))?.imageUrl).toBe(
      "https://cdn/live/back.png"
    );
    expect(
      await findDesignImageByUrl(ids.designId, "https://cdn/live/back.png")
    ).toBe(ids.renderId);
  });

  it("an unpublished image reads as unpublished and not hidden", async () => {
    const ids = await seed();
    const img = await getDesignImageWithOwner(ids.firstId);
    expect(img?.publishedAt).toBeNull();
    expect(img?.isHidden).toBe(false);
    expect(img?.ownerId).toBe("nico");
    expect(await getPublishedFeed()).toEqual([]);
  });

  it("a hidden listing leaves the feed but stays resolvable by id", async () => {
    const ids = await seed();
    await testDb.insert(schema.listing).values({
      imageId: ids.secondId,
      publishedAt: at(5),
      isHidden: true,
      title: "Hidden",
    });

    expect(await getPublishedFeed()).toEqual([]);
    const img = await getDesignImageWithOwner(ids.secondId);
    expect(img?.isHidden).toBe(true);
    expect(img?.publishedAt).toEqual(at(5));
  });
});
