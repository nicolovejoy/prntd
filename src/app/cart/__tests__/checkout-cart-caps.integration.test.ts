/**
 * checkoutCart's daily checkout cap and cart line cap (#316) against a real
 * in-memory libSQL. Order of refusals: sign-in, checkout quota, empty cart,
 * unavailable line, too many lines, then writes.
 *
 * The db singleton, auth session, request headers, Printful quote and Stripe
 * client are mocked; the database is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import {
  CHECKOUT_LIMIT_REACHED,
  CHECKOUT_LIMIT_REACHED_IP,
  CART_TOO_FULL_TO_CHECKOUT,
  CART_LINE_UNAVAILABLE,
} from "@/lib/action-copy";
import { CART_MAX_LINES } from "@/lib/cart-line-edit";
import { dayKeyUTC } from "@/lib/generation-quota";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  forwardedFor: null as string | null,
  quote: vi.fn(),
  create: vi.fn(),
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

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(h.forwardedFor ? { "x-forwarded-for": h.forwardedFor } : {}),
}));

vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: (...args: unknown[]) => h.quote(...args),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        expire: vi.fn(async (id: string) => ({ id, status: "expired" })),
        create: (...args: unknown[]) => h.create(...args),
      },
    },
  },
}));

import { addToCart, checkoutCart } from "@/app/cart/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const BUYER = { user: { id: "buyer", isAnonymous: false } };
const TODAY = () => dayKeyUTC(new Date());

async function setBucket(db: Db, bucket: string, count: number) {
  await db
    .insert(schema.generationUsage)
    .values({ bucket, day: TODAY(), count })
    .onConflictDoUpdate({
      target: [schema.generationUsage.bucket, schema.generationUsage.day],
      set: { count },
    });
}

async function bucketCount(db: Db, bucket: string): Promise<number | null> {
  const [row] = await db
    .select({ c: schema.generationUsage.count })
    .from(schema.generationUsage)
    .where(
      and(
        eq(schema.generationUsage.bucket, bucket),
        eq(schema.generationUsage.day, TODAY())
      )
    );
  return row?.c ?? null;
}

/** A cart of `lines` lines for "buyer": one real add, the rest cloned rows. */
async function seedCart(db: Db, lines: number) {
  await makeUser(db, "buyer");
  const mine = await makeDesign(db, "buyer");
  const imageId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine.png",
  });
  await addToCart({
    frontImageId: imageId,
    productId: "bella-canvas-3001",
    size: "M",
    color: "Black",
  });
  const [first] = await db.select().from(schema.cartItem);
  for (let i = 1; i < lines; i++) {
    await db.insert(schema.cartItem).values({ ...first, id: crypto.randomUUID() });
  }
}

async function orderCount(db: Db): Promise<number> {
  return (await db.select().from(schema.order)).length;
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = BUYER;
  h.forwardedFor = null;
  h.quote.mockReset();
  h.quote.mockResolvedValue(null);
  h.create.mockReset();
  h.create.mockResolvedValue({
    id: "cs_test_1",
    url: "https://checkout.stripe.example/cs_test_hosted",
  });
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkoutCart daily checkout cap (#316)", () => {
  it("at the cap: refused as data, no order, Stripe and the quote not called", async () => {
    const db = h.db as Db;
    await seedCart(db, 1);
    await setBucket(db, "checkout:user:buyer", 30);

    const result = await checkoutCart();

    expect(result).toEqual({ url: null, error: CHECKOUT_LIMIT_REACHED });
    expect(await orderCount(db)).toBe(0);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.quote).not.toHaveBeenCalled();
  });

  it("embedded mode refuses the same way", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    const db = h.db as Db;
    await seedCart(db, 1);
    await setBucket(db, "checkout:user:buyer", 30);

    expect(await checkoutCart()).toEqual({ url: null, error: CHECKOUT_LIMIT_REACHED });
    expect(await orderCount(db)).toBe(0);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("one under the cap: proceeds, and the bucket is at 30 afterwards", async () => {
    const db = h.db as Db;
    await seedCart(db, 1);
    await setBucket(db, "checkout:user:buyer", 29);

    const result = await checkoutCart();

    expect(result.error).toBeUndefined();
    expect(result.url).toBeTruthy();
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(await orderCount(db)).toBe(1);
    expect(await bucketCount(db, "checkout:user:buyer")).toBe(30);
  });

  it("bumps the first x-forwarded-for address once", async () => {
    h.forwardedFor = "203.0.113.9, 10.0.0.1";
    const db = h.db as Db;
    await seedCart(db, 1);

    await checkoutCart();

    expect(await bucketCount(db, "checkout:ip:203.0.113.9")).toBe(1);
  });

  it("refuses on the IP bucket with the network line", async () => {
    h.forwardedFor = "203.0.113.9";
    const db = h.db as Db;
    await seedCart(db, 1);
    await setBucket(db, "checkout:ip:203.0.113.9", 100);

    expect(await checkoutCart()).toEqual({ url: null, error: CHECKOUT_LIMIT_REACHED_IP });
    expect(await orderCount(db)).toBe(0);
  });

  it("a guest gets needsAuth and no bucket is bumped", async () => {
    h.session = { user: { id: "buyer", isAnonymous: true } };
    const db = h.db as Db;
    await seedCart(db, 1);

    expect(await checkoutCart()).toEqual({ url: null, needsAuth: true });
    expect(await bucketCount(db, "checkout:user:buyer")).toBeNull();
  });

  it("an empty cart still spends the attempt", async () => {
    const db = h.db as Db;
    await makeUser(db, "buyer");

    expect(await checkoutCart()).toEqual({ url: null });
    expect(await bucketCount(db, "checkout:user:buyer")).toBe(1);
  });
});

describe("checkoutCart cart line cap (#316)", () => {
  it("a cart over the cap is refused, nothing written, the attempt counted", async () => {
    const db = h.db as Db;
    await seedCart(db, CART_MAX_LINES + 1);

    const result = await checkoutCart();

    expect(result).toEqual({ url: null, error: CART_TOO_FULL_TO_CHECKOUT });
    expect(await orderCount(db)).toBe(0);
    expect(h.create).not.toHaveBeenCalled();
    expect(await bucketCount(db, "checkout:user:buyer")).toBe(1);
  });

  it("a cart of exactly the cap checks out", async () => {
    const db = h.db as Db;
    await seedCart(db, CART_MAX_LINES);

    const result = await checkoutCart();

    expect(result.error).toBeUndefined();
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(await orderCount(db)).toBe(1);
  });

  it("refusal order: a stale line in an over-cap cart gives the unavailable refusal, nothing written, the attempt counted", async () => {
    const db = h.db as Db;
    await seedCart(db, CART_MAX_LINES + 1);
    // Make one line stale: its size is no longer orderable.
    const [row] = await db.select().from(schema.cartItem);
    await db
      .update(schema.cartItem)
      .set({ size: "ZZZ" })
      .where(eq(schema.cartItem.id, row.id));

    const result = await checkoutCart();

    expect(result).toEqual({ url: null, error: CART_LINE_UNAVAILABLE });
    expect(await orderCount(db)).toBe(0);
    expect(h.create).not.toHaveBeenCalled();
    expect(await bucketCount(db, "checkout:user:buyer")).toBe(1);
  });
});
