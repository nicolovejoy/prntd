/**
 * checkoutCart records the Shop composition on the order header (#289 item 2).
 * `order.store_product_id` is set when every published line of the cart shares
 * one mirror product; a cart of the buyer's own unpublished work, or of
 * several compositions, books null.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({ db: null as unknown, session: null as unknown }));

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
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/ai", () => ({
  generatePublishedNaming: async () => ({ title: "Auto", description: "Auto" }),
}));
vi.mock("@/lib/email", () => ({
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: "cs_test_attr",
          url: "https://checkout.stripe.example/attr",
        })),
      },
    },
  },
}));
vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
  createOrder: vi.fn(),
  getOrderByExternalId: vi.fn(),
}));

import { addToCart, checkoutCart } from "@/app/cart/actions";
import { publishImage } from "@/app/designs/actions";
import { stripe } from "@/lib/stripe";
import { findMirrorProduct, MISSING_COMPOSITION_ERROR } from "@/lib/model-b-writes";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };
const BUYER = { user: { id: "buyer", email: "buyer@example.com", isAnonymous: false } };

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  const sold = await makeDesign(db, "seller");
  const publishedA = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/a.png",
    publishedAt: new Date(),
  });
  const publishedB = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/b.png",
    publishedAt: new Date(),
  });
  // Another seller's published image: a different conversation from A and B.
  await makeUser(db, "seller2");
  const sold2 = await makeDesign(db, "seller2");
  const publishedC = await makeSourceImage(db, {
    designId: sold2.id,
    ownerId: "seller2",
    imageUrl: "https://img.example/c.png",
    publishedAt: new Date(),
  });
  const mine = await makeDesign(db, "buyer");
  const myId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine.png",
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: myId })
    .where(eq(schema.design.id, mine.id));
  return { soldDesignId: sold.id, myDesignId: mine.id, publishedA, publishedB, publishedC, myId };
}

async function onlyOrder(db: Db) {
  const orders = await db.select().from(schema.order);
  expect(orders).toHaveLength(1);
  return orders[0];
}

beforeEach(async () => {
  vi.mocked(stripe.checkout.sessions.create).mockClear();
  h.db = await createTestDb();
  h.session = BUYER;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());

describe("checkoutCart attribution", () => {
  it("one published line: the order records that image's composition", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.publishedA, ...OPTS });

    const { url } = await checkoutCart();
    expect(url).toBe("https://checkout.stripe.example/attr");
    const mirror = await findMirrorProduct(db as never, ids.publishedA);
    expect(mirror).not.toBeNull();
    expect((await onlyOrder(db)).storeProductId).toBe(mirror);
  });

  it("the buyer's own unpublished image: null", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.myId, ...OPTS });

    await checkoutCart();
    expect((await onlyOrder(db)).storeProductId).toBeNull();
  });

  it("two lines, two different published images: null", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.publishedA, ...OPTS });
    await addToCart({ frontImageId: ids.publishedB, ...OPTS });

    await checkoutCart();
    expect((await onlyOrder(db)).storeProductId).toBeNull();
  });

  it("two lines, the same published image in two sizes: that composition", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.publishedA, ...OPTS });
    await addToCart({ frontImageId: ids.publishedA, ...OPTS, size: "L" });

    await checkoutCart();
    const mirror = await findMirrorProduct(db as never, ids.publishedA);
    expect((await onlyOrder(db)).storeProductId).toBe(mirror);
  });

  it("a published line beside the buyer's own unpublished one: the published composition", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.publishedA, ...OPTS });
    await addToCart({ frontImageId: ids.myId, ...OPTS });

    await checkoutCart();
    const mirror = await findMirrorProduct(db as never, ids.publishedA);
    expect((await onlyOrder(db)).storeProductId).toBe(mirror);
  });

  it("a published front with no mirror product fails loudly and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.publishedA, ...OPTS });
    await db.delete(schema.product);

    await expect(checkoutCart()).rejects.toThrow(MISSING_COMPOSITION_ERROR);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(await db.select().from(schema.orderItem)).toHaveLength(0);
  });
  it("a swapped line is attributed to the page image, not the buyer's front pick", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    // Page image A, back = A, front = the buyer's own image.
    await addToCart({
      frontImageId: ids.publishedA,
      front: ids.myId,
      back: ids.publishedA,
      ...OPTS,
    });

    await checkoutCart();
    const mirror = await findMirrorProduct(db as never, ids.publishedA);
    expect(mirror).not.toBeNull();
    expect((await onlyOrder(db)).storeProductId).toBe(mirror);
  });

  // Residue: when the swapped-in front is another output of the SAME
  // conversation, both pins are linked to the line's design and the stored line
  // does not say which was the page image, so cartLineEdit (and this) pick the
  // front.
  it("a swap onto another seller's published image still books the page image's composition", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({
      frontImageId: ids.publishedA,
      front: ids.publishedC,
      back: ids.publishedA,
      ...OPTS,
    });

    await checkoutCart();
    const mirror = await findMirrorProduct(db as never, ids.publishedA);
    expect((await onlyOrder(db)).storeProductId).toBe(mirror);
  });

  it("the owner buying their own published image through the cart books its composition", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await publishImage(ids.myId, { title: "Mine", backgroundColor: "Black" });
    await addToCart({ frontImageId: ids.myId, ...OPTS });

    await checkoutCart();
    const mirror = await findMirrorProduct(db as never, ids.myId);
    expect(mirror).not.toBeNull();
    expect((await onlyOrder(db)).storeProductId).toBe(mirror);
  });

  it("a legacy pinned line whose front has since been published books that composition", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db.insert(schema.cartItem).values({
      userId: "buyer",
      designId: ids.myDesignId,
      productId: OPTS.productId,
      size: OPTS.size,
      color: OPTS.color,
      placements: { front: ids.myId },
    });
    await publishImage(ids.myId, { title: "Mine", backgroundColor: "Black" });

    await checkoutCart();
    const mirror = await findMirrorProduct(db as never, ids.myId);
    expect(mirror).not.toBeNull();
    expect((await onlyOrder(db)).storeProductId).toBe(mirror);
  });

  it("a legacy line with no front pin contributes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db.insert(schema.cartItem).values({
      userId: "buyer",
      designId: ids.myDesignId,
      productId: OPTS.productId,
      size: OPTS.size,
      color: OPTS.color,
      placements: null,
    });
    await addToCart({ frontImageId: ids.publishedA, ...OPTS });

    await checkoutCart();
    const mirror = await findMirrorProduct(db as never, ids.publishedA);
    expect((await onlyOrder(db)).storeProductId).toBe(mirror);
  });
});
