/**
 * addToCart refuses a full cart (#316) on both entries, as data, and counts
 * guests the same way. Real in-memory libSQL; db, auth and headers mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { CART_FULL } from "@/lib/action-copy";
import { CART_MAX_LINES } from "@/lib/cart-line-edit";

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
vi.mock("@/lib/printful", () => ({ estimateOrderCosts: vi.fn(async () => null) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { addToCart } from "@/app/cart/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seed(db: Db, lines: number) {
  await makeUser(db, "buyer");
  const mine = await makeDesign(db, "buyer");
  const imageId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine.png",
  });
  for (let i = 0; i < lines; i++) {
    await db.insert(schema.cartItem).values({
      userId: "buyer",
      designId: mine.id,
      ...OPTS,
      placements: { front: imageId },
    });
  }
  return { designId: mine.id, imageId };
}

async function lineCount(db: Db): Promise<number> {
  return (await db.select().from(schema.cartItem)).length;
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("addToCart line cap (#316)", () => {
  it("the 41st add is refused as data and nothing is inserted", async () => {
    const db = h.db as Db;
    const { imageId } = await seed(db, CART_MAX_LINES);

    const result = await addToCart({ frontImageId: imageId, ...OPTS });

    expect(result).toEqual({ ok: false, count: CART_MAX_LINES, error: CART_FULL });
    expect(await lineCount(db)).toBe(CART_MAX_LINES);
  });

  it("one under the cap: the add succeeds and returns the new count", async () => {
    const db = h.db as Db;
    const { imageId } = await seed(db, CART_MAX_LINES - 1);

    const viaImage = await addToCart({ frontImageId: imageId, ...OPTS });
    expect(viaImage).toEqual({ ok: true, count: CART_MAX_LINES });
    expect(await lineCount(db)).toBe(CART_MAX_LINES);

    // Now full: the next add is refused.
    expect((await addToCart({ frontImageId: imageId, ...OPTS })).error).toBe(CART_FULL);
  });

  it("a guest (anonymous user row) is capped the same way", async () => {
    const db = h.db as Db;
    const { imageId } = await seed(db, CART_MAX_LINES);
    h.session = { user: { id: "buyer", isAnonymous: true } };

    const result = await addToCart({ frontImageId: imageId, ...OPTS });

    expect(result).toEqual({ ok: false, count: CART_MAX_LINES, error: CART_FULL });
  });

  it("20 concurrent adds at 39 lines land exactly one (hard cap)", async () => {
    const db = h.db as Db;
    const { imageId } = await seed(db, CART_MAX_LINES - 1);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => addToCart({ frontImageId: imageId, ...OPTS }))
    );

    expect(await lineCount(db)).toBe(CART_MAX_LINES);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(19);
    for (const r of refused) {
      expect(r).toEqual({ ok: false, count: CART_MAX_LINES, error: CART_FULL });
    }
    expect(results.find((r) => r.ok)?.count).toBe(CART_MAX_LINES);
  });

  it("100 concurrent adds on an empty cart land exactly the cap", async () => {
    const db = h.db as Db;
    const { imageId } = await seed(db, 0);

    const results = await Promise.all(
      Array.from({ length: 100 }, () => addToCart({ frontImageId: imageId, ...OPTS }))
    );

    expect(await lineCount(db)).toBe(CART_MAX_LINES);
    expect(results.filter((r) => r.ok)).toHaveLength(CART_MAX_LINES);
  });
});
