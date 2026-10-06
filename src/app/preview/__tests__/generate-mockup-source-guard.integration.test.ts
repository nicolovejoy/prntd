import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage, setPublication } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({ db: null as unknown, session: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) => Boolean(u?.isAnonymous),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: () => {} }));
const printful = vi.hoisted(() => ({
  createMockupTask: vi.fn(async () => "task-key"),
  pollMockupTask: vi.fn(async () => [
    { mockupUrl: "https://printful.example/temp.jpg", variantIds: [1] },
  ]),
}));
vi.mock("@/lib/printful", () => printful);
vi.mock("@/lib/r2", () => ({
  uploadMockupImage: vi.fn(async () => "https://r2.example/mockup.jpg"),
  uploadImageObject: vi.fn(),
}));
vi.mock("@/lib/ideogram", () => ({ editTransparent: vi.fn(), EDIT_COST_PER_IMAGE: 0.2 }));

import { mockupCacheKey } from "@/lib/mockup-cache";
import { generateMockup, getOrCreatePlacementRender } from "@/app/preview/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  h.db = await createTestDb();
  printful.createMockupTask.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }))
  );
});
afterEach(() => vi.unstubAllGlobals());

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "stranger");
  const sold = await makeDesign(db, "seller");
  const sellerImg = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/seller-art.png",
    publishedAt: new Date(),
  });
  const theirs = await makeDesign(db, "stranger");
  await makeSourceImage(db, {
    designId: theirs.id,
    ownerId: "stranger",
    imageUrl: "https://img.example/stranger.png",
  });
  // The back render /preview cached while the seller's image was published.
  await db.insert(schema.placementRender).values({
    designId: theirs.id,
    sourceImageId: sellerImg,
    blankId: "bella-canvas-3001",
    placementId: "back",
    imageUrl: "https://img.example/render-of-seller-art.png",
    aspectRatio: "1:1",
  });
  return { sellerImg, theirDesign: theirs.id };
}

describe("generateMockup refuses a source that is no longer usable, even with a cached answer", () => {
  it("refuses an unpublished source whose back render is cached on the caller's design", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "stranger", isAnonymous: false } };
    await db.delete(schema.imagePublication).where(eq(schema.imagePublication.imageId, ids.sellerImg));

    // The pin/render guard refuses the source...
    await expect(
      getOrCreatePlacementRender(ids.theirDesign, "bella-canvas-3001", "back", ids.sellerImg)
    ).rejects.toThrow();
    // ...and so does the mockup action, instead of rendering the cached render.
    await expect(
      generateMockup(ids.theirDesign, "Navy", "bella-canvas-3001", 1, "back", ids.sellerImg)
    ).rejects.toThrow(/not available/);
    expect(printful.createMockupTask).not.toHaveBeenCalled();
  });

  it("refuses an admin-hidden source whose back render is cached on the caller's design", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "stranger", isAnonymous: false } };
    await setPublication(db, ids.sellerImg, { isHidden: true });
    await expect(
      generateMockup(ids.theirDesign, "Navy", "bella-canvas-3001", 1, "back", ids.sellerImg)
    ).rejects.toThrow(/not available/);
    expect(printful.createMockupTask).not.toHaveBeenCalled();
  });

  it("refuses a cached mockup URL keyed on an unpublished source", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "stranger", isAnonymous: false } };
    await db.delete(schema.imagePublication).where(eq(schema.imagePublication.imageId, ids.sellerImg));
    await db
      .update(schema.design)
      .set({
        mockupUrls: {
          [mockupCacheKey({
            productId: "bella-canvas-3001",
            placementId: "back",
            sourceImageId: ids.sellerImg,
            colorName: "Navy",
            scaleKey: 100,
          })]: "https://r2.example/cached-back.jpg",
        },
      })
      .where(eq(schema.design.id, ids.theirDesign));
    await expect(
      generateMockup(ids.theirDesign, "Navy", "bella-canvas-3001", 1, "back", ids.sellerImg)
    ).rejects.toThrow(/not available/);
  });

  it("still serves the cached render while the source is published", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "stranger", isAnonymous: false } };
    const out = await generateMockup(ids.theirDesign, "Navy", "bella-canvas-3001", 1, "back", ids.sellerImg);
    expect(out.mockupUrl).toBe("https://r2.example/mockup.jpg");
    expect(printful.createMockupTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "https://img.example/render-of-seller-art.png",
      expect.anything(),
      "back"
    );
  });
});
