/**
 * getListingBackMockup authorization matrix (#167 decision 1) — against a
 * real in-memory libSQL (the #28 pattern). Two gates stack: the page image
 * must be viewable (canViewImagePage, exactly as the front mockup and the
 * page itself) AND the back pick must be a usable placement source
 * (canUseAsPlacementSource, the checkout bar). renderAndCacheMockup itself
 * is covered in mockup-render.test.ts; it's mocked here so the matrix stays
 * about auth, not rendering.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
// which constructs a real Stripe client at module load; mocked the same way
// the sibling get-listing-mockup test does.
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: { sessions: { create: vi.fn() } },
  },
}));

const mockupRender = vi.hoisted(() => ({
  renderAndCacheMockup: vi.fn(async () => ({
    mockupUrl: "https://r2.example/back-mockup.jpg",
  })),
}));
vi.mock("@/lib/mockup-render", () => mockupRender);

import { getListingBackMockup } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

/**
 * Three owners: the seller whose listing is the page image (with a private
 * sibling and a hidden listing in the same thread), the buyer with a private
 * design of their own, and a third maker with a published image — the
 * cross-owner Shop back.
 */
async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  await makeUser(db, "other");

  const sold = await makeDesign(db, "seller");
  const publishedId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/listing.png",
    publishedAt: new Date(),
  });
  const sellerPrivateId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/seller-private.png",
  });
  const hiddenId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/hidden.png",
    publishedAt: new Date(),
    isHidden: true,
  });

  const mine = await makeDesign(db, "buyer");
  const myBackId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/my-back.png",
  });

  const theirs = await makeDesign(db, "other");
  const publishedBackId = await makeSourceImage(db, {
    designId: theirs.id,
    ownerId: "other",
    imageUrl: "https://img.example/shop-back.png",
    publishedAt: new Date(),
  });

  return {
    soldDesignId: sold.id,
    publishedId,
    sellerPrivateId,
    hiddenId,
    myBackId,
    publishedBackId,
  };
}

const PRODUCT = { productId: "bella-canvas-3001", colorName: "Black" };

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = null;
  mockupRender.renderAndCacheMockup.mockClear();
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getListingBackMockup authorization (#167)", () => {
  it("allows a signed-out visitor: published page image + published back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    const result = await getListingBackMockup({
      imageId: ids.publishedId,
      backImageId: ids.publishedBackId,
      ...PRODUCT,
    });

    expect(result.mockupUrl).toBe("https://r2.example/back-mockup.jpg");
    // Back placement, anchored on the PICK (not the page image), cached on
    // the page image's design like every other mockup for that listing.
    expect(mockupRender.renderAndCacheMockup).toHaveBeenCalledWith({
      designId: ids.soldDesignId,
      productId: "bella-canvas-3001",
      colorName: "Black",
      scale: 1.0,
      placementId: "back",
      sourceImageId: ids.publishedBackId,
      userId: null,
    });
  });

  it("rejects a signed-out visitor picking a private back, before any render", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      getListingBackMockup({
        imageId: ids.publishedId,
        backImageId: ids.myBackId,
        ...PRODUCT,
      })
    ).rejects.toThrow("Back image is not available");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
  });

  it("allows a signed-in buyer to preview their own private image on the back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "buyer", isAnonymous: false } };

    const result = await getListingBackMockup({
      imageId: ids.publishedId,
      backImageId: ids.myBackId,
      ...PRODUCT,
    });

    expect(result.mockupUrl).toBe("https://r2.example/back-mockup.jpg");
    expect(mockupRender.renderAndCacheMockup).toHaveBeenCalledWith(
      expect.objectContaining({
        placementId: "back",
        sourceImageId: ids.myBackId,
        userId: "buyer",
      })
    );
  });

  it("rejects a signed-in non-owner forging a private id from the seller's thread", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "buyer", isAnonymous: false } };

    // The order's design is the seller's; thread membership alone must not
    // let the buyer see the seller's unpublished work on a mockup.
    await expect(
      getListingBackMockup({
        imageId: ids.publishedId,
        backImageId: ids.sellerPrivateId,
        ...PRODUCT,
      })
    ).rejects.toThrow("Back image is not available");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
  });

  it("rejects everyone — including the owner — when the page image is admin-hidden", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "seller", isAnonymous: false } };

    await expect(
      getListingBackMockup({
        imageId: ids.hiddenId,
        backImageId: ids.publishedBackId,
        ...PRODUCT,
      })
    ).rejects.toThrow("Unauthorized");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
  });

  it("rejects a non-owner when the page image is unpublished, even with a valid back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "buyer", isAnonymous: false } };

    await expect(
      getListingBackMockup({
        imageId: ids.sellerPrivateId,
        backImageId: ids.myBackId,
        ...PRODUCT,
      })
    ).rejects.toThrow("Unauthorized");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
  });

  it("throws on an unknown back id", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "buyer", isAnonymous: false } };

    await expect(
      getListingBackMockup({
        imageId: ids.publishedId,
        backImageId: "does-not-exist",
        ...PRODUCT,
      })
    ).rejects.toThrow("Back image is not available");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
  });

  it("throws on an unknown page image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      getListingBackMockup({
        imageId: "does-not-exist",
        backImageId: ids.publishedBackId,
        ...PRODUCT,
      })
    ).rejects.toThrow("Image not found");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
  });

  it("refuses outright when the flag is off, before any render", async () => {
    vi.stubEnv("MULTI_PLACEMENT_ENABLED", "false");
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "buyer", isAnonymous: false } };

    await expect(
      getListingBackMockup({
        imageId: ids.publishedId,
        backImageId: ids.myBackId,
        ...PRODUCT,
      })
    ).rejects.toThrow("Back designs are not enabled");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
  });
});
