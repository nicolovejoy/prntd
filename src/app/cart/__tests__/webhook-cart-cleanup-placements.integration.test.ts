/**
 * #289 item 3 through the real actions and the real webhook handler: a paid
 * order clears the cart lines it bought, matched on the order line's front and
 * back images, and nothing else. Lines are created by `addToCart`, orders by
 * `buyPublishedDesign` or `checkoutCart`, payment by
 * `handleStripeCheckoutCompleted`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

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
        create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
          h.sessionParams.push(params);
          return {
            id: `cs_test_cleanup_${h.sessionParams.length}`,
            url: "https://checkout.stripe.example/cleanup",
          };
        }),
      },
    },
  },
}));

import { addToCart, checkoutCart } from "@/app/cart/actions";
import { buyPublishedDesign } from "@/app/d/actions";
import {
  handleStripeCheckoutCompleted,
  type WebhookDeps,
  type StripeSessionData,
} from "@/lib/webhook-handlers";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };
const OPTS_L = { ...OPTS, size: "L" };

/** Pays an order through the real handler, building the session from its row. */
async function payOrder(db: Db, orderId: string) {
  const order = await db.query.order.findFirst({ where: eq(schema.order.id, orderId) });
  const total = Math.round(order!.totalPrice * 100);
  const shipping = Math.round((order!.shippingPrice ?? 0) * 100);
  const session: StripeSessionData = {
    id: `cs_paid_${orderId}`,
    metadata: { orderId, designId: order!.designId },
    paymentStatus: "paid",
    paymentIntentId: "pi_cleanup",
    amountTotal: total,
    amountSubtotal: total - shipping,
    amountShipping: shipping,
    discount: null,
    shipping: {
      name: "Jane Doe", address1: "1 Main St", address2: "",
      city: "Town", state: "CA", zip: "90001", country: "US",
    },
  };
  const deps = {
    db,
    createPrintfulOrder: vi.fn().mockResolvedValue({ id: 5001, costs: { total: "12.00" } }),
    generateOrderName: vi.fn().mockResolvedValue("Cleanup"),
    resolveDesignImageUrl: vi.fn().mockResolvedValue("https://img.example/x.png"),
    resolveImageUrlById: async (id: string) => `https://img.example/${id}.png`,
  } as unknown as WebhookDeps;
  const result = await handleStripeCheckoutCompleted(session, deps);
  expect(result.action).toBe("submitted");
}

/** Pays the order the last Stripe session was created for. */
async function payLastOrder(db: Db) {
  const params = h.sessionParams[h.sessionParams.length - 1];
  await payOrder(db, String(params.metadata!.orderId));
}

async function cartPlacements(db: Db) {
  return (await db.select().from(schema.cartItem)).map((r) => r.placements);
}

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  await makeUser(db, "other");
  const conversation = await makeDesign(db, "seller");
  const image = async (name: string) =>
    makeSourceImage(db, {
      designId: conversation.id,
      ownerId: "seller",
      imageUrl: `https://img.example/${name}.png`,
      publishedAt: new Date(),
    });
  const A = await image("A");
  const B = await image("B");
  const C = await image("C");
  return { designId: conversation.id, A, B, C };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", email: "buyer@example.com", isAnonymous: false } };
  h.sessionParams = [];
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("STRIPE_SECRET_KEY", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("the webhook's cart cleanup matches placements (#289 item 3)", () => {
  it("paying for one image keeps the cart line for a sibling image from the same conversation", async () => {
    const db = h.db as Db;
    const { A, B } = await seed(db);
    await addToCart({ frontImageId: A, ...OPTS });
    await addToCart({ frontImageId: B, ...OPTS });

    await buyPublishedDesign({ imageId: A, ...OPTS });
    await payLastOrder(db);

    expect(await cartPlacements(db)).toEqual([{ front: B }]);
  });

  it("the exact-match line is removed, and a line differing only in size survives", async () => {
    const db = h.db as Db;
    const { A } = await seed(db);
    await addToCart({ frontImageId: A, ...OPTS });
    await addToCart({ frontImageId: A, ...OPTS_L });

    await buyPublishedDesign({ imageId: A, ...OPTS });
    await payLastOrder(db);

    const remaining = await db.select().from(schema.cartItem);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].size).toBe("L");
  });

  it("a line with a back: only the line with the same back is removed", async () => {
    const db = h.db as Db;
    const { A, B, C } = await seed(db);
    await addToCart({ frontImageId: A, back: C, ...OPTS });
    await addToCart({ frontImageId: A, ...OPTS });
    await addToCart({ frontImageId: A, back: B, ...OPTS });

    await buyPublishedDesign({ imageId: A, backImageId: C, ...OPTS });
    await payLastOrder(db);
    expect(await cartPlacements(db)).toEqual(
      expect.arrayContaining([{ front: A }, { front: A, back: B }])
    );
    expect(await cartPlacements(db)).toHaveLength(2);

    await buyPublishedDesign({ imageId: A, ...OPTS });
    await payLastOrder(db);
    expect(await cartPlacements(db)).toEqual([{ front: A, back: B }]);
  });

  it("a swapped purchase clears its own line, not the line for the page image", async () => {
    const db = h.db as Db;
    const { A, B } = await seed(db);
    await addToCart({ frontImageId: A, ...OPTS });
    await addToCart({ frontImageId: A, front: B, back: A, ...OPTS });

    await buyPublishedDesign({ imageId: A, frontImageId: B, backImageId: A, ...OPTS });
    await payLastOrder(db);

    expect(await cartPlacements(db)).toEqual([{ front: A }]);
  });

  it("a cart purchase clears exactly its own lines, with and without a back", async () => {
    const db = h.db as Db;
    const { A, B, C } = await seed(db);
    await addToCart({ frontImageId: A, ...OPTS_L });
    await addToCart({ frontImageId: B, back: C, ...OPTS_L });
    await addToCart({ frontImageId: A, back: B, ...OPTS_L });

    await checkoutCart();
    // Added after checkout, same design, garment, size and colour as the
    // purchased { front: B, back: C } line, but no back: it was not paid for.
    await addToCart({ frontImageId: B, ...OPTS_L });
    await payLastOrder(db);

    expect(await cartPlacements(db)).toEqual([{ front: B }]);
  });

  it("a line in another buyer's cart is untouched", async () => {
    const db = h.db as Db;
    const { designId, A } = await seed(db);
    await addToCart({ frontImageId: A, ...OPTS });
    await db.insert(schema.cartItem).values({
      userId: "other",
      designId,
      ...OPTS,
      placements: { front: A },
    });

    await buyPublishedDesign({ imageId: A, ...OPTS });
    await payLastOrder(db);

    const remaining = await db.select().from(schema.cartItem);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe("other");
  });
});

describe("null placements (a line from before the front was pinned)", () => {
  async function seedOrder(db: Db, placements: Record<string, string> | null) {
    const { designId } = await seed(db);
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: "buyer",
        designId,
        itemPrice: 19.43,
        shippingPrice: 4.69,
        totalPrice: 24.12,
        status: "pending",
      })
      .returning();
    await db.insert(schema.orderItem).values({
      orderId: order.id,
      designId,
      ...OPTS,
      placements,
      quantity: 1,
      itemPrice: 19.43,
    });
    return { designId, orderId: order.id };
  }

  it("an order line with null placements clears a null cart line and keeps a pinned one", async () => {
    const db = h.db as Db;
    const { designId, orderId } = await seedOrder(db, null);
    await db.insert(schema.cartItem).values([
      { userId: "buyer", designId, ...OPTS, placements: null },
      { userId: "buyer", designId, ...OPTS, placements: { front: "img-1" } },
    ]);

    await payOrder(db, orderId);

    expect(await cartPlacements(db)).toEqual([{ front: "img-1" }]);
  });

  it("a pinned order line keeps a cart line with null placements", async () => {
    const db = h.db as Db;
    const { designId, orderId } = await seedOrder(db, { front: "img-1" });
    await db.insert(schema.cartItem).values([
      { userId: "buyer", designId, ...OPTS, placements: null },
      { userId: "buyer", designId, ...OPTS, placements: { front: "img-1" } },
    ]);

    await payOrder(db, orderId);

    expect(await cartPlacements(db)).toEqual([null]);
  });
});
