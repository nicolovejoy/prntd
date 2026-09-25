/**
 * buyPublishedDesign's embedded-checkout wiring (#135 slice 2) against a real
 * in-memory libSQL (the #28 pattern). Exercises the fail-closed gate from the
 * caller's side: flag off is byte-identical to hosted checkout, a valid key
 * pair produces an embedded session and the /checkout redirect, and each
 * disabled reason (missing/invalid/mismatched key) degrades to hosted with a
 * console.error naming why. Also pins invariant 2 (order rows exist before
 * the Stripe call) in both modes.
 *
 * The db singleton, auth session, and Stripe client are mocked; the database
 * is real (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { buildCheckoutSessionParams } from "@/lib/checkout";
import { resolveOrderVariant } from "@/lib/blanks";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  sessionParams: [] as Stripe.Checkout.SessionCreateParams[],
  rowsAtCreateTime: [] as { orders: unknown[]; items: unknown[] }[],
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
          // Snapshot the order + order_item rows at the moment Stripe is
          // called, proving they're written first in both modes.
          const db = h.db as Awaited<ReturnType<typeof createTestDb>>;
          h.rowsAtCreateTime.push({
            orders: await db.select().from(schema.order),
            items: await db.select().from(schema.orderItem),
          });
          return {
            id: `cs_test_${h.sessionParams.length}`,
            url: "https://checkout.stripe.example/cs_test_hosted",
          };
        }),
      },
    },
  },
}));

import { buyPublishedDesign } from "@/app/d/actions";
import { createCheckoutSession } from "@/app/order/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");

  const [sold] = await db
    .insert(schema.design)
    .values({ userId: "seller" })
    .returning();
  const listingId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/listing.png",
    publishedAt: new Date(),
  });

  return { soldDesignId: sold.id, listingId };
}

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

/**
 * The expected Stripe params for the hosted (non-embedded) path, computed
 * from the real builder against whatever the order row actually persisted —
 * this is what pins invariant 1 (flag off = today, byte for byte) rather
 * than a hand-picked subset of properties. `expires_at` is asserted
 * separately (via `expect.any(Number)`) since it's wall-clock-derived.
 */
async function expectedHostedParams(
  db: Db,
  imageUrl: string,
  cancelUrl: string
): Promise<Stripe.Checkout.SessionCreateParams> {
  const [order] = await db.select().from(schema.order);
  if (order.itemPrice == null || order.shippingPrice == null) {
    throw new Error("expected itemPrice/shippingPrice to be persisted");
  }
  const { product } = resolveOrderVariant({
    productId: OPTS.productId,
    size: OPTS.size,
    color: OPTS.color,
  });
  return buildCheckoutSessionParams({
    orderId: order.id,
    designId: order.designId,
    productName: product.name,
    color: OPTS.color,
    size: OPTS.size,
    itemPrice: order.itemPrice,
    shippingPrice: order.shippingPrice,
    imageUrl,
    cancelUrl,
    appUrl: "http://localhost:3000",
  });
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  h.sessionParams = [];
  h.rowsAtCreateTime = [];
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("STRIPE_SECRET_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buyPublishedDesign embedded-checkout gating (#135)", () => {
  it("flag off: hosted params (no ui_mode) and the hosted url", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await buyPublishedDesign({
      imageId: ids.listingId,
      ...OPTS,
    });

    expect(url).toBe("https://checkout.stripe.example/cs_test_hosted");
    const [params] = h.sessionParams;
    const expected = await expectedHostedParams(
      db,
      "https://img.example/listing.png",
      `http://localhost:3000/d/${ids.listingId}`
    );
    expect(params).toEqual({ ...expected, expires_at: expect.any(Number) });
  });

  it("flag on + valid pk_test_/sk_test_ pair: embedded params and the /checkout redirect", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await buyPublishedDesign({
      imageId: ids.listingId,
      ...OPTS,
    });

    const [params] = h.sessionParams;
    expect((params as { ui_mode?: string }).ui_mode).toBe("embedded");
    expect(params.return_url).toBe(
      "http://localhost:3000/order/confirm?session_id={CHECKOUT_SESSION_ID}"
    );
    expect(params).not.toHaveProperty("success_url");
    expect(params).not.toHaveProperty("cancel_url");
    expect(url).toBe(`/checkout?session=cs_test_1&from=%2Fd%2F${ids.listingId}`);
  });

  it("in both modes, the order + order_item rows exist before Stripe is called, and stripeSessionId is persisted after", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await buyPublishedDesign({ imageId: ids.listingId, ...OPTS });
    expect(h.rowsAtCreateTime[0].orders).toHaveLength(1);
    expect(h.rowsAtCreateTime[0].items).toHaveLength(1);
    const [hostedOrder] = await db.select().from(schema.order);
    expect(hostedOrder.stripeSessionId).toBe("cs_test_1");

    // Fresh db + fresh env for the embedded run.
    h.db = await createTestDb();
    h.sessionParams = [];
    h.rowsAtCreateTime = [];
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    const db2 = h.db as Db;
    const ids2 = await seed(db2);

    await buyPublishedDesign({ imageId: ids2.listingId, ...OPTS });
    expect(h.rowsAtCreateTime[0].orders).toHaveLength(1);
    expect(h.rowsAtCreateTime[0].items).toHaveLength(1);
    const [embeddedOrder] = await db2.select().from(schema.order);
    expect(embeddedOrder.stripeSessionId).toBe("cs_test_1");

    // Order/order_item columns are the same in both modes — only the Stripe
    // session shape and the returned url differ.
    const [hostedLine] = await db.select().from(schema.orderItem);
    const [embeddedLine] = await db2.select().from(schema.orderItem);
    expect(hostedOrder.itemPrice).toBe(embeddedOrder.itemPrice);
    expect(hostedOrder.totalPrice).toBe(embeddedOrder.totalPrice);
    expect(hostedLine.size).toBe(embeddedLine.size);
    expect(hostedLine.color).toBe(embeddedLine.color);
    expect(hostedLine.placements).toEqual({ front: ids.listingId });
    expect(embeddedLine.placements).toEqual({ front: ids2.listingId });
  });

  it("flag on + missing key: hosted params + url, console.error names missing-key", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await buyPublishedDesign({
      imageId: ids.listingId,
      ...OPTS,
    });

    expect(url).toBe("https://checkout.stripe.example/cs_test_hosted");
    const [params] = h.sessionParams;
    const expected = await expectedHostedParams(
      db,
      "https://img.example/listing.png",
      `http://localhost:3000/d/${ids.listingId}`
    );
    expect(params).toEqual({ ...expected, expires_at: expect.any(Number) });
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing-key")
    );
  });

  it("flag on + pk_live_ with sk_test_ (mode-mismatch): hosted params + url, console.error names mode-mismatch", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_abc123");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await buyPublishedDesign({
      imageId: ids.listingId,
      ...OPTS,
    });

    expect(url).toBe("https://checkout.stripe.example/cs_test_hosted");
    const [params] = h.sessionParams;
    const expected = await expectedHostedParams(
      db,
      "https://img.example/listing.png",
      `http://localhost:3000/d/${ids.listingId}`
    );
    expect(params).toEqual({ ...expected, expires_at: expect.any(Number) });
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("mode-mismatch")
    );
  });
});

describe("createCheckoutSession stays hosted regardless of the embedded flag (#135)", () => {
  it("flag on + a valid key pair still creates a hosted session", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    const db = h.db as Db;
    await makeUser(db, "nico");
    const design = await makeDesign(db, "nico");
    const primaryId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "nico",
      imageUrl: "https://img.example/primary.png",
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: primaryId })
      .where(eq(schema.design.id, design.id));
    h.session = { user: { id: "nico", isAnonymous: false } };

    const { url } = await createCheckoutSession({
      designId: design.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
    });

    expect(url).toBe("https://checkout.stripe.example/cs_test_hosted");
    const [params] = h.sessionParams;
    expect(params).not.toHaveProperty("ui_mode");
    expect(params.success_url).toContain("/order/confirm?session_id=");
  });
});
