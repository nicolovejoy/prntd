/**
 * getListingMockup for the owner's UNPUBLISHED image (one buy surface, slice
 * 3) through the real `renderAndCacheMockup`, against a real in-memory libSQL;
 * Printful, R2 and the temp-mockup download are mocked. The invariant #280
 * added for /preview: an image that is not its conversation's primary caches
 * its mockup under that image's own key and never under the conversation's
 * default (source-less) key, which means "the primary's render". The image
 * detail page always passes the page image as the source, so the owner's
 * page for a non-primary image cannot poison the primary's cache entry.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { mockupCacheKey } from "@/lib/mockup-cache";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) =>
    Boolean(u?.isAnonymous),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { create: vi.fn() } } },
}));
vi.mock("@/lib/printful", () => ({
  createMockupTask: vi.fn(async () => "task-key"),
  pollMockupTask: vi.fn(async () => [
    { mockupUrl: "https://printful.example/temp.jpg", variantIds: [1] },
  ]),
}));
vi.mock("@/lib/r2", () => ({
  uploadMockupImage: vi.fn(async () => "https://r2.example/owner-mockup.jpg"),
}));

import { getListingMockup } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const PRODUCT = "bella-canvas-3001";
const COLOR = "Black";

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "owner", isAnonymous: false } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    }))
  );
});

describe("getListingMockup caching for the owner's unpublished image", () => {
  it("a non-primary image caches under its own key, never under the default key", async () => {
    const db = h.db as Db;
    await makeUser(db, "owner");
    const conversation = await makeDesign(db, "owner");
    const primaryId = await makeSourceImage(db, {
      designId: conversation.id,
      ownerId: "owner",
      imageUrl: "https://img.example/primary.png",
    });
    const otherId = await makeSourceImage(db, {
      designId: conversation.id,
      ownerId: "owner",
      imageUrl: "https://img.example/other.png",
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: primaryId })
      .where(eq(schema.design.id, conversation.id));

    const { mockupUrl } = await getListingMockup({
      imageId: otherId,
      productId: PRODUCT,
      colorName: COLOR,
    });
    expect(mockupUrl).toBe("https://r2.example/owner-mockup.jpg");

    const [row] = await db
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, conversation.id));
    const keys = Object.keys(row.mockupUrls ?? {});
    const imageKey = mockupCacheKey({
      productId: PRODUCT,
      placementId: "front",
      sourceImageId: otherId,
      colorName: COLOR,
      scaleKey: 100,
    });
    const defaultKey = mockupCacheKey({
      productId: PRODUCT,
      placementId: "front",
      colorName: COLOR,
      scaleKey: 100,
    });
    expect(keys).toEqual([imageKey]);
    expect(keys).not.toContain(defaultKey);
  });

  it("the primary image is source-keyed too: the default key is left to /preview", async () => {
    const db = h.db as Db;
    await makeUser(db, "owner");
    const conversation = await makeDesign(db, "owner");
    const primaryId = await makeSourceImage(db, {
      designId: conversation.id,
      ownerId: "owner",
      imageUrl: "https://img.example/primary.png",
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: primaryId })
      .where(eq(schema.design.id, conversation.id));

    await getListingMockup({
      imageId: primaryId,
      productId: PRODUCT,
      colorName: COLOR,
    });

    const [row] = await db
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, conversation.id));
    expect(Object.keys(row.mockupUrls ?? {})).toEqual([
      mockupCacheKey({
        productId: PRODUCT,
        placementId: "front",
        sourceImageId: primaryId,
        colorName: COLOR,
        scaleKey: 100,
      }),
    ]);
  });
});
