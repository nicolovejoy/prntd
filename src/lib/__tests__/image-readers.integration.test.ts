/**
 * Model B read paths (docs/model-b-migration-plan.md). Every reader in
 * design-images / back-sources / discover-feed resolves against `image`,
 * `conversation_image`, `image_publication` (named `listing` until composition
 * slice 5) and `placement_render` — `design_image` was dropped in Model B
 * slice 5. Drives them against a real in-memory libSQL through the
 * live write paths (insertDesignImage). Also locks the id-reuse contract
 * (§2/§5): a pinned placement id resolves whether it was minted as an
 * artifact or as a placement render.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "./factories";

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
  getDesignImagesForAIContext,
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

beforeEach(async () => {
  testDb = await createTestDb();
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

  it("a hidden publication leaves the feed but stays resolvable by id", async () => {
    const ids = await seed();
    const publishedAt = new Date(Date.UTC(2026, 0, 1, 11, 55));
    await testDb.insert(schema.imagePublication).values({
      imageId: ids.secondId,
      publishedAt,
      isHidden: true,
    });

    expect(await getPublishedFeed()).toEqual([]);
    const img = await getDesignImageWithOwner(ids.secondId);
    expect(img?.isHidden).toBe(true);
    expect(img?.publishedAt).toEqual(publishedAt);
  });

  it("resolveImagesByIds resolves ids across the artifact and render tables", async () => {
    const ids = await seed();
    const map = await resolveImagesByIds([ids.secondId, ids.renderId, "nope"]);
    expect(map.get(ids.secondId)?.imageUrl).toBe("https://cdn/live/2.png");
    expect(map.get(ids.renderId)?.aspectRatio).toBe("1:2");
    expect(map.has("nope")).toBe(false);
  });

  it("resolveOrderImageUrls prefers the pinned image, falling back per order", async () => {
    const ids = await seed();
    const urls = await resolveOrderImageUrls(
      [
        { id: "o1", designId: ids.designId, placements: { front: ids.secondId } },
        { id: "o2", designId: ids.designId, placements: { front: ids.renderId } },
        { id: "o3", designId: ids.designId, placements: null },
      ],
      new Map([[ids.designId, "https://cdn/fallback.png"]])
    );
    expect(urls.get("o1")).toBe("https://cdn/live/2.png");
    expect(urls.get("o2")).toBe("https://cdn/live/back.png");
    expect(urls.get("o3")).toBe("https://cdn/fallback.png");
  });

  it("resolveDesignDisplayImageUrls resolves via primary, then falls back to the latest output", async () => {
    const ids = await seed();
    await testDb
      .update(schema.design)
      .set({ primaryImageId: ids.secondId })
      .where(eq(schema.design.id, ids.designId));

    let urls = await resolveDesignDisplayImageUrls([ids.designId]);
    expect(urls.get(ids.designId)).toBe("https://cdn/live/2.png");

    await testDb
      .update(schema.design)
      .set({ primaryImageId: null })
      .where(eq(schema.design.id, ids.designId));
    urls = await resolveDesignDisplayImageUrls([ids.designId]);
    expect(urls.get(ids.designId)).toBe("https://cdn/live/2.png");
  });

  it("getDesignPlacementRenders groups renders by blank", async () => {
    const ids = await seed();
    const groups = await getDesignPlacementRenders(ids.designId);
    expect(groups).toHaveLength(1);
    expect(groups[0].productId).toBe("bella-canvas-3001");
    expect(groups[0].images.map((i) => i.id)).toEqual([ids.renderId]);
    expect(groups[0].images[0].placementId).toBe("back");
  });
});

describe("hidden images in the conversation readers", () => {
  const publishedAt = new Date(Date.UTC(2026, 0, 1, 11, 55));

  // Three outputs in creation order; the middle one is admin-hidden.
  async function seedThree() {
    await makeUser(testDb, "nico");
    const design = await makeDesign(testDb, "nico");
    const first = await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "nico",
      imageUrl: "https://cdn/h/1.png",
    });
    const hidden = await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "nico",
      imageUrl: "https://cdn/h/2-hidden.png",
      publishedAt,
      isHidden: true,
    });
    const third = await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "nico",
      imageUrl: "https://cdn/h/3.png",
    });
    return { designId: design.id, first, hidden, third };
  }

  it("getDesignSourceImages leaves a hidden image out and keeps creation order", async () => {
    const ids = await seedThree();
    const sources = await getDesignSourceImages(ids.designId);
    expect(sources.map((s) => s.id)).toEqual([ids.first, ids.third]);
  });

  it("returns an image with no publication row and a published, not hidden one", async () => {
    await makeUser(testDb, "nico");
    const design = await makeDesign(testDb, "nico");
    const unpublished = await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "nico",
      imageUrl: "https://cdn/h/unpublished.png",
    });
    const published = await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "nico",
      imageUrl: "https://cdn/h/published.png",
      publishedAt,
      isHidden: false,
    });
    const sources = await getDesignSourceImages(design.id);
    expect(sources.map((s) => s.id)).toEqual([unpublished, published]);
  });

  it("getDesignImagesForAIContext numbers the visible images 1 and 2", async () => {
    const ids = await seedThree();
    const context = await getDesignImagesForAIContext(ids.designId);
    expect(context.map((c) => [c.number, c.id])).toEqual([
      [1, ids.first],
      [2, ids.third],
    ]);
    // The gallery and the AI context are the same list, so a number means
    // the same image in both.
    const sources = await getDesignSourceImages(ids.designId, {
      includeSeeds: true,
    });
    expect(context.map((c) => c.id)).toEqual(sources.map((s) => s.id));
  });

  it("includeSeeds leaves a hidden seed out too", async () => {
    const ids = await seedThree();
    // A hidden image from another conversation, linked here as a seed.
    await makeUser(testDb, "other");
    const otherDesign = await makeDesign(testDb, "other");
    const hiddenSeed = await makeSourceImage(testDb, {
      designId: otherDesign.id,
      ownerId: "other",
      imageUrl: "https://cdn/h/seed-hidden.png",
      publishedAt,
      isHidden: true,
    });
    const visibleSeed = await makeSourceImage(testDb, {
      designId: otherDesign.id,
      ownerId: "other",
      imageUrl: "https://cdn/h/seed-visible.png",
      publishedAt,
      isHidden: false,
    });
    await testDb.insert(schema.conversationImage).values([
      { designId: ids.designId, imageId: hiddenSeed, role: "seed" },
      { designId: ids.designId, imageId: visibleSeed, role: "seed" },
    ]);

    const sources = await getDesignSourceImages(ids.designId, {
      includeSeeds: true,
    });
    const seeds = sources.filter((s) => s.role === "seed").map((s) => s.id);
    expect(seeds).toEqual([visibleSeed]);
    expect(sources.map((s) => s.id)).not.toContain(ids.hidden);
    expect(sources.map((s) => s.id)).not.toContain(hiddenSeed);
  });

  it("getDesignPlacementRenders leaves out a render sourced from a hidden image", async () => {
    const ids = await seedThree();
    const renderValues = (sourceImageId: string | null, imageUrl: string) => ({
      designId: ids.designId,
      sourceImageId,
      blankId: "bella-canvas-3001",
      placementId: "front",
      imageUrl,
      aspectRatio: "1:1",
    });
    await testDb.insert(schema.placementRender).values([
      renderValues(ids.first, "https://cdn/h/render-of-1.png"),
      renderValues(ids.hidden, "https://cdn/h/render-of-hidden.png"),
      renderValues(null, "https://cdn/h/render-legacy.png"),
    ]);
    const groups = await getDesignPlacementRenders(ids.designId);
    expect(groups).toHaveLength(1);
    expect(groups[0].images.map((i) => i.imageUrl)).toEqual([
      "https://cdn/h/render-of-1.png",
      "https://cdn/h/render-legacy.png",
    ]);
  });

  it("resolveDesignDisplayImageUrls is unchanged by default and skips a hidden primary on request", async () => {
    const ids = await seedThree();
    await testDb
      .update(schema.design)
      .set({ primaryImageId: ids.hidden })
      .where(eq(schema.design.id, ids.designId));

    // Admin pages, order emails and the like keep seeing the primary.
    let urls = await resolveDesignDisplayImageUrls([ids.designId]);
    expect(urls.get(ids.designId)).toBe("https://cdn/h/2-hidden.png");

    // The owner's pages ask for the same fallback a missing primary gets:
    // the latest output that is not hidden.
    urls = await resolveDesignDisplayImageUrls([ids.designId], {
      excludeHidden: true,
    });
    expect(urls.get(ids.designId)).toBe("https://cdn/h/3.png");
  });

  it("excludeHidden also skips a hidden image in the latest-output fallback", async () => {
    const ids = await seedThree();
    // Hide the newest output too; no primary is set.
    await testDb.insert(schema.imagePublication).values({
      imageId: ids.third,
      publishedAt,
      isHidden: true,
    });
    const urls = await resolveDesignDisplayImageUrls([ids.designId], {
      excludeHidden: true,
    });
    expect(urls.get(ids.designId)).toBe("https://cdn/h/1.png");
  });

  it("excludeHidden leaves a design with only hidden images out of the map", async () => {
    await makeUser(testDb, "nico");
    const design = await makeDesign(testDb, "nico");
    await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "nico",
      imageUrl: "https://cdn/h/only-hidden.png",
      publishedAt,
      isHidden: true,
    });
    const urls = await resolveDesignDisplayImageUrls([design.id], {
      excludeHidden: true,
    });
    expect(urls.has(design.id)).toBe(false);
  });
});
