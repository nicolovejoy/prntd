/**
 * addToCart takes the image detail page's image and nothing else (#278 slice
 * 6a). The old `designId` entry (the /preview path) is gone: it trusted a
 * design's CURRENT primary image as the front (#251), so a stray `designId`
 * from a hand-built call must now cart nothing, whoever owns the design.
 * Ownership of `frontImageId` (a seller's private image refused, one's own
 * unpublished image accepted) is pinned in add-to-cart-front-pin and
 * add-to-cart-own-unpublished.
 *
 * The db singleton, auth session, Stripe and Printful are mocked; the
 * database is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
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

vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { create: vi.fn() } } },
}));

vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
}));

import { addToCart } from "@/app/cart/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  const sellers = await makeDesign(db, "seller");
  const sellerPrimaryId = await makeSourceImage(db, {
    designId: sellers.id,
    ownerId: "seller",
    imageUrl: "https://img.example/seller-primary.png",
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: sellerPrimaryId })
    .where(eq(schema.design.id, sellers.id));
  const mine = await makeDesign(db, "buyer");
  const myPrimaryId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine.png",
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: myPrimaryId })
    .where(eq(schema.design.id, mine.id));
  return { sellerDesignId: sellers.id, myDesignId: mine.id };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("addToCart without frontImageId (#278 slice 6a)", () => {
  it("refuses a designId alone, for another owner's design and for the caller's own, carting nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    for (const designId of [ids.sellerDesignId, ids.myDesignId]) {
      await expect(
        // The type no longer admits designId; a hand-built action call can still send it.
        addToCart({ designId, ...OPTS } as unknown as Parameters<typeof addToCart>[0])
      ).rejects.toThrow("frontImageId required");
    }
    expect(await db.query.cartItem.findMany()).toHaveLength(0);
  });
});
