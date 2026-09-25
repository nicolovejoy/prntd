/**
 * buyPublishedDesign's front/back swap (#138 slice 3, the image detail page)
 * against a real in-memory libSQL (the #28 pattern). Proves:
 *
 *  - a swap pins `{ front: <picked>, back: <page image> }` into
 *    `order_item.placements`, at the same price as the unswapped two-sided
 *    order, with the Stripe line thumbnail following the new front and the
 *    order's designId / storeProductId still naming the page image;
 *  - the override clears the SAME guard as the back: a cross-owner private or
 *    admin-hidden id throws, and no order row is written;
 *  - swap only: a different front without the page image on the back throws
 *    (another image on the back, no back, or a back dropped because
 *    MULTI_PLACEMENT_ENABLED is off);
 *  - a `frontImageId` equal to the page image is not an override.
 *
 * The db singleton, auth session and Stripe are mocked; the database is real
 * (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  sessionParams: [] as Stripe.Checkout.SessionCreateParams[],
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
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
          h.sessionParams.push(params);
          return {
            id: `cs_test_swap_${h.sessionParams.length}`,
            url: "https://checkout.stripe.example/cs_test_swap",
          };
        }),
      },
    },
  },
}));

import { buyPublishedDesign } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

/**
 * Three owners: the seller whose published listing is the page image (with a
 * private sibling and a hidden listing in the same thread), the buyer with a
 * private image of their own, and a third maker with a published Shop image.
 */
async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  await makeUser(db, "other");

  const sold = await makeDesign(db, "seller");
  const listingId = await makeSourceImage(db, {
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
  const sellerHiddenId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/seller-hidden.png",
    publishedAt: new Date(),
    isHidden: true,
  });

  const mine = await makeDesign(db, "buyer");
  const myImageId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine.png",
  });

  const theirs = await makeDesign(db, "other");
  const otherShopId = await makeSourceImage(db, {
    designId: theirs.id,
    ownerId: "other",
    imageUrl: "https://img.example/other-shop.png",
    publishedAt: new Date(),
  });

  return {
    soldDesignId: sold.id,
    listingId,
    sellerPrivateId,
    sellerHiddenId,
    myImageId,
    otherShopId,
  };
}

function lastLineImages(): string[] {
  const params = h.sessionParams[h.sessionParams.length - 1];
  return params?.line_items?.[0]?.price_data?.product_data?.images ?? [];
}

async function expectNothingBooked(db: Db) {
  expect(await db.select().from(schema.order)).toHaveLength(0);
  expect(await db.select().from(schema.orderItem)).toHaveLength(0);
  expect(h.sessionParams).toHaveLength(0);
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  h.sessionParams = [];
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buyPublishedDesign swap (#138 slice 3)", () => {
  it("pins the picked image on the front and the page image on the back, at the unswapped price", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    // Unswapped two-sided order first, for the price and attribution baseline.
    await buyPublishedDesign({
      imageId: ids.listingId,
      backImageId: ids.myImageId,
      ...OPTS,
    });
    // Then the swap of the same two images.
    const { url } = await buyPublishedDesign({
      imageId: ids.listingId,
      frontImageId: ids.myImageId,
      backImageId: ids.listingId,
      ...OPTS,
    });
    expect(url).toBe("https://checkout.stripe.example/cs_test_swap");

    const orders = await db.select().from(schema.order);
    const lines = await db.select().from(schema.orderItem);
    expect(orders).toHaveLength(2);
    expect(lines).toHaveLength(2);
    const byFront = (front: string) => {
      const line = lines.find((l) => l.placements?.front === front)!;
      return { line, order: orders.find((o) => o.id === line.orderId)! };
    };
    const base = byFront(ids.listingId);
    const swap = byFront(ids.myImageId);

    expect(base.line.placements).toEqual({
      front: ids.listingId,
      back: ids.myImageId,
    });
    expect(swap.line.placements).toEqual({
      front: ids.myImageId,
      back: ids.listingId,
    });

    // Price: a swap is not a new placement. $19.43 + $8 back either way.
    expect(swap.order.itemPrice).toBe(27.43);
    expect(swap.line.itemPrice).toBe(27.43);
    expect(swap.order.totalPrice).toBe(base.order.totalPrice);

    // The order still names the page image's design and composition.
    expect(swap.order.designId).toBe(ids.soldDesignId);
    expect(swap.line.designId).toBe(ids.soldDesignId);
    expect(swap.order.storeProductId).toBe(base.order.storeProductId);
    expect(swap.order.storeProductId).not.toBeNull();
  });

  it("the Stripe line thumbnail follows the swapped front; the cancel URL returns to the page", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({
      imageId: ids.listingId,
      frontImageId: ids.otherShopId,
      backImageId: ids.listingId,
      ...OPTS,
    });

    expect(lastLineImages()).toEqual(["https://img.example/other-shop.png"]);
    expect(h.sessionParams[0].cancel_url).toBe(
      `http://localhost:3000/d/${ids.listingId}`
    );
  });

  it("unswapped: the thumbnail is still the page image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({
      imageId: ids.listingId,
      backImageId: ids.myImageId,
      ...OPTS,
    });
    expect(lastLineImages()).toEqual(["https://img.example/listing.png"]);
  });

  it("allows a published Shop image from a third maker as the swapped front", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({
      imageId: ids.listingId,
      frontImageId: ids.otherShopId,
      backImageId: ids.listingId,
      ...OPTS,
    });
    const [line] = await db.select().from(schema.orderItem);
    expect(line.placements).toEqual({
      front: ids.otherShopId,
      back: ids.listingId,
    });
  });

  it("rejects a cross-owner private image as the front and books nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    // The seller's private sibling: same thread as the page image, which
    // grants a cross-owner buyer nothing (canUseAsPlacementSource, #95).
    await expect(
      buyPublishedDesign({
        imageId: ids.listingId,
        frontImageId: ids.sellerPrivateId,
        backImageId: ids.listingId,
        ...OPTS,
      })
    ).rejects.toThrow("Front image is not available");
    await expectNothingBooked(db);
  });

  it("rejects a cross-owner admin-hidden image as the front and books nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      buyPublishedDesign({
        imageId: ids.listingId,
        frontImageId: ids.sellerHiddenId,
        backImageId: ids.listingId,
        ...OPTS,
      })
    ).rejects.toThrow("Front image is not available");
    await expectNothingBooked(db);
  });

  it("swap only: refuses a different front when the page image is not the back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    // Another image on the back: the page image would not be printed.
    await expect(
      buyPublishedDesign({
        imageId: ids.listingId,
        frontImageId: ids.myImageId,
        backImageId: ids.otherShopId,
        ...OPTS,
      })
    ).rejects.toThrow("A different front needs this design on the back");
    // No back at all.
    await expect(
      buyPublishedDesign({
        imageId: ids.listingId,
        frontImageId: ids.myImageId,
        ...OPTS,
      })
    ).rejects.toThrow("A different front needs this design on the back");
    await expectNothingBooked(db);
  });

  it("refuses the override when the flag is off (the back is dropped, so it is not a swap)", async () => {
    vi.stubEnv("MULTI_PLACEMENT_ENABLED", "false");
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      buyPublishedDesign({
        imageId: ids.listingId,
        frontImageId: ids.myImageId,
        backImageId: ids.listingId,
        ...OPTS,
      })
    ).rejects.toThrow("A different front needs this design on the back");
    await expectNothingBooked(db);
  });

  it("a frontImageId equal to the page image is not an override", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({
      imageId: ids.listingId,
      frontImageId: ids.listingId,
      ...OPTS,
    });
    const [order] = await db.select().from(schema.order);
    const [line] = await db.select().from(schema.orderItem);
    expect(line.placements).toEqual({ front: ids.listingId });
    expect(order.itemPrice).toBe(19.43);
    expect(lastLineImages()).toEqual(["https://img.example/listing.png"]);
  });
});
