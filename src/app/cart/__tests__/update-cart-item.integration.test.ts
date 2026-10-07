/**
 * updateCartItem, setCartItemQuantity, getEditableCartLine and CartLine.editHref
 * (#282, one buy surface slice 5) against a real in-memory libSQL. The edit
 * writes the same validated columns an add does, to exactly one owner-scoped
 * line; quantity is 1..12; checkoutCart charges what those actions wrote.
 *
 * The db singleton, auth session, Stripe and Printful are mocked; the
 * database is real (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { getBlankOrThrow } from "@/lib/blanks";
import { computePrice } from "@/lib/pricing";

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
            id: "cs_test_cart_edit",
            url: "https://checkout.stripe.example/cs_test_cart_edit",
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

import {
  addToCart,
  updateCartItem,
  setCartItemQuantity,
  getEditableCartLine,
  getCart,
  checkoutCart,
} from "@/app/cart/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

/**
 * Run `fn` with the Classic Tee's back print area removed — the shape of a
 * future blank that can't print a back. Mutates the catalog singleton and
 * always restores it, so no other test sees the change.
 */
async function withoutBackPlacement(fn: () => Promise<void>) {
  const blank = getBlankOrThrow(OPTS.productId);
  const saved = blank.placements;
  blank.placements = saved.filter((p) => p.id !== "back");
  try {
    await fn();
  } finally {
    blank.placements = saved;
  }
}

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

describe("updateCartItem (#282)", () => {
  it("changes exactly the named line: size, colour and product, keeping its quantity", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [a, b] = await cartRows(db);
    await db.update(schema.cartItem).set({ quantity: 3 }).where(eq(schema.cartItem.id, a.id));

    const result = await updateCartItem({
      id: a.id, frontImageId: ids.listingId, productId: OPTS.productId, size: "L", color: "White",
    });
    expect(result).toEqual({ ok: true });

    const rows = await cartRows(db);
    const after = rows.find((r) => r.id === a.id)!;
    expect(after.size).toBe("L");
    expect(after.color).toBe("White");
    expect(after.quantity).toBe(3);
    expect(after.placements).toEqual({ front: ids.listingId });
    const other = rows.find((r) => r.id === b.id)!;
    expect(other.size).toBe("M");
    expect(rows).toHaveLength(2);
  });

  it("another user's line id changes nothing and reports not-found", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);

    h.session = { user: { id: "other", isAnonymous: false } };
    const result = await updateCartItem({
      id: row.id, frontImageId: ids.listingId, productId: OPTS.productId, size: "L", color: "White",
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
    const [same] = await cartRows(db);
    expect(same.size).toBe("M");
    expect(same.color).toBe("Black");
  });

  it("a deleted line reports not-found and inserts nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    await db.delete(schema.cartItem).where(eq(schema.cartItem.id, row.id));

    const result = await updateCartItem({
      id: row.id, frontImageId: ids.listingId, productId: OPTS.productId, size: "L", color: "White",
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(await cartRows(db)).toHaveLength(0);
  });

  it("adds a back and a swap to a front-only line", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);

    await updateCartItem({
      id: row.id, frontImageId: ids.listingId, front: ids.myImageId, back: ids.listingId, ...OPTS,
    });
    const [after] = await cartRows(db);
    expect(after.placements).toEqual({ front: ids.myImageId, back: ids.listingId });
    expect(after.designId).toBe(ids.soldDesignId);
  });

  it("refuses a back on a product with no back print area and leaves the line unchanged", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, back: ids.myImageId, ...OPTS });
    const [row] = await cartRows(db);
    await withoutBackPlacement(async () => {
      await expect(
        updateCartItem({ id: row.id, frontImageId: ids.listingId, back: ids.myImageId, ...OPTS, size: "L" })
      ).rejects.toThrow("This product has no back print area");
    });
    const [same] = await cartRows(db);
    expect(same.size).toBe("M");
    expect(same.placements).toEqual({ front: ids.listingId, back: ids.myImageId });
  });

  it("refuses a cross-owner private back and an admin-hidden back, leaving the line unchanged", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    for (const back of [ids.sellerPrivateId, ids.sellerHiddenId]) {
      await expect(
        updateCartItem({ id: row.id, frontImageId: ids.listingId, back, ...OPTS })
      ).rejects.toThrow();
    }
    const [same] = await cartRows(db);
    expect(same.placements).toEqual({ front: ids.listingId });
  });

  it("refuses an unknown size before touching the row", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    await expect(
      updateCartItem({ id: row.id, frontImageId: ids.listingId, productId: OPTS.productId, size: "XXXS", color: "Black" })
    ).rejects.toThrow();
    const [same] = await cartRows(db);
    expect(same.size).toBe("M");
  });

  it("checkoutCart after an edit writes the edited line and the Stripe amount follows it", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    await updateCartItem({ id: row.id, frontImageId: ids.listingId, back: ids.myImageId, ...OPTS, size: "2XL" });
    await setCartItemQuantity(row.id, 2);

    const { url } = await checkoutCart();
    expect(url).toMatch(/^https:\/\//);
    const lines = await db.query.orderItem.findMany();
    expect(lines).toHaveLength(1);
    expect(lines[0].size).toBe("2XL");
    expect(lines[0].quantity).toBe(2);
    expect(lines[0].placements).toEqual({ front: ids.listingId, back: ids.myImageId });
    const expected = computePrice(0, OPTS.productId, "2XL", { back: true }).total;
    expect(lines[0].itemPrice).toBeCloseTo(expected, 2);
    const li = h.sessionParams[0]?.line_items?.[0];
    expect(li?.quantity).toBe(2);
    expect(li?.price_data?.unit_amount).toBe(Math.round(expected * 100));
  });
});

describe("setCartItemQuantity (#282)", () => {
  it("sets the quantity within 1..12 for the owner's line", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    expect(await setCartItemQuantity(row.id, 12)).toEqual({ ok: true });
    expect((await cartRows(db))[0].quantity).toBe(12);
    expect(await setCartItemQuantity(row.id, 1)).toEqual({ ok: true });
    expect((await cartRows(db))[0].quantity).toBe(1);
  });

  it("refuses 0, 13, 1.5, NaN and a string, keeping the old quantity", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    await setCartItemQuantity(row.id, 4);
    for (const q of [0, 13, 1.5, NaN, "2" as unknown as number]) {
      await expect(setCartItemQuantity(row.id, q)).rejects.toThrow("Quantity must be between 1 and 12");
    }
    expect((await cartRows(db))[0].quantity).toBe(4);
  });

  it("another user's line reports not-found and keeps its quantity", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    h.session = { user: { id: "other", isAnonymous: false } };
    expect(await setCartItemQuantity(row.id, 5)).toEqual({ ok: false, reason: "not-found" });
    expect((await cartRows(db))[0].quantity).toBe(1);
  });

  it("getCart's totals and the Stripe quote multiply by the quantity", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    const one = await getCart();
    await setCartItemQuantity(row.id, 3);
    const three = await getCart();
    expect(three.items[0].quantity).toBe(3);
    expect(three.itemSubtotal).toBeCloseTo(one.itemSubtotal * 3, 2);
  });
});

describe("getEditableCartLine and CartLine.editHref (#282)", () => {
  it("returns the owner's line and null for another user's or an unknown id", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    expect(await getEditableCartLine(row.id)).toEqual({ id: row.id, quantity: 1 });
    expect(await getEditableCartLine("nope")).toBeNull();
    h.session = { user: { id: "other", isAnonymous: false } };
    expect(await getEditableCartLine(row.id)).toBeNull();
  });

  it("a Shop line's editHref opens the page image; a swapped line's carries swap=1 and the pick as back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    await addToCart({ frontImageId: ids.listingId, front: ids.myImageId, back: ids.listingId, ...OPTS });
    const view = await getCart();
    const plain = new URL(view.items[0].editHref!, "http://x");
    expect(plain.pathname).toBe(`/d/${ids.listingId}`);
    expect(plain.searchParams.get("line")).toBe(view.items[0].id);
    expect(plain.searchParams.get("size")).toBe("M");
    const swapped = new URL(view.items[1].editHref!, "http://x");
    expect(swapped.pathname).toBe(`/d/${ids.listingId}`);
    expect(swapped.searchParams.get("back")).toBe(ids.myImageId);
    expect(swapped.searchParams.get("swap")).toBe("1");
  });

  it("a line with no front pin has no editHref", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db.insert(schema.cartItem).values({
      userId: "buyer", designId: ids.myDesignId, ...OPTS, placements: null,
    });
    const view = await getCart();
    expect(view.items[0].editHref).toBeNull();
  });
});
