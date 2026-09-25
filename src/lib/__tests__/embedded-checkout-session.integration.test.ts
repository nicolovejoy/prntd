/**
 * loadEmbeddedCheckout (#135 slice 2) against a real in-memory libSQL (the
 * #28 pattern). Pins the cheapest-first check order: DB ownership/status
 * before any Stripe call, then embeddedCheckoutConfig() before ever
 * retrieving the session, then the session's own status/ui_mode/secret.
 *
 * The db singleton and Stripe client are mocked; the database is real (FKs
 * enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "./factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
  retrieve: vi.fn(),
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
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("a paid order: paid, no Stripe call", async () => {
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

    expect(result).toEqual({ kind: "paid" });
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

  it("Stripe says complete: paid", async () => {
    const db = h.db as Db;
    await seedOrder(db, { userId: "buyer", stripeSessionId: "cs_test_9" });
    h.retrieve.mockResolvedValue({ status: "complete" });

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_9",
      viewerId: "buyer",
    });

    expect(result).toEqual({ kind: "paid" });
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
