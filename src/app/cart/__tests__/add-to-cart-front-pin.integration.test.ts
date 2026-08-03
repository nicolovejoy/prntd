/**
 * addToCart with a pinned front image (#146, the /d path) against a real
 * in-memory libSQL (the #28 pattern). Proves:
 *
 *  - a cross-owner buyer carting a published image gets a line pinned to
 *    THAT image (placements.front = imageId), not the seller's current
 *    primary — and the pin survives checkoutCart into order_item, which is
 *    what the webhook resolves for Printful;
 *  - a private or admin-hidden image id does NOT pass the guard chain
 *    (canUseAsPlacementSource) for a cross-owner buyer;
 *  - the owner's own unpublished image passes (owner grant);
 *  - anonymous guests have carts (auth gates at checkout, not add);
 *  - a back design rides along, guarded the same way.
 *
 * The db singleton, auth session, Stripe and Printful are mocked; the
 * database is real (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeSourceImage } from "@/lib/__tests__/factories";

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
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: "cs_test_cart_pin",
          url: "https://checkout.stripe.example/cs_test_cart_pin",
        })),
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

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");

  // The seller's design: a published listing, a private sibling, and a
  // DIFFERENT image as the design's current primary — so a primary-based
  // front resolution would produce the wrong pin.
  const [sold] = await db
    .insert(schema.design)
    .values({ userId: "seller" })
    .returning();
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
  const hiddenId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/hidden.png",
    publishedAt: new Date(),
    isHidden: true,
  });
  // The seller keeps iterating: primary points at the private sibling.
  await db
    .update(schema.design)
    .set({ primaryImageId: sellerPrivateId })
    .where(eq(schema.design.id, sold.id));

  // The buyer's own design → a legitimate back source and an owner-grant
  // front for the owner-cart case.
  const [mine] = await db
    .insert(schema.design)
    .values({ userId: "buyer" })
    .returning();
  const myImageId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/my-back.png",
  });

  return {
    soldDesignId: sold.id,
    listingId,
    sellerPrivateId,
    hiddenId,
    myDesignId: mine.id,
    myImageId,
  };
}

async function cartRows(db: Db) {
  return db.query.cartItem.findMany();
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

describe("addToCart with frontImageId (#146)", () => {
  it("pins the exact published image, not the design's current primary", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    const res = await addToCart({ frontImageId: ids.listingId, ...OPTS });
    expect(res).toEqual({ ok: true, count: 1 });

    const [row] = await cartRows(db);
    expect(row.designId).toBe(ids.soldDesignId); // derived server-side
    expect(row.placements).toEqual({ front: ids.listingId });
    // NOT the primary — the seller's current display image is private.
    expect(row.placements?.front).not.toBe(ids.sellerPrivateId);
  });

  it("rejects a cross-owner private image id", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      addToCart({ frontImageId: ids.sellerPrivateId, ...OPTS })
    ).rejects.toThrow("Image is not available");
    expect(await cartRows(db)).toHaveLength(0);
  });

  it("rejects a cross-owner admin-hidden image id", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      addToCart({ frontImageId: ids.hiddenId, ...OPTS })
    ).rejects.toThrow("Image is not available");
    expect(await cartRows(db)).toHaveLength(0);
  });

  it("allows the owner to cart their own unpublished image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    const res = await addToCart({ frontImageId: ids.myImageId, ...OPTS });
    expect(res.ok).toBe(true);

    const [row] = await cartRows(db);
    expect(row.designId).toBe(ids.myDesignId);
    expect(row.placements).toEqual({ front: ids.myImageId });
  });

  it("works for an anonymous guest (auth gates at checkout, not add)", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await makeUser(db, "anon-guest");
    h.session = { user: { id: "anon-guest", isAnonymous: true } };

    const res = await addToCart({ frontImageId: ids.listingId, ...OPTS });
    expect(res.ok).toBe(true);
    const [row] = await cartRows(db);
    expect(row.userId).toBe("anon-guest");
    expect(row.placements).toEqual({ front: ids.listingId });

    // The gate is at checkout: an anonymous guest gets needsAuth there.
    const out = await checkoutCart();
    expect(out).toEqual({ url: null, needsAuth: true });
  });

  it("carries a back design, guarded like the front", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({
      frontImageId: ids.listingId,
      back: ids.myImageId,
      ...OPTS,
    });
    const [row] = await cartRows(db);
    expect(row.placements).toEqual({
      front: ids.listingId,
      back: ids.myImageId,
    });

    // A forged back id from the seller's private thread is rejected — the
    // designId derived from the front (the SELLER's design) grants nothing.
    await expect(
      addToCart({
        frontImageId: ids.listingId,
        back: ids.sellerPrivateId,
        ...OPTS,
      })
    ).rejects.toThrow("Back image is not available");
  });

  it("shows the pinned image in the cart view, not the seller's display image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const view = await getCart();
    expect(view.items).toHaveLength(1);
    expect(view.items[0].imageUrl).toBe("https://img.example/listing.png");
  });

  it("survives checkoutCart into order_item placements (what Printful prints)", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const { url } = await checkoutCart();
    expect(url).toBe("https://checkout.stripe.example/cs_test_cart_pin");

    const lines = await db.query.orderItem.findMany();
    expect(lines).toHaveLength(1);
    expect(lines[0].designId).toBe(ids.soldDesignId);
    expect(lines[0].placements).toEqual({ front: ids.listingId });
  });

  it("still requires designId or frontImageId", async () => {
    const db = h.db as Db;
    await seed(db);
    await expect(addToCart({ ...OPTS })).rejects.toThrow(
      "designId or frontImageId required"
    );
  });
});
