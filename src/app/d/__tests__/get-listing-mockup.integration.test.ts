/**
 * getListingMockup authorization matrix (#135 slice 1) — against a real
 * in-memory libSQL (the #28 pattern). This action is deliberately NOT
 * ownership-gated like /preview's generateMockup: anyone who can see the
 * image detail page (canViewImagePage — published && !hidden, or the owner)
 * must be able to render its mockup. renderAndCacheMockup itself (Printful/
 * R2/cache) is covered separately in mockup-render.test.ts; this file mocks
 * it out so the matrix stays about auth, not rendering.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
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

// d/actions.ts imports createStripeCheckoutForOrder from order/actions.ts,
// which imports @/lib/stripe — that constructs a real Stripe client from
// STRIPE_SECRET_KEY at module load, which isn't set under vitest. Mocked the
// same way buy-published-design.integration.test.ts does.
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: { sessions: { create: vi.fn() } },
  },
}));

const mockupRender = vi.hoisted(() => ({
  renderAndCacheMockup: vi.fn(async () => ({
    mockupUrl: "https://r2.example/mockup.jpg",
  })),
}));
vi.mock("@/lib/mockup-render", () => mockupRender);

import { getListingMockup } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  const design = await makeDesign(db, "seller");
  const publishedId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: "seller",
    imageUrl: "https://img.example/listing.png",
    publishedAt: new Date(),
  });
  const privateId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: "seller",
    imageUrl: "https://img.example/private.png",
  });
  const hiddenId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: "seller",
    imageUrl: "https://img.example/hidden.png",
    publishedAt: new Date(),
    isHidden: true,
  });
  return { designId: design.id, publishedId, privateId, hiddenId };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = null;
  mockupRender.renderAndCacheMockup.mockClear();
});

describe("getListingMockup authorization (#135 slice 1)", () => {
  it("allows a signed-out visitor to render a published image's mockup", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    const result = await getListingMockup({
      imageId: ids.publishedId,
      productId: "bella-canvas-3001",
      colorName: "Black",
    });

    expect(result.mockupUrl).toBe("https://r2.example/mockup.jpg");
    // Front placement, explicit sourceImageId = the LISTED image (not
    // whatever the design currently displays) — the whole point of #135.
    expect(mockupRender.renderAndCacheMockup).toHaveBeenCalledWith({
      designId: ids.designId,
      productId: "bella-canvas-3001",
      colorName: "Black",
      scale: 1.0,
      placementId: "front",
      sourceImageId: ids.publishedId,
      userId: null,
    });
  });

  it("allows a signed-in non-owner (the normal Shop buyer) to render a published image's mockup", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "buyer", isAnonymous: false } };

    const result = await getListingMockup({
      imageId: ids.publishedId,
      productId: "bella-canvas-3001",
      colorName: "Black",
    });

    expect(result.mockupUrl).toBe("https://r2.example/mockup.jpg");
    expect(mockupRender.renderAndCacheMockup).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "buyer" })
    );
  });

  it("allows the owner to render their own unpublished image's mockup", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "seller", isAnonymous: false } };

    const result = await getListingMockup({
      imageId: ids.privateId,
      productId: "bella-canvas-3001",
      colorName: "Black",
    });

    expect(result.mockupUrl).toBe("https://r2.example/mockup.jpg");
  });

  it("rejects a non-owner viewing an unpublished image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "buyer", isAnonymous: false } };

    await expect(
      getListingMockup({
        imageId: ids.privateId,
        productId: "bella-canvas-3001",
        colorName: "Black",
      })
    ).rejects.toThrow("Unauthorized");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
  });

  it("rejects a signed-out visitor viewing an unpublished image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      getListingMockup({
        imageId: ids.privateId,
        productId: "bella-canvas-3001",
        colorName: "Black",
      })
    ).rejects.toThrow("Unauthorized");
  });

  it("rejects everyone — including the owner — for an admin-hidden image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "seller", isAnonymous: false } };

    await expect(
      getListingMockup({
        imageId: ids.hiddenId,
        productId: "bella-canvas-3001",
        colorName: "Black",
      })
    ).rejects.toThrow("Unauthorized");
  });

  it("throws when the image doesn't exist", async () => {
    const db = h.db as Db;
    await seed(db);

    await expect(
      getListingMockup({
        imageId: "does-not-exist",
        productId: "bella-canvas-3001",
        colorName: "Black",
      })
    ).rejects.toThrow("Image not found");
  });
});
