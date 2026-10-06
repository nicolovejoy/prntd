/**
 * addToCart's `designId` entry (the /preview path) against a real in-memory
 * libSQL (the #28 pattern). #251: the `designId` path resolved the design's
 * CURRENT primary image and pinned it as the front for ANY design id, with no
 * check that the caller owns that design. Design ids of published images are
 * public (`getImagePage` returns `sourceDesignId`), so an anonymous or
 * cross-owner caller could cart — and a real account could buy — a seller's
 * current primary image even when it is private/unpublished.
 *
 * /preview was the only real caller of this path (it is a redirect now, so the
 * UI sends none), and a cross-owner designId never legitimately reached
 * addToCart from it. This test proves the server action refuses it itself,
 * the same way `createCheckoutSession` does, rather than trusting the caller.
 *
 * Proves:
 *  - a cross-owner designId (no front) throws and carts nothing;
 *  - a cross-owner designId WITH an explicit front throws and carts nothing
 *    (the owner check gates the whole path, not just the primary-resolution
 *    branch);
 *  - the buyer's own designId still works and pins the design's primary.
 *
 * The db singleton, auth session, Stripe and Printful are mocked; the
 * database is real (FKs enforced, schema-derived).
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

// Shipping quote falls back to the flat estimate.
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
  // A published sibling — the design id itself is discoverable from
  // getImagePage's sourceDesignId, but the CURRENT primary above is private.
  const sellerPublishedId = await makeSourceImage(db, {
    designId: sellers.id,
    ownerId: "seller",
    imageUrl: "https://img.example/seller-published.png",
    publishedAt: new Date(),
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

  return {
    sellerDesignId: sellers.id,
    sellerPrimaryId,
    sellerPublishedId,
    myDesignId: mine.id,
    myPrimaryId,
  };
}

async function cartRows(db: Db) {
  return db.query.cartItem.findMany();
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("addToCart designId ownership (#251)", () => {
  it("rejects a cross-owner designId with no front, carting nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      addToCart({ designId: ids.sellerDesignId, ...OPTS })
    ).rejects.toThrow("Design not found");
    expect(await cartRows(db)).toHaveLength(0);
  });

  it("rejects a cross-owner designId even with an explicit front, carting nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      addToCart({
        designId: ids.sellerDesignId,
        front: ids.sellerPublishedId,
        ...OPTS,
      })
    ).rejects.toThrow("Design not found");
    expect(await cartRows(db)).toHaveLength(0);
  });

  it("still works for the caller's own designId, pinning the primary", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    const res = await addToCart({ designId: ids.myDesignId, ...OPTS });
    expect(res).toEqual({ ok: true, count: 1 });

    const [row] = await cartRows(db);
    expect(row.designId).toBe(ids.myDesignId);
    expect(row.placements).toEqual({ front: ids.myPrimaryId });
  });
});
