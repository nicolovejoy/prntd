/**
 * addToCart's image path for an UNPUBLISHED image (one buy surface, slice 3),
 * against a real in-memory libSQL. The owner may cart their own unpublished
 * image from the image detail page's panel; nobody else may, and the image
 * must still have a live conversation of the owner's (`order.design_id` and
 * `cart_item.design_id` are NOT NULL references to `design`). The gate is
 * `resolveBuyableImage`, shared with `buyPublishedDesign`.
 *
 * Every refusal asserts that nothing was written: zero `cart_item` rows, zero
 * `order` rows, zero Stripe calls. Prices are matched by pattern only.
 *
 * The db singleton, auth session, Stripe and Printful are mocked; the
 * database is real (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import {
  makeUser,
  makeDesign,
  makeSourceImage,
  setPublication,
} from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  stripeCalls: 0,
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
        create: vi.fn(async () => {
          h.stripeCalls += 1;
          return {
            id: "cs_test_cart_own",
            url: "https://checkout.stripe.example/cs_test_cart_own",
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

import { addToCart, checkoutCart } from "@/app/cart/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seed(db: Db) {
  await makeUser(db, "owner");
  await makeUser(db, "stranger");
  await makeUser(db, "guest");

  const conversation = await makeDesign(db, "owner");
  const privateId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "owner",
    imageUrl: "https://img.example/private.png",
  });
  const secondPrivateId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "owner",
    imageUrl: "https://img.example/private-2.png",
  });
  const publishedId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "owner",
    imageUrl: "https://img.example/published.png",
    publishedAt: new Date(),
  });

  const strangers = await makeDesign(db, "stranger");
  const strangerPrivateId = await makeSourceImage(db, {
    designId: strangers.id,
    ownerId: "stranger",
    imageUrl: "https://img.example/stranger-private.png",
  });

  return {
    conversationId: conversation.id,
    privateId,
    secondPrivateId,
    publishedId,
    strangersConversationId: strangers.id,
    strangerPrivateId,
  };
}

async function expectNothingWritten(db: Db) {
  expect(await db.select().from(schema.cartItem)).toHaveLength(0);
  expect(await db.select().from(schema.order)).toHaveLength(0);
  expect(await db.select().from(schema.orderItem)).toHaveLength(0);
  expect(h.stripeCalls).toBe(0);
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "owner", isAnonymous: false } };
  h.stripeCalls = 0;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("addToCart: the owner's unpublished image", () => {
  it("writes one line pinned to the image, on the owner's conversation", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    expect(await addToCart({ frontImageId: ids.privateId, ...OPTS })).toEqual({
      ok: true,
      count: 1,
    });

    const rows = await db.select().from(schema.cartItem);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("owner");
    expect(rows[0].designId).toBe(ids.conversationId);
    expect(rows[0].placements).toEqual({ front: ids.privateId });
    expect(rows[0].productId).toBe(OPTS.productId);
    expect(rows[0].size).toBe(OPTS.size);
    expect(rows[0].color).toBe(OPTS.color);
  });

  it("pins a back from the owner's own conversation", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({
      frontImageId: ids.privateId,
      back: ids.secondPrivateId,
      ...OPTS,
    });
    const [row] = await db.select().from(schema.cartItem);
    expect(row.placements).toEqual({
      front: ids.privateId,
      back: ids.secondPrivateId,
    });
  });

  it("pins a swap: the pick on the front, the page image on the back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({
      frontImageId: ids.privateId,
      front: ids.secondPrivateId,
      back: ids.privateId,
      ...OPTS,
    });
    const [row] = await db.select().from(schema.cartItem);
    expect(row.designId).toBe(ids.conversationId);
    expect(row.placements).toEqual({
      front: ids.secondPrivateId,
      back: ids.privateId,
    });
  });

  it("refuses another person's private image as the back, and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      addToCart({
        frontImageId: ids.privateId,
        back: ids.strangerPrivateId,
        ...OPTS,
      })
    ).rejects.toThrow("Back image is not available");
    await expectNothingWritten(db);
  });

  it("checks out from the cart to a line with the same placements and no composition", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({
      frontImageId: ids.privateId,
      back: ids.secondPrivateId,
      ...OPTS,
    });
    const { url } = await checkoutCart();
    expect(url).toBe("https://checkout.stripe.example/cs_test_cart_own");
    expect(h.stripeCalls).toBe(1);

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(1);
    expect(orders[0].userId).toBe("owner");
    expect(orders[0].designId).toBe(ids.conversationId);
    expect(orders[0].storeProductId).toBeNull();
    expect(orders[0].stripeSessionId).toBe("cs_test_cart_own");
    expect(String(orders[0].itemPrice)).toMatch(/\d/);

    const lines = await db.select().from(schema.orderItem);
    expect(lines).toHaveLength(1);
    expect(lines[0].orderId).toBe(orders[0].id);
    expect(lines[0].designId).toBe(ids.conversationId);
    expect(lines[0].placements).toEqual({
      front: ids.privateId,
      back: ids.secondPrivateId,
    });
    // Nothing is booked until the webhook claims the order.
    expect(await db.select().from(schema.ledgerEntry)).toHaveLength(0);
  });
});

describe("addToCart: who may not cart an unpublished image", () => {
  it("refuses a signed-in non-owner and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "stranger", isAnonymous: false } };

    await expect(
      addToCart({ frontImageId: ids.privateId, ...OPTS })
    ).rejects.toThrow("Image is not available");
    await expectNothingWritten(db);
  });

  it("refuses an anonymous non-owner and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "guest", isAnonymous: true } };

    await expect(
      addToCart({ frontImageId: ids.privateId, ...OPTS })
    ).rejects.toThrow("Image is not available");
    await expectNothingWritten(db);
  });

  it("refuses a sessionless caller and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = null;

    await expect(
      addToCart({ frontImageId: ids.privateId, ...OPTS })
    ).rejects.toThrow("Unauthorized");
    await expectNothingWritten(db);
  });

  it("refuses a placement_render id owned by the caller, and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    const [render] = await db
      .insert(schema.placementRender)
      .values({
        designId: ids.conversationId,
        sourceImageId: ids.privateId,
        blankId: OPTS.productId,
        placementId: "back",
        imageUrl: "https://img.example/render.png",
        aspectRatio: "1:1",
      })
      .returning();

    await expect(
      addToCart({ frontImageId: render.id, ...OPTS })
    ).rejects.toThrow("Image not found");
    await expectNothingWritten(db);
  });

  it("refuses an image whose conversation row is gone, and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db
      .update(schema.image)
      .set({ sourceDesignId: "deleted-design" })
      .where(eq(schema.image.id, ids.privateId));

    await expect(
      addToCart({ frontImageId: ids.privateId, ...OPTS })
    ).rejects.toThrow("Image is not available");
    await expectNothingWritten(db);
  });

  it("refuses an image that names another user's conversation as its source, and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db
      .update(schema.image)
      .set({ sourceDesignId: ids.strangersConversationId })
      .where(eq(schema.image.id, ids.privateId));

    await expect(
      addToCart({ frontImageId: ids.privateId, ...OPTS })
    ).rejects.toThrow("Image is not available");
    await expectNothingWritten(db);
  });

  it("refuses the owner's own image once it is published and admin-hidden", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await setPublication(db, ids.publishedId, { isHidden: true });

    await expect(
      addToCart({ frontImageId: ids.publishedId, ...OPTS })
    ).rejects.toThrow("Image is not available");
    await expectNothingWritten(db);
  });
});

describe("addToCart: an anonymous owner", () => {
  it("may cart their own unpublished image (guests have carts); checkout asks them to sign in and writes nothing", async () => {
    const db = h.db as Db;
    await makeUser(db, "guest-owner");
    const conversation = await makeDesign(db, "guest-owner");
    const imageId = await makeSourceImage(db, {
      designId: conversation.id,
      ownerId: "guest-owner",
      imageUrl: "https://img.example/guest.png",
    });
    h.session = { user: { id: "guest-owner", isAnonymous: true } };

    expect(await addToCart({ frontImageId: imageId, ...OPTS })).toEqual({
      ok: true,
      count: 1,
    });
    const [row] = await db.select().from(schema.cartItem);
    expect(row.userId).toBe("guest-owner");
    expect(row.designId).toBe(conversation.id);

    expect(await checkoutCart()).toEqual({ url: null, needsAuth: true });
    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(await db.select().from(schema.orderItem)).toHaveLength(0);
    expect(h.stripeCalls).toBe(0);
  });
});

describe("addToCart: a published image", () => {
  it("is still cartable by a stranger", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "stranger", isAnonymous: false } };

    await addToCart({ frontImageId: ids.publishedId, ...OPTS });
    const [row] = await db.select().from(schema.cartItem);
    expect(row.designId).toBe(ids.conversationId);
    expect(row.placements).toEqual({ front: ids.publishedId });
  });
});
