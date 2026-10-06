/**
 * The owner orders an UNPUBLISHED image from the image detail page (one buy
 * surface, slice 3) against a real in-memory libSQL. This changes who may
 * create an order, so every refusal asserts that nothing was written: zero
 * `order` rows, zero `order_item` rows and zero Stripe calls.
 *
 * Prices are matched by pattern only; the value is not this file's concern.
 *
 * The db singleton, auth session and Stripe are mocked; the database is real
 * (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import { reparentUserData } from "@/lib/reparent-user";
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
            id: `cs_test_own_${h.sessionParams.length}`,
            url: "https://checkout.stripe.example/cs_test_own",
          };
        }),
      },
    },
  },
}));

import {
  buyPublishedDesign,
  getBuyPageBackSources,
  getImagePage,
} from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seed(db: Db) {
  await makeUser(db, "owner");
  await makeUser(db, "stranger");
  await makeUser(db, "guest");

  // The owner's conversation: an unpublished image (the one being ordered), a
  // second unpublished image (a legitimate back or swap source) and a published
  // one.
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

  // A conversation the owner does not own.
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
  expect(await db.select().from(schema.order)).toHaveLength(0);
  expect(await db.select().from(schema.orderItem)).toHaveLength(0);
  expect(await db.select().from(schema.cartItem)).toHaveLength(0);
  expect(await db.select().from(schema.ledgerEntry)).toHaveLength(0);
  expect(h.sessionParams).toHaveLength(0);
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "owner", isAnonymous: false } };
  h.sessionParams = [];
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("STRIPE_SECRET_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the owner orders an unpublished image", () => {
  it("books one order and one line pinned to the image, with no Shop composition", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await buyPublishedDesign({ imageId: ids.privateId, ...OPTS });
    expect(url).toBe("https://checkout.stripe.example/cs_test_own");

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(1);
    const [order] = orders;
    expect(order.userId).toBe("owner");
    expect(order.designId).toBe(ids.conversationId);
    expect(order.storeProductId).toBeNull();
    expect(order.status).toBe("pending");
    expect(order.stripeSessionId).toBe("cs_test_own_1");

    const lines = await db.select().from(schema.orderItem);
    expect(lines).toHaveLength(1);
    expect(lines[0].orderId).toBe(order.id);
    expect(lines[0].designId).toBe(ids.conversationId);
    expect(lines[0].placements).toEqual({ front: ids.privateId });
    expect(lines[0].productId).toBe(OPTS.productId);
    expect(lines[0].size).toBe(OPTS.size);
    expect(lines[0].color).toBe(OPTS.color);

    // Nothing is booked until the webhook claims the order.
    expect(await db.select().from(schema.ledgerEntry)).toHaveLength(0);
    expect(await db.select().from(schema.cartItem)).toHaveLength(0);

    expect(h.sessionParams).toHaveLength(1);
    const params = h.sessionParams[0];
    expect(params.metadata).toEqual({
      orderId: order.id,
      designId: ids.conversationId,
    });
    expect(params.line_items?.[0].price_data?.product_data?.images).toEqual([
      "https://img.example/private.png",
    ]);
    expect(String(order.itemPrice)).toMatch(/\d/);
  });

  it("returns the buyer to the same panel from Stripe's cancel link", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({ imageId: ids.privateId, ...OPTS });

    const cancel = new URL(h.sessionParams[0].cancel_url as string);
    expect(cancel.pathname).toBe(`/d/${ids.privateId}`);
    expect(cancel.searchParams.get("order")).toBe("1");
    expect(cancel.searchParams.get("size")).toBe(OPTS.size);
    expect(cancel.searchParams.get("color")).toBe(OPTS.color);
    expect(cancel.searchParams.get("product")).toBe(OPTS.productId);
    expect((await db.select().from(schema.order))).toHaveLength(1);
  });

  it("pins a back from the owner's own conversation", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({
      imageId: ids.privateId,
      backImageId: ids.secondPrivateId,
      ...OPTS,
    });

    const [order] = await db.select().from(schema.order);
    const [line] = await db.select().from(schema.orderItem);
    expect(order.storeProductId).toBeNull();
    expect(line.placements).toEqual({
      front: ids.privateId,
      back: ids.secondPrivateId,
    });
    // The back is priced: the line costs more than the front-only line.
    expect(line.itemPrice).toBeGreaterThan(0);
    const frontOnly = await buyPublishedDesign({
      imageId: ids.privateId,
      ...OPTS,
    });
    expect(frontOnly.url).not.toBeNull();
    const lines = await db.select().from(schema.orderItem);
    const front = lines.find((l) => !(l.placements ?? {}).back)!;
    expect(line.itemPrice).toBeGreaterThan(front.itemPrice);
  });

  it("pins a swap: the pick on the front, the page image on the back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({
      imageId: ids.privateId,
      frontImageId: ids.secondPrivateId,
      backImageId: ids.privateId,
      ...OPTS,
    });

    const [order] = await db.select().from(schema.order);
    const [line] = await db.select().from(schema.orderItem);
    expect(order.designId).toBe(ids.conversationId);
    expect(order.storeProductId).toBeNull();
    expect(line.placements).toEqual({
      front: ids.secondPrivateId,
      back: ids.privateId,
    });
    const cancel = new URL(h.sessionParams[0].cancel_url as string);
    expect(cancel.searchParams.get("swap")).toBe("1");
    expect(cancel.searchParams.get("back")).toBe(ids.secondPrivateId);
  });

  it("refuses another person's private image as the back, and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      buyPublishedDesign({
        imageId: ids.privateId,
        backImageId: ids.strangerPrivateId,
        ...OPTS,
      })
    ).rejects.toThrow("Back image is not available");
    await expectNothingWritten(db);
  });

  it("refuses another person's private image as a swapped front, and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      buyPublishedDesign({
        imageId: ids.privateId,
        frontImageId: ids.strangerPrivateId,
        backImageId: ids.privateId,
        ...OPTS,
      })
    ).rejects.toThrow("Front image is not available");
    await expectNothingWritten(db);
  });

  it("books no composition for an image that was published and then unpublished", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    // What unpublishImage leaves: no listing row, the mirror product drafted.
    await db
      .delete(schema.imagePublication)
      .where(eq(schema.imagePublication.imageId, ids.publishedId));
    await db.update(schema.product).set({ status: "draft" });

    await buyPublishedDesign({ imageId: ids.publishedId, ...OPTS });

    const [order] = await db.select().from(schema.order);
    expect(order.storeProductId).toBeNull();
    expect(order.designId).toBe(ids.conversationId);
  });
});

describe("a non-owner cannot order an unpublished image", () => {
  it("throws for a signed-in stranger and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "stranger", isAnonymous: false } };

    await expect(
      buyPublishedDesign({ imageId: ids.privateId, ...OPTS })
    ).rejects.toThrow("Image is not available to buy");
    await expectNothingWritten(db);
  });

  it("returns needsAuth for a signed-out caller and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = null;

    expect(
      await buyPublishedDesign({ imageId: ids.privateId, ...OPTS })
    ).toEqual({ url: null, needsAuth: true });
    await expectNothingWritten(db);
  });

  it("returns needsAuth for a guest who does not own it and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "guest", isAnonymous: true } };

    expect(
      await buyPublishedDesign({ imageId: ids.privateId, ...OPTS })
    ).toEqual({ url: null, needsAuth: true });
    await expectNothingWritten(db);
  });
});

describe("an anonymous owner", () => {
  it("gets needsAuth for their own unpublished image, and nothing is written", async () => {
    const db = h.db as Db;
    await makeUser(db, "guest-owner");
    const conversation = await makeDesign(db, "guest-owner");
    const imageId = await makeSourceImage(db, {
      designId: conversation.id,
      ownerId: "guest-owner",
      imageUrl: "https://img.example/guest.png",
    });
    h.session = { user: { id: "guest-owner", isAnonymous: true } };

    expect(await buyPublishedDesign({ imageId, ...OPTS })).toEqual({
      url: null,
      needsAuth: true,
    });
    await expectNothingWritten(db);
  });
});

describe("an anonymous owner who signs in", () => {
  it("keeps the image and can then order it as the real account", async () => {
    const db = h.db as Db;
    await makeUser(db, "guest-owner");
    await makeUser(db, "owner");
    const conversation = await makeDesign(db, "guest-owner");
    const imageId = await makeSourceImage(db, {
      designId: conversation.id,
      ownerId: "guest-owner",
      imageUrl: "https://img.example/guest.png",
    });
    h.session = { user: { id: "guest-owner", isAnonymous: true } };
    expect(await buyPublishedDesign({ imageId, ...OPTS })).toEqual({
      url: null,
      needsAuth: true,
    });

    // Sign-in or sign-up: the anonymous plugin's onLinkAccount re-parents the
    // guest's data to the real account (src/lib/reparent-user.ts).
    await reparentUserData(db as never, "guest-owner", "owner");
    h.session = { user: { id: "owner", isAnonymous: false } };

    const { url } = await buyPublishedDesign({ imageId, ...OPTS });
    expect(url).toBe("https://checkout.stripe.example/cs_test_own");
    const [order] = await db.select().from(schema.order);
    expect(order.userId).toBe("owner");
    expect(order.designId).toBe(conversation.id);
    expect(order.storeProductId).toBeNull();
    const [line] = await db.select().from(schema.orderItem);
    expect(line.placements).toEqual({ front: imageId });
  });
});

describe("ids that are not a buyable page image", () => {
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
      buyPublishedDesign({ imageId: render.id, ...OPTS })
    ).rejects.toThrow("Image not found");
    await expectNothingWritten(db);
  });

  it("refuses an image whose conversation row is gone, and writes nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    // An image survives its conversation's delete when an order, seed or cart
    // still references it; its source_design_id then names nothing.
    await db
      .update(schema.image)
      .set({ sourceDesignId: "deleted-design" })
      .where(eq(schema.image.id, ids.privateId));

    await expect(
      buyPublishedDesign({ imageId: ids.privateId, ...OPTS })
    ).rejects.toThrow("Image is not available to buy");
    await expectNothingWritten(db);
  });

  it("refuses an image the owner holds that names another user's conversation as its source", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db
      .update(schema.image)
      .set({ sourceDesignId: ids.strangersConversationId })
      .where(eq(schema.image.id, ids.privateId));

    await expect(
      buyPublishedDesign({ imageId: ids.privateId, ...OPTS })
    ).rejects.toThrow("Image is not available to buy");
    await expectNothingWritten(db);
  });

  it("refuses an image with no source whose only output link is another user's conversation", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    // Owned by the caller, no source_design_id, linked as an output of the
    // stranger's conversation.
    const linkedId = crypto.randomUUID();
    await db.insert(schema.image).values({
      id: linkedId,
      ownerId: "owner",
      imageUrl: "https://img.example/linked.png",
      aspectRatio: "1:1",
      sourceDesignId: null,
    });
    await db.insert(schema.conversationImage).values({
      designId: ids.strangersConversationId,
      imageId: linkedId,
      role: "output",
    });

    await expect(
      buyPublishedDesign({ imageId: linkedId, ...OPTS })
    ).rejects.toThrow("Image is not available to buy");
    await expectNothingWritten(db);
  });

  it("refuses an image with no conversation at all, and writes nothing", async () => {
    const db = h.db as Db;
    await seed(db);
    const orphanId = crypto.randomUUID();
    await db.insert(schema.image).values({
      id: orphanId,
      ownerId: "owner",
      imageUrl: "https://img.example/orphan.png",
      aspectRatio: "1:1",
    });

    await expect(
      buyPublishedDesign({ imageId: orphanId, ...OPTS })
    ).rejects.toThrow("Image not found");
    await expectNothingWritten(db);
  });

  it("refuses the owner's own image once it is published and admin-hidden", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await setPublication(db, ids.publishedId, { isHidden: true });

    await expect(
      buyPublishedDesign({ imageId: ids.publishedId, ...OPTS })
    ).rejects.toThrow("Image is not available to buy");
    await expectNothingWritten(db);
  });
});

describe("a published image still books its Shop composition", () => {
  it("a stranger buying it books store_product_id", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "stranger", isAnonymous: false } };

    await buyPublishedDesign({ imageId: ids.publishedId, ...OPTS });

    const [order] = await db.select().from(schema.order);
    const mirror = (await db.select().from(schema.product)).find(
      (p) => (p.placements ?? {}).front === ids.publishedId
    );
    expect(mirror).toBeTruthy();
    expect(order.storeProductId).toBe(mirror!.id);
    expect(order.designId).toBe(ids.conversationId);
  });

  it("its own owner buying it books store_product_id too", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({ imageId: ids.publishedId, ...OPTS });

    const [order] = await db.select().from(schema.order);
    const mirror = (await db.select().from(schema.product)).find(
      (p) => (p.placements ?? {}).front === ids.publishedId
    );
    expect(order.storeProductId).toBe(mirror!.id);
  });

  it("an owner of a published image whose mirror is missing is refused, not booked without one", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db.delete(schema.product);

    await expect(
      buyPublishedDesign({ imageId: ids.publishedId, ...OPTS })
    ).rejects.toThrow("no composition");
    await expectNothingWritten(db);
  });
});

describe("getBuyPageBackSources for an unpublished image", () => {
  it("gives the owner the groups, This design included", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    const { groups } = await getBuyPageBackSources(ids.privateId);
    const thisDesign = groups.find((g) => g.id === "this-design");
    expect(thisDesign).toBeTruthy();
    expect(thisDesign!.images.map((i) => i.id)).toContain(ids.secondPrivateId);
  });

  it("gives a signed-in non-owner nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "stranger", isAnonymous: false } };

    expect(await getBuyPageBackSources(ids.privateId)).toEqual({ groups: [] });
  });

  it("gives an anonymous owner and a signed-out viewer nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    h.session = { user: { id: "owner", isAnonymous: true } };
    expect(await getBuyPageBackSources(ids.privateId)).toEqual({ groups: [] });
    h.session = null;
    expect(await getBuyPageBackSources(ids.privateId)).toEqual({ groups: [] });
  });

  it("gives nothing for a placement render id or an image with no live conversation", async () => {
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
    expect(await getBuyPageBackSources(render.id)).toEqual({ groups: [] });

    await db
      .update(schema.image)
      .set({ sourceDesignId: "deleted-design" })
      .where(eq(schema.image.id, ids.privateId));
    expect(await getBuyPageBackSources(ids.privateId)).toEqual({ groups: [] });
  });
});

describe("getImagePage canOrder", () => {
  it("is true for the owner of an unpublished image with a live conversation", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    expect((await getImagePage(ids.privateId))?.canOrder).toBe(true);
  });

  it("is true for an anonymous owner (the panel then asks them to sign in)", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "owner", isAnonymous: true } };
    expect((await getImagePage(ids.privateId))?.canOrder).toBe(true);
  });

  it("is false when the owner's image has no live conversation", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db
      .update(schema.image)
      .set({ sourceDesignId: "deleted-design" })
      .where(eq(schema.image.id, ids.privateId));
    expect((await getImagePage(ids.privateId))?.canOrder).toBe(false);
  });

  it("is false when the image names another user's conversation", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db
      .update(schema.image)
      .set({ sourceDesignId: ids.strangersConversationId })
      .where(eq(schema.image.id, ids.privateId));
    expect((await getImagePage(ids.privateId))?.canOrder).toBe(false);
  });

  it("does not exist for a stranger or a signed-out viewer: the page 404s", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "stranger", isAnonymous: false } };
    expect(await getImagePage(ids.privateId)).toBeNull();
    h.session = null;
    expect(await getImagePage(ids.privateId)).toBeNull();
  });

  it("is true for a published image, whoever views it", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = null;
    expect((await getImagePage(ids.publishedId))?.canOrder).toBe(true);
  });
});
