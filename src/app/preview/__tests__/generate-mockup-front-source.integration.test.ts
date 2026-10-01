/**
 * generateMockup with an explicit front source (#269). /preview names the
 * front image it is showing on every request, so the server never resolves
 * "current primary" on the page's behalf mid-visit. Against a real in-memory
 * libSQL; Printful and R2 are mocked.
 *
 * Cache rule: an explicit source equal to the design's current primary is the
 * default front (same key, same R2 key parts as no source), so warm entries
 * and prefetched mockups stay valid. A source that differs takes the pinned,
 * source-keyed path and renders that image.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { mockupCacheKey } from "@/lib/mockup-cache";

const h = vi.hoisted(() => ({ db: null as unknown, session: null as unknown }));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: () => false,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn }));

const printful = vi.hoisted(() => ({
  createMockupTask: vi.fn(async () => "task-key"),
  pollMockupTask: vi.fn(async () => [
    { mockupUrl: "https://printful.example/temp.jpg", variantIds: [1] },
  ]),
}));
vi.mock("@/lib/printful", () => printful);

const r2 = vi.hoisted(() => ({
  uploadMockupImage: vi.fn(
    async () => "https://r2.example/mockup.jpg"
  ),
  uploadImageObject: vi.fn(async () => "https://r2.example/x.png"),
}));
vi.mock("@/lib/r2", () => r2);

import { generateMockup } from "@/app/preview/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;
const PRODUCT = "bella-canvas-3001";

let db: Db;
let designId: string;
let p1: string;
let p2: string;

async function mockupUrls() {
  const row = await db.query.design.findFirst({
    where: eq(schema.design.id, designId),
  });
  return row?.mockupUrls ?? {};
}

beforeEach(async () => {
  db = (h.db = await createTestDb()) as Db;
  h.session = { user: { id: "nico" } };
  printful.createMockupTask.mockClear();
  r2.uploadMockupImage.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }))
  );
  await makeUser(db, "nico");
  designId = (await makeDesign(db, "nico")).id;
  p1 = await makeSourceImage(db, {
    designId,
    ownerId: "nico",
    imageUrl: "https://img.example/p1.png",
  });
  p2 = await makeSourceImage(db, {
    designId,
    ownerId: "nico",
    imageUrl: "https://img.example/p2.png",
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: p1 })
    .where(eq(schema.design.id, designId));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const defaultKey = () =>
  mockupCacheKey({
    productId: PRODUCT,
    placementId: "front",
    colorName: "Black",
    scaleKey: 100,
  });

describe("generateMockup front source", () => {
  it("a source equal to the current primary is the default front: default key, default R2 parts, shared with no-source calls", async () => {
    await generateMockup(designId, "Black", PRODUCT, 1, "front", p1);
    expect(Object.keys(await mockupUrls())).toEqual([defaultKey()]);
    const parts = (r2.uploadMockupImage.mock.calls[0] as unknown[])[2] as {
      sourceImageId?: string;
    };
    expect(parts.sourceImageId).toBeUndefined();

    // A call with no source reuses it; Printful ran once.
    await generateMockup(designId, "Black", PRODUCT, 1, "front");
    expect(printful.createMockupTask).toHaveBeenCalledTimes(1);
  });

  it("a source that differs from the primary renders that image under the pinned key", async () => {
    await generateMockup(designId, "Black", PRODUCT, 1, "front", p2);
    expect((printful.createMockupTask.mock.calls[0] as unknown[])[2]).toBe(
      "https://img.example/p2.png"
    );
    expect(Object.keys(await mockupUrls())).toEqual([
      mockupCacheKey({
        productId: PRODUCT,
        placementId: "front",
        sourceImageId: p2,
        colorName: "Black",
        scaleKey: 100,
      }),
    ]);
  });

  it("after the primary moves, a request naming the old primary renders the old image, not the new primary", async () => {
    await db
      .update(schema.design)
      .set({ primaryImageId: p2, mockupUrls: null })
      .where(eq(schema.design.id, designId));

    await generateMockup(designId, "Black", PRODUCT, 1, "front", p1);

    expect((printful.createMockupTask.mock.calls[0] as unknown[])[2]).toBe(
      "https://img.example/p1.png"
    );
    // Stored under p1's own key, not the default front, which now belongs to p2.
    expect(Object.keys(await mockupUrls())).toEqual([
      mockupCacheKey({
        productId: PRODUCT,
        placementId: "front",
        sourceImageId: p1,
        colorName: "Black",
        scaleKey: 100,
      }),
    ]);
  });
});
