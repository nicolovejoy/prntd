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

  it("store order (Phase 3): attribution survives the money path; sale/fee/cogs written", async () => {
    const ownerId = "org-1";
    await db
      .insert(schema.user)
      .values({ id: ownerId, email: "org@example.com", name: "Org" });
    const [design] = await db
      .insert(schema.design)
      .values({ userId: ownerId })
      .returning();
    const [store] = await db
      .insert(schema.store)
      .values({ ownerId, slug: "club", name: "Club", status: "live" })
      .returning();
    const [product] = await db
      .insert(schema.product)
      .values({
        ownerId,
        storeId: store.id,
        designId: design.id,
        blankId: "bella-canvas-3001",
        price: 25,
        status: "listed",
      })
      .returning();
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: ownerId,
        designId: design.id,
        productId: "bella-canvas-3001",
        size: "M",
        color: "Black",
        totalPrice: 29.69,
        itemPrice: 25,
        shippingPrice: 4.69,
        status: "pending",
        storeId: store.id,
        storeProductId: product.id,
      })
      .returning();

    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id, {
        amountTotal: 2969,
        amountSubtotal: 2500,
        amountShipping: 469,
      }),
      makeDeps(db)
    );
    expect(result.action).toBe("submitted");

    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    // The attribution columns are untouched by the webhook — a payout phase can
    // sum proceeds per store/product from here.
    expect(updated?.storeId).toBe(store.id);
    expect(updated?.storeProductId).toBe(product.id);
    expect(updated?.status).toBe("submitted");

    const entries = await ledgerFor(db, order.id);
    const byType = Object.fromEntries(entries.map((e) => [e.type, e.amount]));
    expect(byType.sale).toBe(29.69);
    expect(byType.stripe_fee).toBe(-calculateStripeFee(29.69));
    expect(byType.cogs).toBe(-12.5);
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

  it("front+back order (#25): submits two print files and a sale at the +$8 total", async () => {
    // itemPrice already folds in the +$8 back upcharge (19.43 + 8.00); shipping
    // is charged once per order, not per placement.
    const { order, design } = await seed(db, {
      itemPrice: 27.43,
      shippingPrice: 4.69,
      totalPrice: 32.12,
      placements: { front: "img-front", back: "img-back" },
    });

    const createPrintfulOrder = vi
      .fn()
      .mockResolvedValue({ id: 9999, costs: { total: "18.45" } });
    const resolveImageUrlById = vi
      .fn()
      .mockImplementation(async (id: string) =>
        id === "img-front"
          ? "https://img.example/front.png"
          : "https://img.example/back.png"
      );

    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id, {
        amountSubtotal: 2743,
        amountShipping: 469,
        amountTotal: 3212,
      }),
      makeDeps(db, { createPrintfulOrder, resolveImageUrlById })
    );
    expect(result.action).toBe("submitted");

    // Printful received two files — front and back — keyed by placement.
    const files = createPrintfulOrder.mock.calls[0][0].items[0].files as {
      placement: string;
      url: string;
    }[];
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.placement).sort()).toEqual(["back", "front"]);
    expect(files.find((f) => f.placement === "back")?.url).toBe(
      "https://img.example/back.png"
    );

    // Sale reflects the back-inclusive total actually charged.
    const entries = await ledgerFor(db, order.id);
    expect(entries.find((e) => e.type === "sale")?.amount).toBe(32.12);

    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.itemPrice).toBe(27.43);
  });

  it("cart order (#26): submits N items, marks every design ordered, one shipping + one COGS", async () => {
    // Two-item cart: items priced individually, shipping charged once.
    const userId = "cart-user";
    await db
      .insert(schema.user)
      .values({ id: userId, email: "cart@example.com", name: "Cart Buyer" });
    const [d1] = await db.insert(schema.design).values({ userId }).returning();
    const [d2] = await db.insert(schema.design).values({ userId }).returning();
    const [order] = await db
      .insert(schema.order)
      .values({
        userId,
        designId: d1.id, // representative head design
        productId: "bella-canvas-3001",
        size: "M",
        color: "Black",
        itemPrice: 38.86,
        shippingPrice: 4.69,
        totalPrice: 43.55,
        status: "pending",
      })
      .returning();
    await db.insert(schema.orderItem).values([
      {
        orderId: order.id,
        designId: d1.id,
        productId: "bella-canvas-3001",
        size: "M",
        color: "Black",
        placements: { front: "img-1" },
        quantity: 1,
        itemPrice: 19.43,
      },
      {
        orderId: order.id,
        designId: d2.id,
        productId: "bella-canvas-3001",
        size: "L",
        color: "White",
        placements: { front: "img-2" },
        quantity: 1,
        itemPrice: 19.43,
      },
    ]);

    const createPrintfulOrder = vi
      .fn()
      .mockResolvedValue({ id: 8888, costs: { total: "25.00" } });
    const resolveImageUrlById = vi
      .fn()
      .mockImplementation(async (id: string) => `https://img.example/${id}.png`);

    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, d1.id, {
        amountSubtotal: 3886,
        amountShipping: 469,
        amountTotal: 4355,
      }),
      makeDeps(db, { createPrintfulOrder, resolveImageUrlById })
    );
    expect(result.action).toBe("submitted");

    // Printful got a 2-item array, each with its own variant + front file.
    const items = createPrintfulOrder.mock.calls[0][0].items as {
      variantId: number;
      quantity: number;
      files: { placement: string; url: string }[];
    }[];
    expect(items).toHaveLength(2);
    expect(items.every((i) => typeof i.variantId === "number")).toBe(true);
    expect(items.every((i) => i.files.some((f) => f.placement === "front"))).toBe(
      true
    );

    // Both designs flipped to ordered.
    for (const id of [d1.id, d2.id]) {
      const dd = await db.query.design.findFirst({
        where: eq(schema.design.id, id),
      });
      expect(dd?.status).toBe("ordered");
    }

    // One sale at the cart total, one COGS for the whole order (shipping once).
    const entries = await ledgerFor(db, order.id);
    const byType = Object.fromEntries(entries.map((e) => [e.type, e.amount]));
    expect(byType.sale).toBe(43.55);
    expect(byType.cogs).toBe(-25.0);
    expect(entries.filter((e) => e.type === "cogs")).toHaveLength(1);
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

// Branches migrated from the retired mocked-db suite (webhook-handlers.test.ts)
// onto the real harness — same scenarios, real rows instead of mock chains.
describe("money path — edge branches", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("throws when the order does not exist", async () => {
    await expect(
      handleStripeCheckoutCompleted(
        makeSession("missing-order", "missing-design"),
        makeDeps(db)
      )
    ).rejects.toThrow(/not found/);
  });

  it("returns paid (no submit) when the design has no image", async () => {
    const { order, design } = await seed(db);
    const createPrintfulOrder = vi.fn();
    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id),
      makeDeps(db, {
        createPrintfulOrder,
        resolveDesignImageUrl: vi.fn().mockResolvedValue(null),
      })
    );

    expect(result.action).toBe("paid");
    expect(createPrintfulOrder).not.toHaveBeenCalled();

    // Money moved: order is paid and the sale is in the ledger, no COGS.
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("paid");
    const entries = await ledgerFor(db, order.id);
    expect(entries.map((e) => e.type).sort()).toEqual(["sale", "stripe_fee"]);
  });

  it("submits successfully when generateOrderName returns null", async () => {
    const { order, design } = await seed(db);
    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id),
      makeDeps(db, { generateOrderName: vi.fn().mockResolvedValue(null) })
    );

    expect(result.action).toBe("submitted");
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.displayName).toBeNull();
    expect(updated?.status).toBe("submitted");
  });

  it("prints the pinned placements.front image over the design display image", async () => {
    const { order, design } = await seed(db, {
      placements: { front: "pinned-img" },
    });
    const createPrintfulOrder = vi
      .fn()
      .mockResolvedValue({ id: 9999, costs: { total: "12.50" } });
    const resolveImageUrlById = vi
      .fn()
      .mockResolvedValue("https://img.example/pinned.png");

    await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id),
      makeDeps(db, { createPrintfulOrder, resolveImageUrlById })
    );

    expect(resolveImageUrlById).toHaveBeenCalledWith("pinned-img");
    const files = createPrintfulOrder.mock.calls[0][0].items[0].files;
    expect(files[0].url).toBe("https://img.example/pinned.png");
  });

  it("falls back to the display image when the pinned image can't resolve", async () => {
    const { order, design } = await seed(db, {
      placements: { front: "gone-img" },
    });
    const createPrintfulOrder = vi
      .fn()
      .mockResolvedValue({ id: 9999, costs: { total: "12.50" } });

    await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id),
      makeDeps(db, {
        createPrintfulOrder,
        resolveImageUrlById: vi.fn().mockResolvedValue(null),
      })
    );

    const files = createPrintfulOrder.mock.calls[0][0].items[0].files;
    expect(files[0].url).toBe("https://img.example/x.png"); // display image
  });

  it("drops an unresolvable back placement and submits front-only", async () => {
    const { order, design } = await seed(db, {
      placements: { front: "img-front", back: "img-back-gone" },
    });
    const createPrintfulOrder = vi
      .fn()
      .mockResolvedValue({ id: 9999, costs: { total: "12.50" } });
    const resolveImageUrlById = vi
      .fn()
      .mockImplementation(async (id: string) =>
        id === "img-front" ? "https://img.example/front.png" : null
      );

    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id),
      makeDeps(db, { createPrintfulOrder, resolveImageUrlById })
    );

    expect(result.action).toBe("submitted");
    const files = createPrintfulOrder.mock.calls[0][0].items[0].files;
    expect(files).toHaveLength(1);
    expect(files[0].placement).toBe("front");
  });
});

describe("money path — Printful lifecycle events", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("throws on a missing Printful order ID in the payload", async () => {
    await expect(
      handlePrintfulEvent({ type: "package_shipped", data: {} }, { db })
    ).rejects.toThrow(/Missing Printful order ID/);
  });

  it("throws when no order matches the Printful ID", async () => {
    await expect(
      handlePrintfulEvent(
        { type: "package_shipped", data: { order: { id: 424242 } } },
        { db }
      )
    ).rejects.toThrow(/No order found/);
  });

  it("rejects a shipped transition from an invalid state", async () => {
    await seed(db, { status: "pending", printfulOrderId: "7777" });
    await expect(
      handlePrintfulEvent(
        { type: "package_shipped", data: { order: { id: 7777 } } },
        { db }
      )
    ).rejects.toThrow(/Invalid order transition/);
  });

  it("logs order_failed without changing status", async () => {
    const { order } = await seed(db, {
      status: "submitted",
      printfulOrderId: "9999",
    });
    const result = await handlePrintfulEvent(
      { type: "order_failed", data: { order: { id: 9999 }, reason: "OOS" } },
      { db }
    );
    expect(result.action).toBe("failed_logged");
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("submitted");
  });

  it("ignores unhandled event types", async () => {
    await seed(db, { status: "submitted", printfulOrderId: "9999" });
    const result = await handlePrintfulEvent(
      { type: "stock_updated", data: { order: { id: 9999 } } },
      { db }
    );
    expect(result.action).toBe("ignored");
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
