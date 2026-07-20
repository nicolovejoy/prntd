/**
 * buyPublishedDesign with a back design (#25 on /d), against a real
 * in-memory libSQL (the #28 pattern). Proves the order + order_item rows
 * carry both placements and the +$8 upcharge, that the flag gates the back
 * entirely, and that a cross-owner buyer can't forge a private image id from
 * the seller's thread (the canUseAsPlacementSource tightening).
 *
 * The db singleton, auth session, and Stripe client are mocked; the database
 * is real (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq as schemaEq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser } from "@/lib/__tests__/factories";

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
          id: "cs_test_back",
          url: "https://checkout.stripe.example/cs_test_back",
        })),
      },
    },
  },
}));

import { buyPublishedDesign } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");

  // The seller's design being bought: a published image (the listing) and a
  // private sibling in the same thread.
  const [sold] = await db
    .insert(schema.design)
    .values({ userId: "seller" })
    .returning();
  const [listing] = await db
    .insert(schema.designImage)
    .values({
      designId: sold.id,
      aspectRatio: "1:1",
      imageUrl: "https://img.example/listing.png",
      publishedAt: new Date(),
    })
    .returning();
  const [sellerPrivate] = await db
    .insert(schema.designImage)
    .values({
      designId: sold.id,
      aspectRatio: "1:1",
      imageUrl: "https://img.example/seller-private.png",
    })
    .returning();

  // The buyer's own design → a legitimate back source.
  const [mine] = await db
    .insert(schema.design)
    .values({ userId: "buyer" })
    .returning();
  const [myBack] = await db
    .insert(schema.designImage)
    .values({
      designId: mine.id,
      aspectRatio: "1:1",
      imageUrl: "https://img.example/my-back.png",
    })
    .returning();
  // My Designs lists primaries only.
  await db
    .update(schema.design)
    .set({ primaryImageId: myBack.id })
    .where(schemaEq(schema.design.id, mine.id));

  return {
    soldDesignId: sold.id,
    listingId: listing.id,
    sellerPrivateId: sellerPrivate.id,
    myBackId: myBack.id,
  };
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

describe("buyPublishedDesign with a back design", () => {
  it("writes both placements and the +$8 price to the order and its line", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await buyPublishedDesign({
      imageId: ids.listingId,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      backImageId: ids.myBackId,
    });
    expect(url).toBe("https://checkout.stripe.example/cs_test_back");

    const [order] = await db.select().from(schema.order);
    expect(order.designId).toBe(ids.soldDesignId);
    expect(order.placements).toEqual({
      front: ids.listingId,
      back: ids.myBackId,
    });
    // $19.43 front + $8 back upcharge; shipping rides on top.
    expect(order.itemPrice).toBe(27.43);
    expect(order.shippingPrice).toBe(4.69);
    expect(order.totalPrice).toBe(32.12);

    const [line] = await db.select().from(schema.orderItem);
    expect(line.orderId).toBe(order.id);
    expect(line.placements).toEqual({
      front: ids.listingId,
      back: ids.myBackId,
    });
    expect(line.itemPrice).toBe(27.43);
  });

  it("rejects a forged private image id from the seller's thread and writes no order", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      buyPublishedDesign({
        imageId: ids.listingId,
        productId: "bella-canvas-3001",
        size: "M",
        color: "Black",
        backImageId: ids.sellerPrivateId,
      })
    ).rejects.toThrow("Back image is not available");

    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(await db.select().from(schema.orderItem)).toHaveLength(0);
  });

  it("allows the seller's PUBLISHED image itself as the back (Shop path)", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({
      imageId: ids.listingId,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      backImageId: ids.listingId,
    });

    const [order] = await db.select().from(schema.order);
    expect(order.placements).toEqual({
      front: ids.listingId,
      back: ids.listingId,
    });
    expect(order.itemPrice).toBe(27.43);
  });

  it("ignores the back entirely when the flag is off", async () => {
    vi.stubEnv("MULTI_PLACEMENT_ENABLED", "false");
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({
      imageId: ids.listingId,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      backImageId: ids.myBackId,
    });

    const [order] = await db.select().from(schema.order);
    expect(order.placements).toEqual({ front: ids.listingId });
    expect(order.itemPrice).toBe(19.43);
    expect(order.totalPrice).toBe(24.12);
  });

  it("keeps the front-only path unchanged when no back is passed", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({
      imageId: ids.listingId,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
    });

    const [order] = await db.select().from(schema.order);
    expect(order.placements).toEqual({ front: ids.listingId });
    expect(order.itemPrice).toBe(19.43);
  });
});

describe("getBuyPageBackSources gating", () => {
  it("returns no groups for an anonymous session", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = { user: { id: "anon-1", isAnonymous: true } };

    const { getBuyPageBackSources } = await import("@/app/d/actions");
    expect(await getBuyPageBackSources(ids.listingId)).toEqual({ groups: [] });
  });

  it("returns no groups when the flag is off", async () => {
    vi.stubEnv("MULTI_PLACEMENT_ENABLED", "false");
    const db = h.db as Db;
    const ids = await seed(db);

    const { getBuyPageBackSources } = await import("@/app/d/actions");
    expect(await getBuyPageBackSources(ids.listingId)).toEqual({ groups: [] });
  });

  it("returns the buyer-scoped groups when enabled", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    const { getBuyPageBackSources } = await import("@/app/d/actions");
    const { groups } = await getBuyPageBackSources(ids.listingId);
    const groupIds = groups.map((g) => g.id);
    expect(groupIds).not.toContain("this-design");
    expect(groupIds).toContain("my-designs");
    expect(groupIds).toContain("shop");
  });
});
