/**
 * Money-path integration tests (#28). Unlike the mocked webhook-handlers
 * tests, these run order → Stripe webhook → ledger against a real (in-memory)
 * libSQL built from the live schema. Only external services (Printful, order
 * naming, image resolution) are mocked; the database is real, so column/SQL
 * drift and FK constraints are exercised for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { calculateStripeFee } from "@/lib/ledger";
import {
  handleStripeCheckoutCompleted,
  handlePrintfulEvent,
  type WebhookDeps,
  type StripeSessionData,
} from "@/lib/webhook-handlers";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(
  db: Db,
  orderOverrides: Partial<typeof schema.order.$inferInsert> = {}
) {
  const userId = "user-1";
  await db
    .insert(schema.user)
    .values({ id: userId, email: "buyer@example.com", name: "Buyer" });
  const [design] = await db
    .insert(schema.design)
    .values({ userId })
    .returning();
  const [order] = await db
    .insert(schema.order)
    .values({
      userId,
      designId: design.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      totalPrice: 24.12,
      itemPrice: 19.43,
      shippingPrice: 4.69,
      status: "pending",
      ...orderOverrides,
    })
    .returning();
  return { userId, design, order };
}

function makeDeps(db: Db, overrides: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    db,
    createPrintfulOrder: vi
      .fn()
      .mockResolvedValue({ id: 9999, costs: { total: "12.50" } }),
    generateOrderName: vi.fn().mockResolvedValue("Test Order Name"),
    resolveDesignImageUrl: vi
      .fn()
      .mockResolvedValue("https://img.example/x.png"),
    ...overrides,
  } as unknown as WebhookDeps;
}

function makeSession(
  orderId: string,
  designId: string,
  overrides: Partial<StripeSessionData> = {}
): StripeSessionData {
  return {
    id: "cs_test_123",
    metadata: { orderId, designId },
    paymentIntentId: "pi_123",
    amountTotal: 2412,
    amountSubtotal: 1943,
    amountShipping: 469,
    discount: null,
    shipping: {
      name: "Jane Doe",
      address1: "1 Main St",
      address2: "",
      city: "Town",
      state: "CA",
      zip: "90001",
      country: "US",
    },
    ...overrides,
  };
}

async function ledgerFor(db: Db, orderId: string) {
  return db.query.ledgerEntry.findMany({
    where: eq(schema.ledgerEntry.orderId, orderId),
  });
}

describe("money path — checkout.session.completed", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("pays, submits to Printful, and writes sale + fee + cogs to the ledger", async () => {
    const { order, design } = await seed(db);
    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id),
      makeDeps(db)
    );

    expect(result.action).toBe("submitted");

    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("submitted");
    expect(updated?.classification).toBe("customer");
    expect(updated?.itemPrice).toBe(19.43);
    expect(updated?.shippingPrice).toBe(4.69);
    expect(updated?.totalPrice).toBe(24.12);
    expect(updated?.printfulOrderId).toBe("9999");
    expect(updated?.printfulCost).toBe(12.5);
    expect(updated?.displayName).toBe("Test Order Name");
    expect(updated?.shippingCity).toBe("Town");

    const updatedDesign = await db.query.design.findFirst({
      where: eq(schema.design.id, design.id),
    });
    expect(updatedDesign?.status).toBe("ordered");

    const entries = await ledgerFor(db, order.id);
    const byType = Object.fromEntries(entries.map((e) => [e.type, e.amount]));
    expect(entries).toHaveLength(3);
    expect(byType.sale).toBe(24.12);
    expect(byType.stripe_fee).toBe(-calculateStripeFee(24.12));
    expect(byType.cogs).toBe(-12.5);
    // Net margin = sale - fee - cogs
    const net = entries.reduce((s, e) => s + e.amount, 0);
    expect(net).toBeCloseTo(24.12 - calculateStripeFee(24.12) - 12.5, 5);
  });

  it("Phase 1B invariant: a % promo discounts the item but shipping stays full", async () => {
    const { order, design } = await seed(db);
    // 50% off the $19.43 product only; shipping line is untouched.
    const session = makeSession(order.id, design.id, {
      amountTotal: 1441, // 9.72 discounted item + 4.69 shipping
      amountSubtotal: 1943, // pre-discount item line
      amountShipping: 469, // full shipping — immune to the promo
      discount: { code: "HALF", amount: 9.71 },
    });

    await handleStripeCheckoutCompleted(session, makeDeps(db));

    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.shippingPrice).toBe(4.69); // the margin-protection point
    expect(updated?.itemPrice).toBe(19.43);
    expect(updated?.totalPrice).toBe(14.41); // what was actually charged
    expect(updated?.discountCode).toBe("HALF");
    expect(updated?.discountAmount).toBe(9.71);

    // Ledger sale reflects the actual (discounted) amount, not the list price.
    const entries = await ledgerFor(db, order.id);
    const sale = entries.find((e) => e.type === "sale");
    expect(sale?.amount).toBe(14.41);
    expect(entries.find((e) => e.type === "stripe_fee")?.amount).toBe(
      -calculateStripeFee(14.41)
    );
  });

  it("is idempotent: redelivering the same session does not double-charge the ledger", async () => {
    const { order, design } = await seed(db);
    const deps = makeDeps(db);

    const first = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id),
      deps
    );
    expect(first.action).toBe("submitted");

    const second = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id),
      deps
    );
    expect(second.action).toBe("skipped");

    // Still exactly the original 3 entries — no duplicate sale/fee/cogs.
    const entries = await ledgerFor(db, order.id);
    expect(entries).toHaveLength(3);
  });

  it("Printful failure leaves the order paid with no COGS and design not ordered", async () => {
    const { order, design } = await seed(db);
    const deps = makeDeps(db, {
      createPrintfulOrder: vi.fn().mockRejectedValue(new Error("Printful 500")),
    });

    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id),
      deps
    );
    expect(result.action).toBe("paid_printful_failed");

    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("paid");
    expect(updated?.printfulOrderId).toBeNull();

    const updatedDesign = await db.query.design.findFirst({
      where: eq(schema.design.id, design.id),
    });
    expect(updatedDesign?.status).not.toBe("ordered");

    // Sale + fee recorded (money moved), but no COGS (nothing fulfilled).
    const entries = await ledgerFor(db, order.id);
    expect(entries.map((e) => e.type).sort()).toEqual(["sale", "stripe_fee"]);
  });
});

describe("money path — Printful lifecycle events", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("package_shipped sets status + tracking", async () => {
    const { order } = await seed(db, {
      status: "submitted",
      printfulOrderId: "9999",
    });

    const result = await handlePrintfulEvent(
      {
        type: "package_shipped",
        data: {
          order: { id: 9999 },
          shipment: {
            tracking_number: "1Z999",
            tracking_url: "https://track/1Z999",
          },
        },
      },
      { db }
    );

    expect(result.action).toBe("shipped");
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("shipped");
    expect(updated?.trackingNumber).toBe("1Z999");
    expect(updated?.trackingUrl).toBe("https://track/1Z999");
  });

  it("order_canceled records a refund reversal for the full total", async () => {
    const { order } = await seed(db, {
      status: "submitted",
      printfulOrderId: "9999",
    });

    const result = await handlePrintfulEvent(
      { type: "order_canceled", data: { order: { id: 9999 } } },
      { db }
    );

    expect(result.action).toBe("canceled");
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("canceled");
    expect(updated?.printfulCost).toBe(0);

    const entries = await ledgerFor(db, order.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("refund");
    expect(entries[0].amount).toBe(-24.12);
  });
});
