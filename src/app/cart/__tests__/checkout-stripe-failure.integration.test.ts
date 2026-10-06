/**
 * #289 item 1 on the cart path: checkoutCart inserts the order and its lines
 * before it calls Stripe. A Stripe error abandons the order (rows kept), the
 * error reaches the caller, and the cart is left as it was so the buyer can
 * try again.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  stripeError: null as Error | null,
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
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/ai", () => ({
  generatePublishedNaming: async () => ({ title: "Auto", description: "Auto" }),
}));
vi.mock("@/lib/email", () => ({
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
}));
vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
  createOrder: vi.fn(),
  getOrderByExternalId: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async () => {
          if (h.stripeError) throw h.stripeError;
          return { id: "cs_test_cart_retry", url: "https://checkout.stripe.example/cs_test_cart_retry" };
        }),
      },
    },
  },
}));

import { addToCart, checkoutCart } from "@/app/cart/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seedCart(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  const conversation = await makeDesign(db, "seller");
  const first = await makeSourceImage(db, {
    designId: conversation.id, ownerId: "seller",
    imageUrl: "https://img.example/first.png", publishedAt: new Date(),
  });
  const second = await makeSourceImage(db, {
    designId: conversation.id, ownerId: "seller",
    imageUrl: "https://img.example/second.png", publishedAt: new Date(),
  });
  await addToCart({ frontImageId: first, ...OPTS });
  await addToCart({ frontImageId: second, ...OPTS });
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", email: "buyer@example.com", isAnonymous: false } };
  h.stripeError = null;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());

describe("checkoutCart when Stripe throws", () => {
  it("abandons the order, keeps its lines, re-throws, and leaves the cart intact", async () => {
    const db = h.db as Db;
    await seedCart(db);
    const boom = new Error("stripe boom");
    h.stripeError = boom;

    await expect(checkoutCart()).rejects.toBe(boom);

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("pending");
    expect(orders[0].abandonedAt).not.toBeNull();
    expect(orders[0].stripeSessionId).toBeNull();
    expect(await db.select().from(schema.orderItem)).toHaveLength(2);
    expect(await db.select().from(schema.cartItem)).toHaveLength(2);
  });

  it("a retry once Stripe recovers makes a live order from the same cart", async () => {
    const db = h.db as Db;
    await seedCart(db);
    h.stripeError = new Error("stripe boom");
    await expect(checkoutCart()).rejects.toThrow("stripe boom");

    h.stripeError = null;
    const result = await checkoutCart();
    expect(result.url).toBe("https://checkout.stripe.example/cs_test_cart_retry");

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(2);
    const live = orders.filter((o) => o.abandonedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].stripeSessionId).toBe("cs_test_cart_retry");
  });
});
