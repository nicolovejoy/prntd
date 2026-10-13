/**
 * loadEmbeddedCheckout (#135 slice 2) against a real in-memory libSQL (the
 * #28 pattern). Pins the cheapest-first check order: DB ownership/status
 * before any Stripe call, then embeddedCheckoutConfig() before ever
 * retrieving the session, then the session's own status, then (on an open
 * session) the hidden-artwork check (#310 item 7), then ui_mode/secret.
 *
 * The db singleton and Stripe client are mocked; the database is real (FKs
 * enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "./factories";
import { STRIPE_SESSION_READ_TIMEOUT_MS } from "@/lib/checkout-session-status";
import { computePrice } from "@/lib/pricing";
import { getBlank, getColorHex } from "@/lib/blanks";

const h = vi.hoisted(() => ({
  db: null as unknown,
  retrieve: vi.fn(),
  expire: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => h.retrieve(...args),
        expire: (...args: unknown[]) => h.expire(...args),
      },
    },
  },
}));

import { loadEmbeddedCheckout } from "@/lib/embedded-checkout-session";
import { mockupCacheKey } from "@/lib/mockup-cache";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seedOrder(
  db: Db,
  opts: {
    userId: string;
    stripeSessionId: string;
    status?: "pending" | "paid" | "submitted" | "shipped" | "delivered" | "canceled";
    abandonedAt?: Date | null;
  }
) {
  await makeUser(db, opts.userId);
  const design = await makeDesign(db, opts.userId);
  const imageId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: opts.userId,
    imageUrl: "https://img.example/front.png",
  });
  const [order] = await db
    .insert(schema.order)
    .values({
      userId: opts.userId,
      designId: design.id,
      stripeSessionId: opts.stripeSessionId,
      status: opts.status ?? "pending",
      abandonedAt: opts.abandonedAt ?? null,
      totalPrice: 24.12,
    })
    .returning();
  await db.insert(schema.orderItem).values({
    orderId: order.id,
    designId: design.id,
    productId: "bella-canvas-3001",
    size: "M",
    color: "Black",
    placements: { front: imageId },
    quantity: 1,
    itemPrice: 19.43,
  });
  return { orderId: order.id, designId: design.id, imageId };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.retrieve.mockReset();
  h.expire.mockReset();
  h.expire.mockImplementation(async (id: string) => ({ id, status: "expired" }));
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/**
 * An order shaped like one created from /preview: the line's front is pinned
 * to `frontOf`'s image (the design's primary, or a non-primary image).
 */
async function seedPreviewOrder(
  db: Db,
  opts: {
    userId: string;
    stripeSessionId: string;
    front: "primary" | "other";
    mockupUrls: (ids: { primaryId: string; otherId: string }) => Record<string, string>;
  }
) {
  await makeUser(db, opts.userId);
  const design = await makeDesign(db, opts.userId);
  const primaryId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: opts.userId,
    imageUrl: "https://img.example/primary.png",
  });
  const otherId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: opts.userId,
    imageUrl: "https://img.example/other.png",
  });
  await db
    .update(schema.design)
    .set({
      primaryImageId: primaryId,
      mockupUrls: opts.mockupUrls({ primaryId, otherId }),
    })
    .where(eq(schema.design.id, design.id));
  const [order] = await db
    .insert(schema.order)
    .values({
      userId: opts.userId,
      designId: design.id,
      stripeSessionId: opts.stripeSessionId,
      status: "pending",
      totalPrice: 24.12,
    })
    .returning();
  await db.insert(schema.orderItem).values({
    orderId: order.id,
    designId: design.id,
    productId: "bella-canvas-3001",
    size: "M",
    color: "Black",
    placements: { front: opts.front === "primary" ? primaryId : otherId },
    quantity: 1,
    itemPrice: 19.43,
  });
}

const OPEN_EMBEDDED = {
  status: "open",
  ui_mode: "embedded",
  client_secret: "cs_secret_preview",
  url: null,
};

const SOURCE_LESS_KEY = mockupCacheKey({
  productId: "bella-canvas-3001",
  placementId: "front",
  colorName: "Black",
  scaleKey: 100,
});

describe("loadEmbeddedCheckout for /preview orders (#135 slice 3)", () => {
  beforeEach(() => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
    vi.stubEnv("PREVIEW_EMBEDDED_CHECKOUT_ENABLED", "true");
  });

  it("only the preview flag on + valid keys: the loader proceeds to ready", async () => {
    const db = h.db as Db;
    await seedPreviewOrder(db, {
      userId: "buyer",
      stripeSessionId: "cs_test_p1",
      front: "primary",
      mockupUrls: () => ({}),
    });
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_p1",
      viewerId: "buyer",
    });

    expect(result.kind).toBe("ready");
  });

  it("only the preview flag on + missing key: unavailable, no Stripe call", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
    const db = h.db as Db;
    await seedPreviewOrder(db, {
      userId: "buyer",
      stripeSessionId: "cs_test_p1b",
      front: "primary",
      mockupUrls: () => ({}),
    });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_p1b",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "unavailable" });
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it("front is the design's primary image: the source-less /preview mockup is used", async () => {
    const db = h.db as Db;
    await seedPreviewOrder(db, {
      userId: "buyer",
      stripeSessionId: "cs_test_p2",
      front: "primary",
      mockupUrls: () => ({ [SOURCE_LESS_KEY]: "https://r2.example/default-front.jpg" }),
    });
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_p2",
      viewerId: "buyer",
    });

    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.summary[0].mockupUrl).toBe("https://r2.example/default-front.jpg");
  });

  it("pinned non-primary front with only the source-less entry: null, never the primary's mockup", async () => {
    const db = h.db as Db;
    await seedPreviewOrder(db, {
      userId: "buyer",
      stripeSessionId: "cs_test_p3",
      front: "other",
      mockupUrls: () => ({ [SOURCE_LESS_KEY]: "https://r2.example/default-front.jpg" }),
    });
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_p3",
      viewerId: "buyer",
    });

    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.summary[0].mockupUrl).toBeNull();
  });

  it("the source-keyed entry wins when both exist", async () => {
    const db = h.db as Db;
    await seedPreviewOrder(db, {
      userId: "buyer",
      stripeSessionId: "cs_test_p4",
      front: "primary",
      mockupUrls: ({ primaryId }) => ({
        [SOURCE_LESS_KEY]: "https://r2.example/default-front.jpg",
        [mockupCacheKey({
          productId: "bella-canvas-3001",
          placementId: "front",
          sourceImageId: primaryId,
          colorName: "Black",
          scaleKey: 100,
        })]: "https://r2.example/source-keyed.jpg",
      }),
    });
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_p4",
      viewerId: "buyer",
    });

    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.summary[0].mockupUrl).toBe("https://r2.example/source-keyed.jpg");
  });

  it("a non-owner viewer of a /preview-created order gets not-found, no Stripe call", async () => {
    const db = h.db as Db;
    await seedPreviewOrder(db, {
      userId: "buyer",
      stripeSessionId: "cs_test_p5",
      front: "primary",
      mockupUrls: () => ({}),
    });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_p5",
      viewerId: "someone-else",
    });

    expect(result).toEqual({ kind: "not-found" });
    expect(h.retrieve).not.toHaveBeenCalled();
  });
});

describe("loadEmbeddedCheckout (#135 slice 2)", () => {
  it("no order for the session: not-found, no Stripe call", async () => {
    const db = h.db as Db;
    await makeUser(db, "buyer");

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_missing",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "not-found" });
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it("another user's order: not-found, no Stripe call", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "seller", stripeSessionId: "cs_test_1" });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_1",
      viewerId: "buyer-not-the-owner",
    });

    expect(result).toEqual({ kind: "not-found" });
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it("a paid order: complete, no Stripe call", async () => {
    const db = h.db as Db;
    await seedOrder(db, {
      userId: "buyer",
      stripeSessionId: "cs_test_2",
      status: "paid",
    });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_2",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "complete" });
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it("abandonedAt set: expired, no Stripe call", async () => {
    const db = h.db as Db;
    await seedOrder(db, {
      userId: "buyer",
      stripeSessionId: "cs_test_3",
      abandonedAt: new Date(),
    });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_3",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "expired" });
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it("missing publishable key: unavailable, no Stripe call", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_4" });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_4",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "unavailable" });
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it("Stripe retrieve throws: unavailable", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_5" });
    h.retrieve.mockRejectedValue(new Error("stripe down"));

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_5",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("Stripe retrieve never settles: unavailable after the timeout, logged", async () => {
    vi.useFakeTimers();
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_5b" });
    h.retrieve.mockReturnValue(new Promise(() => {}));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultPromise = loadEmbeddedCheckout({
      sessionId: "cs_test_5b",
      viewerId: "buyer",
    });
    await vi.advanceTimersByTimeAsync(STRIPE_SESSION_READ_TIMEOUT_MS);
    const result = await resultPromise;

    expect(result).toEqual({ kind: "unavailable" });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain("loadEmbeddedCheckout");
  });

  it("Stripe retrieve throws a Stripe error: unavailable, logged without its raw payload", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_5c" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stripeErr = new Stripe.errors.StripeAuthenticationError({
      type: "StripeAuthenticationError",
      code: "api_key_expired",
      statusCode: 401,
      message: "expired",
      client_secret: "cs_secret_PLANTED",
    } as any);
    h.retrieve.mockRejectedValue(stripeErr);

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_5c",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "unavailable" });
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = errSpy.mock.calls[0][0] as string;
    expect(logged).toContain("StripeAuthenticationError");
    expect(logged).toContain("api_key_expired");
    expect(logged).not.toContain("PLANTED");
  });

  it("open + embedded + secret: ready, with the cached mockup URL in the summary", async () => {
    const db = h.db as Db;
    const seeded = await seedOrder(db, {
      userId: "buyer",
      stripeSessionId: "cs_test_6",
    });
    const cacheKey = mockupCacheKey({
      productId: "bella-canvas-3001",
      placementId: "front",
      sourceImageId: seeded.imageId,
      colorName: "Black",
      scaleKey: 100,
    });
    await db
      .update(schema.design)
      .set({ mockupUrls: { [cacheKey]: "https://r2.example/mockup.jpg" } })
      .where(eq(schema.design.id, seeded.designId));
    h.retrieve.mockResolvedValue({
      status: "open",
      ui_mode: "embedded",
      client_secret: "cs_secret_abc",
      url: null,
    });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_6",
      viewerId: "buyer",
    });

    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.clientSecret).toBe("cs_secret_abc");
    expect(result.publishableKey).toBe("pk_test_abc123");
    expect(result.summary).toEqual([
      {
        productName: "Classic Tee",
        color: "Black",
        size: "M",
        quantity: 1,
        frontImageUrl: "https://img.example/front.png",
        backImageUrl: null,
        colorHex: "#0c0c0c",
        mockupUrl: "https://r2.example/mockup.jpg",
      },
    ]);
  });

  it("open + embedded + secret, no cached mockup: summary mockupUrl is null", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_7" });
    h.retrieve.mockResolvedValue({
      status: "open",
      ui_mode: "embedded",
      client_secret: "cs_secret_xyz",
      url: null,
    });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_7",
      viewerId: "buyer",
    });

    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.summary[0].mockupUrl).toBeNull();
  });

  it("open + non-embedded ui_mode with a url: hosted", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_8" });
    h.retrieve.mockResolvedValue({
      status: "open",
      ui_mode: "hosted",
      url: "https://checkout.stripe.com/pay/cs_test_8",
    });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_8",
      viewerId: "buyer",
    });

    expect(result).toEqual({
      kind: "hosted",
      url: "https://checkout.stripe.com/pay/cs_test_8",
    });
  });

  it("Stripe says complete: complete", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_9" });
    h.retrieve.mockResolvedValue({ status: "complete" });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_9",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "complete" });
  });

  it("Stripe says complete but unpaid (delayed method): complete, so /checkout hands off to /order/confirm", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_9u" });
    h.retrieve.mockResolvedValue({ status: "complete", payment_status: "unpaid" });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_9u",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "complete" });
  });

  it("Stripe says expired: expired", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_10" });
    h.retrieve.mockResolvedValue({ status: "expired" });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_10",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "expired" });
  });

  it("open + embedded with no client_secret: unavailable", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_11" });
    h.retrieve.mockResolvedValue({
      status: "open",
      ui_mode: "embedded",
      client_secret: null,
      url: null,
    });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_11",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "unavailable" });
  });
});

const CART_PRODUCT = "bella-canvas-3001";

/**
 * An order shaped like the ones checkoutCart writes: one header and several
 * order_item rows from one INSERT, with lines from more than one design.
 * Prices come from computePrice so no amount is written here.
 */
async function seedCartOrder(db: Db, stripeSessionId: string) {
  await makeUser(db, "buyer");
  await makeUser(db, "seller");
  const mine = await makeDesign(db, "buyer");
  const firstId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine-first.png",
  });
  const secondId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine-second.png",
  });
  const sold = await makeDesign(db, "seller");
  const listingId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/listing.png",
    publishedAt: new Date(),
  });
  // The buyer's design caches two Black front mockups: one keyed by the first
  // image, and the old source-less one that stands for the design's primary
  // (the first image). Neither belongs to the second image.
  await db
    .update(schema.design)
    .set({
      primaryImageId: firstId,
      mockupUrls: {
        [mockupCacheKey({
          productId: CART_PRODUCT,
          placementId: "front",
          sourceImageId: firstId,
          colorName: "Black",
          scaleKey: 100,
        })]: "https://r2.example/mine-first-black.jpg",
        [mockupCacheKey({
          productId: CART_PRODUCT,
          placementId: "front",
          colorName: "Black",
          scaleKey: 100,
        })]: "https://r2.example/mine-default-black.jpg",
      },
    })
    .where(eq(schema.design.id, mine.id));

  const unit = (size: string, back = false) =>
    computePrice(0, CART_PRODUCT, size, { back }).total;
  const [order] = await db
    .insert(schema.order)
    .values({
      userId: "buyer",
      designId: mine.id,
      stripeSessionId,
      status: "pending",
      totalPrice: unit("M") + 2 * unit("L", true) + unit("S"),
    })
    .returning();
  await db.insert(schema.orderItem).values([
    {
      orderId: order.id,
      designId: mine.id,
      productId: CART_PRODUCT,
      size: "M",
      color: "Black",
      placements: { front: firstId },
      quantity: 1,
      itemPrice: unit("M"),
    },
    {
      orderId: order.id,
      designId: sold.id,
      productId: CART_PRODUCT,
      size: "L",
      color: "White",
      placements: { front: listingId, back: firstId },
      quantity: 2,
      itemPrice: unit("L", true),
    },
    {
      orderId: order.id,
      designId: mine.id,
      productId: CART_PRODUCT,
      size: "S",
      color: "Black",
      placements: { front: secondId },
      quantity: 1,
      itemPrice: unit("S"),
    },
  ]);
}

describe("loadEmbeddedCheckout for a cart order (#278 slice 6b)", () => {
  it("returns one summary entry per order line, each with its own artwork, colour, size, quantity and mockup", async () => {
    const db = h.db as Db;
    await seedCartOrder(db, "cs_test_cart1");
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_cart1",
      viewerId: "buyer",
    });

    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    const productName = getBlank(CART_PRODUCT)?.name ?? null;
    // The lines of one cart order tie on created_at. This is the order SQLite
    // returns for such ties: insert order, which is cart order. The loader has
    // no tiebreaker, and /order/confirm and /orders rely on the same thing.
    expect(result.summary).toEqual([
      {
        productName,
        color: "Black",
        size: "M",
        quantity: 1,
        frontImageUrl: "https://img.example/mine-first.png",
        backImageUrl: null,
        colorHex: getColorHex(CART_PRODUCT, "Black"),
        mockupUrl: "https://r2.example/mine-first-black.jpg",
      },
      {
        productName,
        color: "White",
        size: "L",
        quantity: 2,
        frontImageUrl: "https://img.example/listing.png",
        backImageUrl: "https://img.example/mine-first.png",
        colorHex: getColorHex(CART_PRODUCT, "White"),
        mockupUrl: null,
      },
      {
        productName,
        color: "Black",
        size: "S",
        quantity: 1,
        frontImageUrl: "https://img.example/mine-second.png",
        backImageUrl: null,
        colorHex: getColorHex(CART_PRODUCT, "Black"),
        // Same design and colour as line 1, a different front: neither of the
        // design's cached mockups is this line's artwork.
        mockupUrl: null,
      },
    ]);
    expect(h.retrieve).toHaveBeenCalledTimes(1);
  });

  it("the summary carries no price field for any line", async () => {
    const db = h.db as Db;
    await seedCartOrder(db, "cs_test_cart2");
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_cart2",
      viewerId: "buyer",
    });

    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.summary).toHaveLength(3);
    for (const line of result.summary) {
      expect(
        Object.keys(line).filter((key) => /price|total|amount|cost/i.test(key))
      ).toEqual([]);
    }
  });

  it("another account opening a cart session gets not-found and Stripe is not called", async () => {
    const db = h.db as Db;
    await seedCartOrder(db, "cs_test_cart3");

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_cart3",
      viewerId: "seller",
    });

    expect(result).toEqual({ kind: "not-found" });
    expect(h.retrieve).not.toHaveBeenCalled();
  });
});

describe("loadEmbeddedCheckout and admin-hidden artwork (#310 item 7)", () => {
  const SID = "cs_test_hidden";

  async function image(db: Db, designId: string, published: boolean, hidden = false) {
    return makeSourceImage(db, {
      designId,
      ownerId: "buyer",
      imageUrl: `https://img.example/${crypto.randomUUID()}.png`,
      publishedAt: published || hidden ? new Date() : null,
      isHidden: hidden,
    });
  }

  async function setHidden(db: Db, imageId: string, hidden: boolean) {
    await db
      .update(schema.imagePublication)
      .set({ isHidden: hidden })
      .where(eq(schema.imagePublication.imageId, imageId));
  }

  /** A pending order with one line per entry of `lines`, each with its pins. */
  async function seed(
    db: Db,
    lines: Array<(designId: string) => Promise<Record<string, string>>>,
    status: "pending" | "paid" = "pending"
  ) {
    await makeUser(db, "buyer");
    const design = await makeDesign(db, "buyer");
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: "buyer",
        designId: design.id,
        stripeSessionId: SID,
        status,
        totalPrice: 24.12,
      })
      .returning();
    for (const pins of lines) {
      await db.insert(schema.orderItem).values({
        orderId: order.id,
        designId: design.id,
        productId: "bella-canvas-3001",
        size: "M",
        color: "Black",
        placements: await pins(design.id),
        quantity: 1,
        itemPrice: 19.43,
      });
    }
    return design.id;
  }

  const run = () => loadEmbeddedCheckout({ sessionId: SID, viewerId: "buyer" });

  it("front hidden after the order exists: expired, after one Stripe read", async () => {
    const db = h.db as Db;
    let front = "";
    await seed(db, [async (d) => ({ front: (front = await image(db, d, true)) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    expect((await run()).kind).toBe("ready");

    await setHidden(db, front, true);
    h.retrieve.mockClear();
    expect(await run()).toEqual({ kind: "expired" });
    expect(h.retrieve).toHaveBeenCalledTimes(1);
  });

  it("back hidden, front not: expired", async () => {
    const db = h.db as Db;
    await seed(db, [
      async (d) => ({
        front: await image(db, d, true),
        back: await image(db, d, false, true),
      }),
    ]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    expect(await run()).toEqual({ kind: "expired" });
  });

  it("two lines, one hidden: expired", async () => {
    const db = h.db as Db;
    await seed(db, [
      async (d) => ({ front: await image(db, d, true) }),
      async (d) => ({ front: await image(db, d, false, true) }),
    ]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    expect(await run()).toEqual({ kind: "expired" });
  });

  it("front hidden and Stripe reports the session complete: complete", async () => {
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false, true) })]);
    h.retrieve.mockResolvedValue({ status: "complete", ui_mode: "embedded" });
    expect(await run()).toEqual({ kind: "complete" });
  });

  it("front hidden and the order is no longer pending: complete, no Stripe call", async () => {
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false, true) })], "paid");
    expect(await run()).toEqual({ kind: "complete" });
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it("front hidden and the open session is hosted: expired, not hosted", async () => {
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false, true) })]);
    h.retrieve.mockResolvedValue({
      status: "open",
      ui_mode: "hosted",
      url: "https://checkout.stripe.example/hosted",
      client_secret: null,
    });
    expect(await run()).toEqual({ kind: "expired" });
  });

  // The refusal expires the Stripe session, so an unhide afterwards cannot
  // revive it; this case is about the check itself, so the expiry fails here.
  it("hidden with the expiry failing, then unhidden: ready", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = h.db as Db;
    let front = "";
    await seed(db, [async (d) => ({ front: (front = await image(db, d, false, true)) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    h.expire.mockRejectedValue(new Error("expire unavailable"));
    expect(await run()).toEqual({ kind: "expired" });

    await setHidden(db, front, false);
    expect((await run()).kind).toBe("ready");
  });

  it("the owner unpublished the image (no publication row, not hidden): ready", async () => {
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    expect((await run()).kind).toBe("ready");
  });

  it("a front pin that is a render of a hidden image: expired", async () => {
    const db = h.db as Db;
    await seed(db, [
      async (d) => {
        const source = await image(db, d, false, true);
        const renderId = crypto.randomUUID();
        await db.insert(schema.placementRender).values({
          id: renderId,
          designId: d,
          sourceImageId: source,
          blankId: "bella-canvas-3001",
          placementId: "front",
          imageUrl: "https://img.example/render.png",
          aspectRatio: "1:1",
        });
        return { front: renderId };
      },
    ]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    expect(await run()).toEqual({ kind: "expired" });
  });

  it("hidden, open embedded session: expired, the Stripe session is expired and the order abandoned", async () => {
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false, true) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);

    expect(await run()).toEqual({ kind: "expired" });

    expect(h.expire).toHaveBeenCalledTimes(1);
    expect(h.expire).toHaveBeenCalledWith(SID);
    const order = await db.query.order.findFirst({
      where: eq(schema.order.stripeSessionId, SID),
    });
    expect(order?.abandonedAt).not.toBeNull();
    expect(order?.status).toBe("pending");
  });

  it("hidden, then unhidden after a successful expiry: still expired", async () => {
    const db = h.db as Db;
    let front = "";
    await seed(db, [async (d) => ({ front: (front = await image(db, d, false, true)) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    expect(await run()).toEqual({ kind: "expired" });

    await setHidden(db, front, false);
    expect(await run()).toEqual({ kind: "expired" });
  });

  it("the expiry is rejected: still expired, the order stays pending and not abandoned", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false, true) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    h.expire.mockRejectedValue(new Error("session is complete"));

    expect(await run()).toEqual({ kind: "expired" });

    const order = await db.query.order.findFirst({
      where: eq(schema.order.stripeSessionId, SID),
    });
    expect(order?.status).toBe("pending");
    expect(order?.abandonedAt).toBeNull();
  });

  it("the expiry never answers: still expired once the timeout passes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false, true) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    h.expire.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const pending = run();
    await vi.waitFor(() => expect(h.expire).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(STRIPE_SESSION_READ_TIMEOUT_MS + 1);

    expect(await pending).toEqual({ kind: "expired" });
    const order = await db.query.order.findFirst({
      where: eq(schema.order.stripeSessionId, SID),
    });
    expect(order?.abandonedAt).toBeNull();
  });

  it("hidden and Stripe says complete: complete, nothing expired", async () => {
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false, true) })]);
    h.retrieve.mockResolvedValue({ status: "complete", ui_mode: "embedded" });
    expect(await run()).toEqual({ kind: "complete" });
    expect(h.expire).not.toHaveBeenCalled();
  });

  it("hidden, open, hosted session: expired, and the session is expired", async () => {
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false, true) })]);
    h.retrieve.mockResolvedValue({
      status: "open",
      ui_mode: "hosted",
      url: "https://checkout.stripe.example/hosted",
      client_secret: null,
    });
    expect(await run()).toEqual({ kind: "expired" });
    expect(h.expire).toHaveBeenCalledWith(SID);
  });

  it("not hidden: ready, nothing expired", async () => {
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, true) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    expect((await run()).kind).toBe("ready");
    expect(h.expire).not.toHaveBeenCalled();
  });

  it("the hidden check throws: unavailable, nothing expired", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false, true) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    vi.spyOn(db, "select").mockImplementation((() => {
      throw new Error("injected read failure");
    }) as unknown as typeof db.select);

    expect(await run()).toEqual({ kind: "unavailable" });
    expect(h.expire).not.toHaveBeenCalled();
  });

  it("a second load after a successful expiry: expired without calling Stripe at all", async () => {
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, false, true) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    expect(await run()).toEqual({ kind: "expired" });
    h.retrieve.mockClear();
    h.expire.mockClear();

    expect(await run()).toEqual({ kind: "expired" });

    expect(h.retrieve).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
  });

  it("nothing hidden: ready with the line summary", async () => {
    const db = h.db as Db;
    await seed(db, [async (d) => ({ front: await image(db, d, true) })]);
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);
    const result = await run();
    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.clientSecret).toBe("cs_secret_preview");
    expect(result.summary).toHaveLength(1);
    expect(result.summary[0]).toMatchObject({
      color: "Black",
      size: "M",
      quantity: 1,
      backImageUrl: null,
    });
    expect(result.summary[0].frontImageUrl).toMatch(/^https:\/\/img\.example\//);
  });
});

describe("loadEmbeddedCheckout when the hidden-artwork check fails (#310 fix round)", () => {
  it("an open hosted session with a failing order_item read: unavailable, not a rejection", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_fail" });
    h.retrieve.mockResolvedValue({
      status: "open",
      ui_mode: "hosted",
      url: "https://checkout.stripe.example/hosted",
      client_secret: null,
    });
    const spy = vi.spyOn(db, "select").mockImplementation((() => {
      throw new Error("injected order_item read failure");
    }) as unknown as typeof db.select);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await loadEmbeddedCheckout({
        sessionId: "cs_test_fail",
        viewerId: "buyer",
      });
      expect(result).toEqual({ kind: "unavailable" });
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
