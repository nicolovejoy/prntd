/**
 * checkoutCart on Stripe Embedded Checkout (#278 slice 6b) against a real
 * in-memory libSQL. The cart rides the image detail page's switch
 * (EMBEDDED_CHECKOUT_ENABLED): off is the hosted session it has always built;
 * on with a usable key pair is an embedded session and a /checkout URL whose
 * Back is the cart; on with a bad key pair is hosted plus one console.error
 * naming the reason. Also pinned: the order and every line are written before
 * Stripe is called in both modes, the Origin rules for return_url, the
 * Stripe-failure path, and the known behaviour that each Checkout makes its
 * own order and session. One case carries the order checkoutCart wrote into
 * the real /checkout loader, so a change to the rows checkoutCart writes reaches
 * the loader's summary test.
 *
 * The db singleton, auth session, request headers, Printful quote and Stripe
 * client are mocked; the database is real (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import {
  makeUser,
  makeDesign,
  makeSourceImage,
  setPublication,
} from "@/lib/__tests__/factories";
import { buildCartCheckoutSessionParams } from "@/lib/checkout";
import { embeddedCheckoutPath } from "@/lib/embedded-checkout";
import { getBlank } from "@/lib/blanks";
import { CART_LINE_UNAVAILABLE } from "@/lib/action-copy";

type OrderRow = typeof schema.order.$inferSelect;
type OrderItemRow = typeof schema.orderItem.$inferSelect;

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  sessionParams: [] as Stripe.Checkout.SessionCreateParams[],
  /** The order and order_item rows as they were when Stripe was called. */
  rowsAtCreateTime: [] as { orders: OrderRow[]; items: OrderItemRow[] }[],
  /** Simulated `Origin` request header, read by resolveReturnOrigin. */
  originHeader: null as string | null,
  /** When set, reading `Origin` from the request headers throws. */
  originReadThrows: false,
  stripeError: null as Error | null,
  /** What the Stripe mock returns as `url` for a hosted session. */
  hostedUrl: "https://checkout.stripe.example/cs_test_hosted",
  /** `stripe.checkout.sessions.retrieve`, read by the /checkout loader. */
  retrieve: vi.fn(),
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
  headers: async () => {
    // headers() itself resolves (the session read uses it first); only the
    // read of the `Origin` entry throws, as a throw there would.
    if (h.originReadThrows) {
      return {
        get: () => {
          throw new Error("origin read failed");
        },
      };
    }
    return new Headers(h.originHeader ? { origin: h.originHeader } : {});
  },
}));

// The shipping quote falls back to the flat estimate.
vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => h.retrieve(...args),
        create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
          if (h.stripeError) throw h.stripeError;
          h.sessionParams.push(params);
          const db = h.db as Awaited<ReturnType<typeof createTestDb>>;
          h.rowsAtCreateTime.push({
            orders: await db.select().from(schema.order),
            items: await db.select().from(schema.orderItem),
          });
          const embedded =
            (params as { ui_mode?: string }).ui_mode === "embedded";
          return {
            id: `cs_test_${h.sessionParams.length}`,
            // Stripe returns no url for an embedded session.
            url: embedded ? null : h.hostedUrl,
          };
        }),
      },
    },
  },
}));

import {
  addToCart,
  setCartItemQuantity,
  checkoutCart,
} from "@/app/cart/actions";
import { stripe } from "@/lib/stripe";
import { loadEmbeddedCheckout } from "@/lib/embedded-checkout-session";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const PRODUCT = "bella-canvas-3001";
const APP_URL = "http://localhost:3000";
const PREVIEW_ORIGIN =
  "https://prntd-git-feature-x-nico-lovejoys-projects.vercel.app";
const HOSTED_URL = h.hostedUrl;
const LISTING_URL = "https://img.example/listing.png";
const MINE_URL = "https://img.example/mine.png";
const SECOND_URL = "https://img.example/mine-second.png";
const BUYER = { user: { id: "buyer", isAnonymous: false } };
const CONFIRM_PATH = "/order/confirm?session_id={CHECKOUT_SESSION_ID}";

/**
 * A two-line cart for "buyer". Line 1: a seller's published image with the
 * buyer's own image on the back. Line 2: the buyer's own unpublished image,
 * front only, quantity 2.
 */
async function seedCart(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  const sold = await makeDesign(db, "seller");
  const listingId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: LISTING_URL,
    publishedAt: new Date(),
  });
  const mine = await makeDesign(db, "buyer");
  const myImageId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: MINE_URL,
  });

  await addToCart({
    frontImageId: listingId,
    back: myImageId,
    productId: PRODUCT,
    size: "L",
    color: "Black",
  });
  await addToCart({
    frontImageId: myImageId,
    productId: PRODUCT,
    size: "M",
    color: "Black",
  });
  const rows = await db.select().from(schema.cartItem);
  const second = rows.find((r) => r.size === "M");
  if (!second) throw new Error("seed: the second cart line is missing");
  await setCartItemQuantity(second.id, 2);

  return {
    listingId,
    myImageId,
    urlByImage: new Map([
      [listingId, LISTING_URL],
      [myImageId, MINE_URL],
    ]),
  };
}

/**
 * The hosted params checkoutCart sends, rebuilt with the real builder from
 * the rows it wrote. This is what pins "switch off is today, key for key"
 * without a hand-picked subset of properties and without writing a price
 * here. `expires_at` is clock-derived and asserted with `expect.any(Number)`.
 */
async function expectedHostedParams(
  db: Db,
  urlByImage: Map<string, string>
): Promise<Stripe.Checkout.SessionCreateParams> {
  const [order] = await db.select().from(schema.order);
  if (order.shippingPrice == null) {
    throw new Error("expected shippingPrice to be persisted");
  }
  const items = (await db.select().from(schema.orderItem)).filter(
    (i) => i.orderId === order.id
  );
  return buildCartCheckoutSessionParams({
    orderId: order.id,
    designId: order.designId,
    lineItems: items.map((i) => {
      const blank = getBlank(i.productId);
      if (!blank) throw new Error(`unknown blank ${i.productId}`);
      const front = i.placements?.front;
      return {
        name: blank.name,
        description: `${i.color} / ${i.size}${i.placements?.back ? " · front + back" : ""}`,
        imageUrl: front ? urlByImage.get(front) ?? null : null,
        unitPrice: i.itemPrice,
        quantity: i.quantity,
      };
    }),
    shippingPrice: order.shippingPrice,
    cancelUrl: `${APP_URL}/cart`,
    appUrl: APP_URL,
  });
}

function embeddedOn() {
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
}

/** The lines console.error got that are about embedded checkout. */
function embeddedLogs(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.includes("embedded checkout"));
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = BUYER;
  h.sessionParams = [];
  h.rowsAtCreateTime = [];
  h.originHeader = null;
  h.originReadThrows = false;
  h.stripeError = null;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("STRIPE_SECRET_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("checkoutCart embedded-checkout gating (#278 slice 6b)", () => {
  it("switch off: the hosted session it has always built, the hosted url, nothing logged", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = h.db as Db;
    const ids = await seedCart(db);

    const result = await checkoutCart();

    expect(result).toEqual({ url: HOSTED_URL });
    const expected = await expectedHostedParams(db, ids.urlByImage);
    expect(h.sessionParams[0]).toEqual({
      ...expected,
      expires_at: expect.any(Number),
    });
    expect(embeddedLogs(errSpy)).toEqual([]);
  });

  it("switch on + valid key pair: an embedded session and the /checkout url whose Back is the cart", async () => {
    embeddedOn();
    const db = h.db as Db;
    const ids = await seedCart(db);

    const result = await checkoutCart();

    const hosted = await expectedHostedParams(db, ids.urlByImage);
    const [params] = h.sessionParams;
    expect(params).toEqual({
      ...hosted,
      expires_at: expect.any(Number),
      ui_mode: "embedded",
      return_url: `${APP_URL}${CONFIRM_PATH}`,
      success_url: undefined,
      cancel_url: undefined,
    });
    expect(params).not.toHaveProperty("success_url");
    expect(params).not.toHaveProperty("cancel_url");
    // One Stripe line per cart line, each with its own quantity.
    expect(params.line_items?.map((li) => li.quantity)).toEqual([1, 2]);
    expect(result).toEqual({ url: "/checkout?session=cs_test_1&from=%2Fcart" });
    expect(result.url).toBe(embeddedCheckoutPath("cs_test_1", "/cart"));
  });

  it.each([
    { reason: "missing-key", pk: undefined, sk: "sk_test_abc123" },
    { reason: "invalid-key", pk: "not-a-publishable-key", sk: "sk_test_abc123" },
    { reason: "mode-mismatch", pk: "pk_live_abc123", sk: "sk_test_abc123" },
  ])(
    "switch on + $reason: the hosted session and url, one log line naming the reason and no key",
    async ({ reason, pk, sk }) => {
      vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
      vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", pk);
      vi.stubEnv("STRIPE_SECRET_KEY", sk);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const db = h.db as Db;
      const ids = await seedCart(db);

      const result = await checkoutCart();

      expect(result).toEqual({ url: HOSTED_URL });
      const expected = await expectedHostedParams(db, ids.urlByImage);
      expect(h.sessionParams[0]).toEqual({
        ...expected,
        expires_at: expect.any(Number),
      });
      const logged = embeddedLogs(errSpy);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain(reason);
      expect(logged[0]).toContain("cart");
      if (pk) expect(logged[0]).not.toContain(pk);
      expect(logged[0]).not.toContain(sk);
    }
  );

  it.each(["hosted", "embedded"] as const)(
    "%s: the order and every line are written before Stripe is called, and the session id is saved after",
    async (mode) => {
      if (mode === "embedded") embeddedOn();
      const db = h.db as Db;
      const ids = await seedCart(db);

      await checkoutCart();

      const atCreate = h.rowsAtCreateTime[0];
      expect(atCreate.orders).toHaveLength(1);
      expect(atCreate.orders[0].status).toBe("pending");
      expect(atCreate.orders[0].stripeSessionId).toBeNull();
      expect(atCreate.items).toHaveLength(2);
      expect(atCreate.items.map((i) => i.quantity)).toEqual([1, 2]);
      expect(atCreate.items.map((i) => i.placements)).toEqual([
        { front: ids.listingId, back: ids.myImageId },
        { front: ids.myImageId },
      ]);

      const [order] = await db.select().from(schema.order);
      expect(order.stripeSessionId).toBe("cs_test_1");
      expect(order.abandonedAt).toBeNull();
      // The cart is cleared by the webhook on payment, not here.
      expect(await db.select().from(schema.cartItem)).toHaveLength(2);
    }
  );

  it("the rows are the same in both modes: only the Stripe session shape and the returned url differ", async () => {
    const hostedDb = h.db as Db;
    await seedCart(hostedDb);
    await checkoutCart();
    const [hostedOrder] = await hostedDb.select().from(schema.order);
    const hostedItems = await hostedDb.select().from(schema.orderItem);

    h.db = await createTestDb();
    h.sessionParams = [];
    embeddedOn();
    const embeddedDb = h.db as Db;
    await seedCart(embeddedDb);
    await checkoutCart();
    const [embeddedOrder] = await embeddedDb.select().from(schema.order);
    const embeddedItems = await embeddedDb.select().from(schema.orderItem);

    const header = (o: OrderRow) => ({
      status: o.status,
      itemPrice: o.itemPrice,
      shippingPrice: o.shippingPrice,
      totalPrice: o.totalPrice,
      hasComposition: o.storeProductId !== null,
    });
    const line = (i: OrderItemRow) => ({
      productId: i.productId,
      size: i.size,
      color: i.color,
      quantity: i.quantity,
      itemPrice: i.itemPrice,
      hasBack: Boolean(i.placements?.back),
    });
    expect(header(embeddedOrder)).toEqual(header(hostedOrder));
    expect(embeddedItems.map(line)).toEqual(hostedItems.map(line));
  });
});

describe("checkoutCart return_url origin (#278 slice 6b)", () => {
  it("switch on: return_url follows a trusted Preview Origin, so a Preview purchase returns to that Preview", async () => {
    embeddedOn();
    h.originHeader = PREVIEW_ORIGIN;
    const db = h.db as Db;
    await seedCart(db);

    const result = await checkoutCart();

    expect(h.sessionParams[0].return_url).toBe(
      `${PREVIEW_ORIGIN}${CONFIRM_PATH}`
    );
    // The page URL handed to the browser is relative, so it stays there too.
    expect(result.url).toBe("/checkout?session=cs_test_1&from=%2Fcart");
  });

  it.each([
    "https://evil.example",
    // A prntd-* host without the team suffix is not this project's.
    "https://prntd-git-x.vercel.app",
    "javascript:alert(1)",
  ])(
    "switch on: an untrusted Origin (%s) falls back to NEXT_PUBLIC_APP_URL",
    async (origin) => {
      embeddedOn();
      h.originHeader = origin;
      const db = h.db as Db;
      await seedCart(db);

      await checkoutCart();

      expect(h.sessionParams[0].return_url).toBe(`${APP_URL}${CONFIRM_PATH}`);
    }
  );

  it("switch off: the hosted urls use NEXT_PUBLIC_APP_URL whatever the Origin is", async () => {
    h.originHeader = PREVIEW_ORIGIN;
    const db = h.db as Db;
    await seedCart(db);

    await checkoutCart();

    const [params] = h.sessionParams;
    expect(params.success_url).toBe(`${APP_URL}${CONFIRM_PATH}`);
    expect(params.cancel_url).toBe(`${APP_URL}/cart`);
    expect(params).not.toHaveProperty("return_url");
  });
});

describe("checkoutCart refusals and failures with the switch on (#278 slice 6b)", () => {
  it("Stripe throws: the order is abandoned with its lines kept, the error is re-thrown, the cart is intact", async () => {
    embeddedOn();
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

  it("a retry once Stripe recovers returns a /checkout url for a new order", async () => {
    embeddedOn();
    const db = h.db as Db;
    await seedCart(db);
    h.stripeError = new Error("stripe boom");
    await expect(checkoutCart()).rejects.toThrow("stripe boom");

    h.stripeError = null;
    const result = await checkoutCart();

    expect(result.url).toBe("/checkout?session=cs_test_1&from=%2Fcart");
    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(2);
    const live = orders.filter((o) => o.abandonedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].stripeSessionId).toBe("cs_test_1");
  });

  it("reading the request's Origin throws: checkoutCart rejects before anything is written, and Stripe is not called", async () => {
    embeddedOn();
    const db = h.db as Db;
    await seedCart(db);
    // Armed after seeding, which reads headers() through addToCart too.
    h.originReadThrows = true;
    const create = vi.mocked(stripe.checkout.sessions.create);
    create.mockClear();

    // The config and the return origin are resolved before the order is
    // written, so a throw there leaves no order behind. Moving that block below
    // the db.batch would leave an order with no Stripe session.
    await expect(checkoutCart()).rejects.toThrow("origin read failed");

    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(await db.select().from(schema.orderItem)).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
    expect(h.sessionParams).toHaveLength(0);
  });

  it("an anonymous session: needsAuth, nothing written, Stripe not called", async () => {
    embeddedOn();
    const db = h.db as Db;
    await seedCart(db);
    h.session = { user: { id: "buyer", isAnonymous: true } };

    expect(await checkoutCart()).toEqual({ url: null, needsAuth: true });

    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.sessionParams).toHaveLength(0);
  });

  it("a line that became unavailable: the structured refusal, nothing written, Stripe not called", async () => {
    embeddedOn();
    const db = h.db as Db;
    const ids = await seedCart(db);
    // An admin hides the Shop image after it was added.
    await setPublication(db, ids.listingId, { isHidden: true });

    expect(await checkoutCart()).toEqual({
      url: null,
      error: CART_LINE_UNAVAILABLE,
    });

    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.sessionParams).toHaveLength(0);
    expect(await db.select().from(schema.cartItem)).toHaveLength(2);
  });

  it("an empty cart: { url: null }, nothing written, Stripe not called", async () => {
    embeddedOn();
    const db = h.db as Db;
    await makeUser(db, "buyer");

    expect(await checkoutCart()).toEqual({ url: null });

    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.sessionParams).toHaveLength(0);
  });
});

describe("each Checkout makes its own order and session (known behaviour, #278 slice 6b)", () => {
  it("switch on: a second Checkout leaves the first order pending with its own session", async () => {
    embeddedOn();
    const db = h.db as Db;
    await seedCart(db);

    const first = await checkoutCart();
    const second = await checkoutCart();

    expect(first.url).toBe(embeddedCheckoutPath("cs_test_1", "/cart"));
    expect(second.url).toBe(embeddedCheckoutPath("cs_test_2", "/cart"));
    const orders = await db.select().from(schema.order);
    expect(orders.map((o) => o.stripeSessionId).sort()).toEqual([
      "cs_test_1",
      "cs_test_2",
    ]);
    expect(
      orders.every((o) => o.status === "pending" && o.abandonedAt === null)
    ).toBe(true);
    expect(await db.select().from(schema.orderItem)).toHaveLength(4);
  });
});

describe("checkoutCart into the /checkout loader (#278 slice 6b)", () => {
  it("the order checkoutCart wrote reads back as one summary entry per cart line, in cart order, matching the Stripe line_items", async () => {
    embeddedOn();
    const db = h.db as Db;
    await makeUser(db, "seller");
    await makeUser(db, "buyer");
    const sold = await makeDesign(db, "seller");
    const listingId = await makeSourceImage(db, {
      designId: sold.id,
      ownerId: "seller",
      imageUrl: LISTING_URL,
      publishedAt: new Date(),
    });
    const mine = await makeDesign(db, "buyer");
    const firstId = await makeSourceImage(db, {
      designId: mine.id,
      ownerId: "buyer",
      imageUrl: MINE_URL,
    });
    const secondId = await makeSourceImage(db, {
      designId: mine.id,
      ownerId: "buyer",
      imageUrl: SECOND_URL,
    });
    const urlOf = new Map([
      [listingId, LISTING_URL],
      [firstId, MINE_URL],
      [secondId, SECOND_URL],
    ]);
    // Lines 1 and 2 share a product and colour with different fronts; line 1
    // has a back design; line 2 has a quantity above one.
    const seeded = [
      { frontId: listingId, backId: firstId, color: "Black", size: "L", quantity: 1 },
      { frontId: firstId, backId: null, color: "Black", size: "M", quantity: 2 },
      { frontId: secondId, backId: null, color: "White", size: "S", quantity: 1 },
    ];
    for (const line of seeded) {
      await addToCart({
        frontImageId: line.frontId,
        ...(line.backId ? { back: line.backId } : {}),
        productId: PRODUCT,
        size: line.size,
        color: line.color,
      });
    }
    const cartRows = await db.select().from(schema.cartItem);
    for (const line of seeded.filter((l) => l.quantity > 1)) {
      const row = cartRows.find(
        (r) => r.placements?.front === line.frontId && r.size === line.size
      );
      if (!row) throw new Error("seed: a cart line is missing");
      await setCartItemQuantity(row.id, line.quantity);
    }
    h.retrieve.mockResolvedValue({
      status: "open",
      ui_mode: "embedded",
      client_secret: "cs_secret_cart",
      url: null,
    });

    const checkout = await checkoutCart();

    expect(checkout.url).toBe("/checkout?session=cs_test_1&from=%2Fcart");
    const [order] = await db.select().from(schema.order);
    if (!order.stripeSessionId) throw new Error("checkoutCart saved no session id");
    const result = await loadEmbeddedCheckout({
      sessionId: order.stripeSessionId,
      viewerId: "buyer",
    });

    if (result.kind !== "ready") {
      throw new Error(`expected ready, got ${result.kind}`);
    }
    expect(h.retrieve).toHaveBeenCalledWith(order.stripeSessionId);
    const blankName = getBlank(PRODUCT)?.name ?? null;
    expect(
      result.summary.map((e) => ({
        productName: e.productName,
        frontImageUrl: e.frontImageUrl,
        backImageUrl: e.backImageUrl,
        color: e.color,
        size: e.size,
        quantity: e.quantity,
      }))
    ).toEqual(
      seeded.map((l) => ({
        productName: blankName,
        frontImageUrl: urlOf.get(l.frontId),
        backImageUrl: l.backId ? urlOf.get(l.backId) : null,
        color: l.color,
        size: l.size,
        quantity: l.quantity,
      }))
    );
    // The Stripe lines come in the same order: each carries its front artwork
    // and quantity.
    const lineItems = h.sessionParams[0].line_items ?? [];
    expect(
      lineItems.map((li) => ({
        front: li.price_data?.product_data?.images?.[0],
        quantity: li.quantity,
      }))
    ).toEqual(
      result.summary.map((e) => ({
        front: e.frontImageUrl,
        quantity: e.quantity,
      }))
    );
  });
});
