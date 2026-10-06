/**
 * #289 item 1 through the real buy action: a published image bought from its
 * image detail page, Stripe throws. The order is abandoned (rows kept, Shop
 * attribution intact), the buyer sees the Stripe error, and a retry makes a
 * second, live order.
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
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async () => {
          if (h.stripeError) throw h.stripeError;
          return {
            id: "cs_test_retry",
            url: "https://checkout.stripe.example/cs_test_retry",
          };
        }),
      },
    },
  },
}));

import { buyPublishedDesign } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;
const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  const conversation = await makeDesign(db, "seller");
  const publishedId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "seller",
    imageUrl: "https://img.example/published.png",
    publishedAt: new Date(),
  });
  return { publishedId };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  h.stripeError = null;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("STRIPE_SECRET_KEY", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("buyPublishedDesign when Stripe throws", () => {
  it("abandons the order, keeps its rows and Shop attribution, and re-throws", async () => {
    const db = h.db as Db;
    const { publishedId } = await seed(db);
    const boom = new Error("stripe boom");
    h.stripeError = boom;

    await expect(
      buyPublishedDesign({ imageId: publishedId, ...OPTS })
    ).rejects.toBe(boom);

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(1);
    expect(orders[0].abandonedAt).not.toBeNull();
    expect(orders[0].stripeSessionId).toBeNull();
    expect(orders[0].storeProductId).not.toBeNull();
    expect(await db.select().from(schema.orderItem)).toHaveLength(1);
  });

  it("a retry once Stripe recovers makes a second, live order", async () => {
    const db = h.db as Db;
    const { publishedId } = await seed(db);
    h.stripeError = new Error("stripe boom");
    await expect(
      buyPublishedDesign({ imageId: publishedId, ...OPTS })
    ).rejects.toThrow("stripe boom");

    h.stripeError = null;
    const result = await buyPublishedDesign({ imageId: publishedId, ...OPTS });
    expect(result.url).toBe("https://checkout.stripe.example/cs_test_retry");

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(2);
    expect(orders.filter((o) => o.abandonedAt !== null)).toHaveLength(1);
    const live = orders.filter((o) => o.abandonedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].stripeSessionId).toBe("cs_test_retry");
  });
});
