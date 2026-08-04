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
});
