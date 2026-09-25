/**
 * addToCart's image-detail-page swap (#138 slice 3) against a real in-memory
 * libSQL (the #28 pattern). On the `frontImageId` entry, `front` is the swap:
 * the picked image takes the front and the page image moves to the back.
 * Proves:
 *
 *  - the cart line is pinned `{ front: <picked>, back: <page image> }`, keeps
 *    the page image's design, is priced like any two-sided line, shows the
 *    picked image as its thumbnail, and the pins survive checkoutCart into
 *    `order_item.placements` (what the webhook prints);
 *  - the override clears the SAME guard as the back: a cross-owner private or
 *    admin-hidden id throws and nothing is carted;
 *  - swap only: a different front without the page image on the back throws
 *    (another image on the back, no back, or a back dropped because
 *    MULTI_PLACEMENT_ENABLED is off);
 *  - the /preview designId entry is untouched by the rule.
 *
 * The db singleton, auth session, Stripe and Printful are mocked; the
 * database is real (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { BACK_PLACEMENT_UPCHARGE, computePrice } from "@/lib/pricing";

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
            id: "cs_test_cart_swap",
            url: "https://checkout.stripe.example/cs_test_cart_swap",
          };
        }),
      },
    },
  },
}));

// Shipping quote falls back to the flat estimate.
vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
}));

import { addToCart, getCart, checkoutCart } from "@/app/cart/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

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
    myDesignId: mine.id,
    myImageId,
    otherShopId,
  };
}

async function cartRows(db: Db) {
  return db.query.cartItem.findMany();
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

describe("addToCart swap on the frontImageId entry (#138 slice 3)", () => {
  it("pins the picked image on the front and the page image on the back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({
      frontImageId: ids.listingId,
      front: ids.myImageId,
      back: ids.listingId,
      ...OPTS,
    });

    const [row] = await cartRows(db);
    // The line still belongs to the page image's design.
    expect(row.designId).toBe(ids.soldDesignId);
    expect(row.placements).toEqual({
      front: ids.myImageId,
      back: ids.listingId,
    });
  });

  it("prices the swapped line like any two-sided line and shows the new front as its thumbnail", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({
      frontImageId: ids.listingId,
      front: ids.otherShopId,
      back: ids.listingId,
      ...OPTS,
    });
    const view = await getCart();
    expect(view.items).toHaveLength(1);
    const front = computePrice(0, OPTS.productId, OPTS.size).total;
    expect(view.items[0].unitPrice).toBeCloseTo(front + BACK_PLACEMENT_UPCHARGE, 2);
    expect(view.items[0].hasBack).toBe(true);
    expect(view.items[0].imageUrl).toBe("https://img.example/other-shop.png");
  });

  it("survives checkoutCart into order_item placements, and the Stripe line shows the new front", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({
      frontImageId: ids.listingId,
      front: ids.myImageId,
      back: ids.listingId,
      ...OPTS,
    });
    const { url } = await checkoutCart();
    expect(url).toBe("https://checkout.stripe.example/cs_test_cart_swap");

    const lines = await db.query.orderItem.findMany();
    expect(lines).toHaveLength(1);
    expect(lines[0].designId).toBe(ids.soldDesignId);
    expect(lines[0].placements).toEqual({
      front: ids.myImageId,
      back: ids.listingId,
    });
    const images =
      h.sessionParams[0]?.line_items?.[0]?.price_data?.product_data?.images ??
      [];
    expect(images).toEqual(["https://img.example/mine.png"]);
  });

  it("rejects a cross-owner private image as the front and carts nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      addToCart({
        frontImageId: ids.listingId,
        front: ids.sellerPrivateId,
        back: ids.listingId,
        ...OPTS,
      })
    ).rejects.toThrow("Front image is not available");
    expect(await cartRows(db)).toHaveLength(0);
  });

  it("rejects a cross-owner admin-hidden image as the front and carts nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      addToCart({
        frontImageId: ids.listingId,
        front: ids.sellerHiddenId,
        back: ids.listingId,
        ...OPTS,
      })
    ).rejects.toThrow("Front image is not available");
    expect(await cartRows(db)).toHaveLength(0);
  });

  it("swap only: refuses a different front when the page image is not the back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      addToCart({
        frontImageId: ids.listingId,
        front: ids.myImageId,
        back: ids.otherShopId,
        ...OPTS,
      })
    ).rejects.toThrow("A different front needs this design on the back");
    await expect(
      addToCart({
        frontImageId: ids.listingId,
        front: ids.myImageId,
        ...OPTS,
      })
    ).rejects.toThrow("A different front needs this design on the back");
    expect(await cartRows(db)).toHaveLength(0);
  });

  it("refuses the override when the flag is off (the back is dropped, so it is not a swap)", async () => {
    vi.stubEnv("MULTI_PLACEMENT_ENABLED", "false");
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      addToCart({
        frontImageId: ids.listingId,
        front: ids.myImageId,
        back: ids.listingId,
        ...OPTS,
      })
    ).rejects.toThrow("A different front needs this design on the back");
    expect(await cartRows(db)).toHaveLength(0);
  });

  it("a front equal to the page image is not an override", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({
      frontImageId: ids.listingId,
      front: ids.listingId,
      ...OPTS,
    });
    const [row] = await cartRows(db);
    expect(row.placements).toEqual({ front: ids.listingId });
  });

  it("the /preview designId entry keeps its own front rule (no swap requirement)", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    // A published Shop image as the front with no back: allowed on /preview.
    await addToCart({ designId: ids.myDesignId, front: ids.otherShopId, ...OPTS });
    const [row] = await cartRows(db);
    expect(row.designId).toBe(ids.myDesignId);
    expect(row.placements).toEqual({ front: ids.otherShopId });
  });
});
