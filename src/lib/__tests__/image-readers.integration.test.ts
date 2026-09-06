/**
 * Model B read paths (docs/model-b-migration-plan.md). Every reader in
 * design-images / back-sources / discover-feed resolves against `image`,
 * `conversation_image`, `listing` and `placement_render` — `design_image` was
 * dropped in slice 5. Drives them against a real in-memory libSQL through the
 * live write paths (insertDesignImage). Also locks the id-reuse contract
 * (§2/§5): a pinned placement id resolves whether it was minted as an
 * artifact or as a placement render.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser } from "./factories";

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
