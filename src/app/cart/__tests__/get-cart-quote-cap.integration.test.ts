/**
 * getCart's daily cap on live Printful shipping quotes (#316's fourth bullet)
 * against a real in-memory libSQL. Past the cap, or when the quota write
 * fails, the cart shows the flat estimate and Printful is not asked;
 * checkoutCart still quotes live and spends no cart-quote unit.
 *
 * The db singleton, auth session, request headers, Printful quote and Stripe
 * client are mocked; the database is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { FLAT_SHIPPING_USD } from "@/lib/pricing";
import {
  dayKeyUTC,
  USER_CART_QUOTE_DAILY_CAP,
  USER_IP_CART_QUOTE_DAILY_CAP,
} from "@/lib/generation-quota";

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

import { addToCart, checkoutCart, getCart } from "@/app/cart/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const LIVE_SHIPPING = 7.77;
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

async function seedOneLine(db: Db, userId: string) {
  await makeUser(db, userId);
  const design = await makeDesign(db, userId);
  const imageId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: userId,
    imageUrl: "https://img.example/quote-cap.png",
  });
  await addToCart({
    frontImageId: imageId,
    productId: "bella-canvas-3001",
    size: "M",
    color: "Black",
  });
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  h.forwardedFor = null;
  h.quote.mockReset();
  h.quote.mockResolvedValue({ shipping: LIVE_SHIPPING });
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

describe("getCart live quote cap (#316)", () => {
  it("under the cap: quotes live and spends one unit per view", async () => {
    const db = h.db as Db;
    await seedOneLine(db, "buyer");

    const first = await getCart();
    const second = await getCart();

    expect(first.shipping).toBe(LIVE_SHIPPING);
    expect(second.shipping).toBe(LIVE_SHIPPING);
    expect(h.quote).toHaveBeenCalledTimes(2);
    expect(await bucketCount(db, "cart-quote:user:buyer")).toBe(2);
  });

  it("at the identity cap: flat estimate, Printful not asked, items still shown", async () => {
    const db = h.db as Db;
    await seedOneLine(db, "buyer");
    await setBucket(db, "cart-quote:user:buyer", USER_CART_QUOTE_DAILY_CAP);

    const view = await getCart();

    expect(view.items).toHaveLength(1);
    expect(view.shipping).toBe(FLAT_SHIPPING_USD);
    expect(h.quote).not.toHaveBeenCalled();
  });

  it("at the IP cap: flat estimate, for a guest too", async () => {
    h.session = { user: { id: "guest", isAnonymous: true } };
    h.forwardedFor = "203.0.113.7, 10.0.0.1";
    const db = h.db as Db;
    await seedOneLine(db, "guest");
    await setBucket(db, "cart-quote:ip:203.0.113.7", USER_IP_CART_QUOTE_DAILY_CAP);

    const view = await getCart();

    expect(view.shipping).toBe(FLAT_SHIPPING_USD);
    expect(h.quote).not.toHaveBeenCalled();
  });

  it("an empty cart spends no unit", async () => {
    const db = h.db as Db;
    await makeUser(db, "buyer");

    const view = await getCart();

    expect(view.items).toHaveLength(0);
    expect(await bucketCount(db, "cart-quote:user:buyer")).toBeNull();
    expect(h.quote).not.toHaveBeenCalled();
  });

  it("a failing quota write falls back to the flat estimate instead of failing the cart", async () => {
    const db = h.db as Db;
    await seedOneLine(db, "buyer");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await db.run("DROP TABLE generation_usage");

    const view = await getCart();

    expect(view.items).toHaveLength(1);
    expect(view.shipping).toBe(FLAT_SHIPPING_USD);
    expect(h.quote).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("checkoutCart past the cart quote cap still quotes live and spends no cart-quote unit", async () => {
    const db = h.db as Db;
    await seedOneLine(db, "buyer");
    await setBucket(db, "cart-quote:user:buyer", USER_CART_QUOTE_DAILY_CAP);

    const result = await checkoutCart();

    expect(result.url).toBeTruthy();
    expect(h.quote).toHaveBeenCalledTimes(1);
    expect(await bucketCount(db, "cart-quote:user:buyer")).toBe(USER_CART_QUOTE_DAILY_CAP);
  });
});
