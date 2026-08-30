/**
 * getOrCreatePlacementRender anchors its cache lookup (#138 defect 2)
 * against a real in-memory libSQL (the #28 pattern). The defect: a front
 * lookup with no source matched ANY front render for the product and
 * returned the newest — wrong the moment a non-primary front render exists,
 * which is exactly what the /preview front picker creates. The fix passes
 * the computed anchor (`sourceImageId ?? primaryImageId`) to
 * findPlacementRender, so the default front resolves the primary-anchored
 * render and a pinned front resolves its own.
 *
 * Ideogram's editTransparent is mocked and must never be called — both
 * lookups are cache hits; a miss here would be a real re-render, not a
 * wrong image.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

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

const ideogram = vi.hoisted(() => ({
  editTransparent: vi.fn(async () => {
    throw new Error("must not generate — both lookups are cache hits");
  }),
  EDIT_COST_PER_IMAGE: 0.2,
}));
vi.mock("@/lib/ideogram", () => ideogram);

vi.mock("@/lib/printful", () => ({
  createMockupTask: vi.fn(),
  pollMockupTask: vi.fn(),
}));

vi.mock("@/lib/r2", () => ({
  uploadMockupImage: vi.fn(),
  uploadImageObject: vi.fn(),
}));

import { getOrCreatePlacementRender } from "@/app/preview/actions";
import { insertDesignImage } from "@/lib/design-images";

type Db = Awaited<ReturnType<typeof createTestDb>>;

// bella-canvas-3001 front prints 3:4; a 1:2 source needs regeneration
// (ratio 1.5 hits the threshold), so the flow reaches the cache lookup.
const PRODUCT = "bella-canvas-3001";

describe("getOrCreatePlacementRender — front lookups anchored (#138 defect 2)", () => {
  let designId: string;
  let primaryId: string;
  let siblingId: string;

  beforeEach(async () => {
    const db = (h.db = await createTestDb()) as Db;
    ideogram.editTransparent.mockClear();
    h.session = { user: { id: "nico" } };

    await makeUser(db, "nico");
    const design = await makeDesign(db, "nico");
    designId = design.id;
    primaryId = await makeSourceImage(db, {
      designId,
      ownerId: "nico",
      imageUrl: "https://img.example/primary.png",
      aspectRatio: "1:2",
    });
    siblingId = await makeSourceImage(db, {
      designId,
      ownerId: "nico",
      imageUrl: "https://img.example/sibling.png",
      aspectRatio: "1:2",
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: primaryId })
      .where(eq(schema.design.id, designId));

    // Two front renders for the same product: the primary's, then a NEWER
    // one anchored on the sibling (a pinned non-primary front). The
    // unfiltered lookup used to return whichever was newest.
    await insertDesignImage({
      designId,
      imageUrl: "https://img.example/primary-front-render.png",
      aspectRatio: "3:4",
      generationCost: 0,
      productId: PRODUCT,
      placementId: "front",
      parentImageId: primaryId,
    });
    await insertDesignImage({
      designId,
      imageUrl: "https://img.example/sibling-front-render.png",
      aspectRatio: "3:4",
      generationCost: 0,
      productId: PRODUCT,
      placementId: "front",
      parentImageId: siblingId,
    });
  });

  it("default front (no source) returns the primary-anchored render, not the newest", async () => {
    const result = await getOrCreatePlacementRender(designId, PRODUCT);
    expect(result.imageUrl).toBe("https://img.example/primary-front-render.png");
    expect(ideogram.editTransparent).not.toHaveBeenCalled();
  });

  it("a pinned front returns the render anchored on the pin", async () => {
    const result = await getOrCreatePlacementRender(
      designId,
      PRODUCT,
      "front",
      siblingId
    );
    expect(result.imageUrl).toBe("https://img.example/sibling-front-render.png");
    expect(ideogram.editTransparent).not.toHaveBeenCalled();
  });
});
