/**
 * checkoutCart re-checks every line (one buy surface, slice 3, fix C). A cart
 * line is validated when it is added, and nothing re-validated it at checkout:
 * a stranger could cart a published image, the owner (or an admin) could take
 * it out of the Shop, and the stranger's checkout still pinned the now-private
 * image. A cart line does not record which path added it, so the check is the
 * path-independent part that can drift: every pinned image must still pass
 * `assertUsablePlacementImage` for this user, the line's design must exist,
 * and a line with no front pin must belong to the user's own design.
 *
 * Any failing line refuses the whole checkout: no order, no order_item, no
 * Stripe call, the cart left as it is. `getCart` marks each failing line.
 * Prices are not asserted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  return { db: null as unknown, session: null as unknown, stripeCalls: 0 as number };
});

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
        create: vi.fn(async () => {
          h.stripeCalls += 1;
          return { id: "cs_test_cl", url: "https://checkout.stripe.example/cl" };
        }),
      },
    },
  },
}));
vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
  createOrder: vi.fn(),
  getOrderByExternalId: vi.fn(),
}));

import { addToCart, checkoutCart, getCart, removeCartItem } from "@/app/cart/actions";
import { publishImage, unpublishImage } from "@/app/designs/actions";
import { setImageHidden } from "@/app/admin/actions";
import { CART_LINE_UNAVAILABLE } from "@/lib/action-copy";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };
const sess = (id: string, email = `${id}@example.com`) => ({
  user: { id, email, isAnonymous: false },
});
const SELLER = sess("seller");
const BUYER = sess("buyer");
const ADMIN = sess("admin", "admin@example.com");

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  await makeUser(db, "admin");
  const sold = await makeDesign(db, "seller");
  const publishedId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/published.png",
    publishedAt: new Date(),
  });
  const otherPublishedId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/published-2.png",
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
  return { soldDesignId: sold.id, publishedId, otherPublishedId, myDesignId: mine.id, myId };
}

async function expectRefusedWhole(db: Db, result: unknown, cartRows: number) {
  expect(result).toEqual({ url: null, error: CART_LINE_UNAVAILABLE });
  expect(await db.select().from(schema.order)).toHaveLength(0);
  expect(await db.select().from(schema.orderItem)).toHaveLength(0);
  expect(h.stripeCalls).toBe(0);
  expect(await db.select().from(schema.cartItem)).toHaveLength(cartRows);
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = BUYER;
  h.stripeCalls = 0;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());

describe("a stranger's cart line goes stale", () => {
  it("is refused after the owner unpublishes the image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.publishedId, ...OPTS });

    h.session = SELLER;
    await unpublishImage(ids.publishedId);

    h.session = BUYER;
    await expectRefusedWhole(db, await checkoutCart(), 1);
    const view = await getCart();
    expect(view.items).toHaveLength(1);
    expect(view.items[0].unavailable).toBe(true);
  });

  it("is refused after an admin hides the image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.publishedId, ...OPTS });

    h.session = ADMIN;
    await setImageHidden(ids.publishedId, true);

    h.session = BUYER;
    await expectRefusedWhole(db, await checkoutCart(), 1);
    expect((await getCart()).items[0].unavailable).toBe(true);
  });

  it("is refused when the stale image is the back, too", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.publishedId, back: ids.otherPublishedId, ...OPTS });

    h.session = ADMIN;
    await setImageHidden(ids.otherPublishedId, true);

    h.session = BUYER;
    await expectRefusedWhole(db, await checkoutCart(), 1);
  });
});

describe("the owner's own line goes stale", () => {
  it("cart own unpublished image, publish, admin hides, checkout: refused", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = SELLER;
    const privateId = await makeSourceImage(db, {
      designId: ids.soldDesignId,
      ownerId: "seller",
      imageUrl: "https://img.example/private.png",
    });
    await addToCart({ frontImageId: privateId, ...OPTS });
    await publishImage(privateId, { title: "T", backgroundColor: "Black" });

    // Published and visible: still fine for its owner.
    expect((await getCart()).items[0].unavailable).toBe(false);

    h.session = ADMIN;
    await setImageHidden(privateId, true);

    h.session = SELLER;
    await expectRefusedWhole(db, await checkoutCart(), 1);
    expect((await getCart()).items[0].unavailable).toBe(true);
  });
});

describe("a mixed cart", () => {
  it("is refused whole, both lines remain, and removing the bad line lets checkout proceed", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.publishedId, ...OPTS });
    await addToCart({ designId: ids.myDesignId, front: ids.myId, ...OPTS });

    h.session = SELLER;
    await unpublishImage(ids.publishedId);

    h.session = BUYER;
    await expectRefusedWhole(db, await checkoutCart(), 2);
    const view = await getCart();
    expect(view.items.map((i) => i.unavailable).sort()).toEqual([false, true]);

    const bad = view.items.find((i) => i.unavailable)!;
    await removeCartItem(bad.id);
    expect(await db.select().from(schema.cartItem)).toHaveLength(1);

    const { url } = await checkoutCart();
    expect(url).toBe("https://checkout.stripe.example/cl");
    const lines = await db.select().from(schema.orderItem);
    expect(lines).toHaveLength(1);
    expect(lines[0].designId).toBe(ids.myDesignId);
    expect(lines[0].placements).toEqual({ front: ids.myId });
    expect(h.stripeCalls).toBe(1);
  });

  it("a line with a stale design-path primary and no pins is judged too", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    // A legacy /preview line: no placements, so it prints the design's primary.
    await db.insert(schema.cartItem).values({
      userId: "buyer",
      designId: ids.myDesignId,
      productId: OPTS.productId,
      size: OPTS.size,
      color: OPTS.color,
      placements: null,
    });
    expect((await getCart()).items[0].unavailable).toBe(false);
    // A line with no pins on someone else's design cannot be re-validated.
    await db.delete(schema.cartItem);
    await db.insert(schema.cartItem).values({
      userId: "buyer",
      designId: ids.soldDesignId,
      productId: OPTS.productId,
      size: OPTS.size,
      color: OPTS.color,
      placements: null,
    });
    expect((await getCart()).items[0].unavailable).toBe(true);
    await expectRefusedWhole(db, await checkoutCart(), 1);
  });
});

describe("an untouched valid cart behaves as before", () => {
  it("checks out to an order with the pinned placements", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.publishedId, ...OPTS });
    await addToCart({ designId: ids.myDesignId, front: ids.myId, back: ids.publishedId, ...OPTS });
    const view = await getCart();
    expect(view.items.every((i) => i.unavailable === false)).toBe(true);

    const { url } = await checkoutCart();
    expect(url).toBe("https://checkout.stripe.example/cl");
    expect(await db.select().from(schema.order)).toHaveLength(1);
    const lines = await db.select().from(schema.orderItem);
    expect(lines.map((l) => l.placements).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(
      [
        { front: ids.myId, back: ids.publishedId },
        { front: ids.publishedId },
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    );
    expect(h.stripeCalls).toBe(1);
  });
});
