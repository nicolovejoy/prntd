/**
 * renderAndCacheMockup — the render-and-cache body extracted from
 * `generateMockup` (#135 slice 1) so `getListingMockup` (/d) can share it.
 * Against a real in-memory libSQL (the #28 pattern); Printful, R2, and the
 * temp-mockup download are mocked — this is testing the cache/resolve logic,
 * not the vendors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { insertDesignImage } from "@/lib/design-images";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

const printful = vi.hoisted(() => ({
  createMockupTask: vi.fn(async () => "task-key"),
  pollMockupTask: vi.fn(async () => [
    { mockupUrl: "https://printful.example/temp.jpg", variantIds: [1] },
  ]),
}));
vi.mock("@/lib/printful", () => printful);

const r2 = vi.hoisted(() => ({
  uploadMockupImage: vi.fn(async () => "https://r2.example/mockup.jpg"),
}));
vi.mock("@/lib/r2", () => r2);

import { renderAndCacheMockup } from "@/lib/mockup-render";

type Db = Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  h.db = await createTestDb();
  printful.createMockupTask.mockClear();
  printful.pollMockupTask.mockClear();
  r2.uploadMockupImage.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderAndCacheMockup", () => {
  it("renders via Printful, persists design.mockupUrls, and returns the R2 url", async () => {
    const db = h.db as Db;
    await makeUser(db, "seller");
    const design = await makeDesign(db, "seller");
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "seller",
      imageUrl: "https://img.example/art.png",
    });

    const result = await renderAndCacheMockup({
      designId: design.id,
      productId: "bella-canvas-3001",
      colorName: "Black",
      scale: 1.0,
      placementId: "front",
      userId: "seller",
    });

    expect(result.mockupUrl).toBe("https://r2.example/mockup.jpg");
    expect(printful.createMockupTask).toHaveBeenCalledTimes(1);
    expect(printful.createMockupTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "https://img.example/art.png",
      expect.anything(),
      "front"
    );

    const [row] = await db
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, design.id));
    expect(row.mockupUrls?.["v2:bella-canvas-3001:front:Black:100"]).toBe(
      "https://r2.example/mockup.jpg"
    );
  });

  it("returns the cached url without touching Printful when the key already exists", async () => {
    const db = h.db as Db;
    await makeUser(db, "seller");
    const design = await makeDesign(db, "seller");
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "seller",
      imageUrl: "https://img.example/art.png",
    });
    const key = "v2:bella-canvas-3001:front:Black:100";
    await db
      .update(schema.design)
      .set({ mockupUrls: { [key]: "https://r2.example/cached.jpg" } })
      .where(eq(schema.design.id, design.id));

    const result = await renderAndCacheMockup({
      designId: design.id,
      productId: "bella-canvas-3001",
      colorName: "Black",
      scale: 1.0,
      placementId: "front",
      userId: "seller",
    });

    expect(result.mockupUrl).toBe("https://r2.example/cached.jpg");
    expect(printful.createMockupTask).not.toHaveBeenCalled();
  });

  it("renders the explicit source image, not the design's display image, and keys the cache separately (#135 slice 1)", async () => {
    const db = h.db as Db;
    await makeUser(db, "seller");
    const design = await makeDesign(db, "seller");
    // The design's display image (would-be front render source)…
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "seller",
      imageUrl: "https://img.example/display.png",
    });
    // …vs. the specific listed image a /d buyer is looking at, which may be
    // an earlier generation, not the design's current display image.
    const listedImageId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "seller",
      imageUrl: "https://img.example/listed.png",
      publishedAt: new Date(),
    });

    const result = await renderAndCacheMockup({
      designId: design.id,
      productId: "bella-canvas-3001",
      colorName: "Black",
      scale: 1.0,
      placementId: "front",
      sourceImageId: listedImageId,
      userId: null,
    });

    expect(result.mockupUrl).toBe("https://r2.example/mockup.jpg");
    expect(printful.createMockupTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "https://img.example/listed.png",
      expect.anything(),
      "front"
    );

    const [row] = await db
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, design.id));
    const sourcedKey = `v2:bella-canvas-3001:front:${listedImageId}:Black:100`;
    const frontKey = "v2:bella-canvas-3001:front:Black:100";
    expect(row.mockupUrls?.[sourcedKey]).toBe("https://r2.example/mockup.jpg");
    expect(row.mockupUrls?.[frontKey]).toBeUndefined();
  });

  it("front lookup is anchored on the primary — a newer render of a different image does not hijack it (#138 defect 2)", async () => {
    const db = h.db as Db;
    await makeUser(db, "seller");
    const design = await makeDesign(db, "seller");
    const primaryId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "seller",
      imageUrl: "https://img.example/primary.png",
    });
    const siblingId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "seller",
      imageUrl: "https://img.example/sibling.png",
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: primaryId })
      .where(eq(schema.design.id, design.id));

    // A front render anchored on the SIBLING — the newest front render for
    // this product, e.g. from a pinned non-primary front (#138). The
    // unfiltered lookup used to return it for the default front too.
    await insertDesignImage({
      designId: design.id,
      imageUrl: "https://img.example/sibling-front-render.png",
      aspectRatio: "3:4",
      generationCost: 0,
      productId: "bella-canvas-3001",
      placementId: "front",
      parentImageId: siblingId,
    });

    await renderAndCacheMockup({
      designId: design.id,
      productId: "bella-canvas-3001",
      colorName: "Black",
      scale: 1.0,
      placementId: "front",
      userId: "seller",
    });

    // Anchored lookup misses (no primary-anchored render) → falls back to
    // the design's display image, never the sibling's render.
    expect(printful.createMockupTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "https://img.example/primary.png",
      expect.anything(),
      "front"
    );
  });

  it("rejects an explicit source that isn't usable as a placement source (private, non-owner)", async () => {
    const db = h.db as Db;
    await makeUser(db, "seller");
    await makeUser(db, "stranger");
    const design = await makeDesign(db, "seller");
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "seller",
      imageUrl: "https://img.example/display.png",
    });
    const privateSourceId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "seller",
      imageUrl: "https://img.example/private.png",
    });

    // The rejected source never falls back to the display image — an
    // explicit-but-unusable pick throws "No design image" rather than
    // silently rendering something else.
    await expect(
      renderAndCacheMockup({
        designId: design.id,
        productId: "bella-canvas-3001",
        colorName: "Black",
        scale: 1.0,
        placementId: "front",
        sourceImageId: privateSourceId,
        userId: "stranger",
      })
    ).rejects.toThrow("No design image");
    expect(printful.createMockupTask).not.toHaveBeenCalled();
  });

  describe("primary moves during the render", () => {
    async function setup() {
      const db = h.db as Db;
      await makeUser(db, "seller");
      const design = await makeDesign(db, "seller");
      const p1 = await makeSourceImage(db, {
        designId: design.id,
        ownerId: "seller",
        imageUrl: "https://img.example/p1.png",
      });
      const p2 = await makeSourceImage(db, {
        designId: design.id,
        ownerId: "seller",
        imageUrl: "https://img.example/p2.png",
      });
      await db
        .update(schema.design)
        .set({ primaryImageId: p1 })
        .where(eq(schema.design.id, design.id));
      // A generation claims the primary (and clears the cache, as
      // design/actions.ts does) while Printful is still rendering.
      printful.pollMockupTask.mockImplementationOnce(async () => {
        await db
          .update(schema.design)
          .set({ primaryImageId: p2, mockupUrls: null })
          .where(eq(schema.design.id, design.id));
        return [{ mockupUrl: "https://printful.example/temp.jpg", variantIds: [1] }];
      });
      return { db, designId: design.id, p1, p2 };
    }
    const read = async (db: Db, id: string) =>
      (await db.select().from(schema.design).where(eq(schema.design.id, id)))[0]
        .mockupUrls ?? {};

    it("does not write the old primary's render under the default key; stores it under its own source key and still returns it", async () => {
      const { db, designId, p1 } = await setup();
      const result = await renderAndCacheMockup({
        designId,
        productId: "bella-canvas-3001",
        colorName: "Black",
        scale: 1.0,
        placementId: "front",
        userId: null,
      });
      expect(result.mockupUrl).toBe("https://r2.example/mockup.jpg");
      const urls = await read(db, designId);
      expect(urls["v2:bella-canvas-3001:front:Black:100"]).toBeUndefined();
      expect(urls[`v2:bella-canvas-3001:front:${p1}:Black:100`]).toBe(
        "https://r2.example/mockup.jpg"
      );
    });
  });

  describe("foldPrimaryFront (the /preview opt-in)", () => {
    async function twoImages() {
      const db = h.db as Db;
      await makeUser(db, "seller");
      const design = await makeDesign(db, "seller");
      const p1 = await makeSourceImage(db, {
        designId: design.id,
        ownerId: "seller",
        imageUrl: "https://img.example/p1.png",
      });
      const p2 = await makeSourceImage(db, {
        designId: design.id,
        ownerId: "seller",
        imageUrl: "https://img.example/p2.png",
      });
      await db
        .update(schema.design)
        .set({ primaryImageId: p1 })
        .where(eq(schema.design.id, design.id));
      return { db, designId: design.id, p1, p2 };
    }
    const base = {
      productId: "bella-canvas-3001",
      colorName: "Black",
      scale: 1.0,
      placementId: "front",
      userId: "seller",
    };

    it("a source equal to the row's primary uses the default key; a different one the pinned key", async () => {
      const { db, designId, p1, p2 } = await twoImages();
      await renderAndCacheMockup({ ...base, designId, sourceImageId: p1, foldPrimaryFront: true });
      await renderAndCacheMockup({ ...base, designId, sourceImageId: p2, foldPrimaryFront: true });
      const urls = Object.keys(
        (await db.select().from(schema.design).where(eq(schema.design.id, designId)))[0]
          .mockupUrls ?? {}
      ).sort();
      expect(urls).toEqual(
        [
          "v2:bella-canvas-3001:front:Black:100",
          `v2:bella-canvas-3001:front:${p2}:Black:100`,
        ].sort()
      );
    });

    it("without the option, a source equal to the primary keeps its source key (the /d path)", async () => {
      const { db, designId, p1 } = await twoImages();
      await renderAndCacheMockup({ ...base, designId, sourceImageId: p1 });
      const urls = (await db.select().from(schema.design).where(eq(schema.design.id, designId)))[0]
        .mockupUrls ?? {};
      expect(Object.keys(urls)).toEqual([`v2:bella-canvas-3001:front:${p1}:Black:100`]);
    });
  });
});

describe("renderAndCacheMockup: an explicit source that is a render (second fix round)", () => {
  async function seedRenderSource(db: Db, hidden: boolean) {
    await makeUser(db, "owner");
    const design = await makeDesign(db, "owner");
    const imageId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://img.example/x.png",
      ...(hidden ? { publishedAt: new Date(), isHidden: true } : {}),
    });
    const [render] = await db
      .insert(schema.placementRender)
      .values({
        designId: design.id,
        sourceImageId: imageId,
        blankId: "bella-canvas-3001",
        placementId: "back",
        imageUrl: "https://img.example/render-of-x.png",
        aspectRatio: "1:1",
      })
      .returning();
    return { designId: design.id, renderId: render.id };
  }

  it("refuses a render of an admin-hidden image, even for its owner", async () => {
    const db = h.db as Db;
    const ids = await seedRenderSource(db, true);
    await expect(
      renderAndCacheMockup({
        designId: ids.designId,
        productId: "bella-canvas-3001",
        colorName: "Black",
        scale: 1.0,
        placementId: "front",
        sourceImageId: ids.renderId,
        userId: "owner",
      })
    ).rejects.toThrow("No design image");
    expect(printful.createMockupTask).not.toHaveBeenCalled();
  });

  it("still renders a render of the owner's not-hidden image", async () => {
    const db = h.db as Db;
    const ids = await seedRenderSource(db, false);
    const result = await renderAndCacheMockup({
      designId: ids.designId,
      productId: "bella-canvas-3001",
      colorName: "Black",
      scale: 1.0,
      placementId: "front",
      sourceImageId: ids.renderId,
      userId: "owner",
    });
    expect(result.mockupUrl).toBe("https://r2.example/mockup.jpg");
    expect(printful.createMockupTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "https://img.example/render-of-x.png",
      expect.anything(),
      "front"
    );
  });
});
