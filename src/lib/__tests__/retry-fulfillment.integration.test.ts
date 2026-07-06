/**
 * Durability sweep (#39) + order-naming-off-the-payment-path, on the real
 * in-memory libSQL harness. Covers which paid-but-unsubmitted orders the cron
 * picks up (floor/ceil/limit), that a Printful failure leaves the order paid
 * without aborting the sweep, and that naming now runs AFTER submission and
 * fails soft (a broken naming call never blocks the shirt).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { submitOrderFulfillment, type FulfillmentDeps } from "@/lib/order-fulfillment";
import { retryStuckFulfillments } from "@/lib/retry-fulfillment";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const HOUR = 60 * 60 * 1000;

function makeDeps(db: Db, overrides: Partial<FulfillmentDeps> = {}): FulfillmentDeps {
  return {
    db,
    createPrintfulOrder: vi
      .fn()
      .mockResolvedValue({ id: 9999, costs: { total: "12.50" } }),
    generateOrderName: vi.fn().mockResolvedValue("Named Order"),
    resolveDesignImageUrl: vi.fn().mockResolvedValue("https://img.example/x.png"),
    ...overrides,
  } as unknown as FulfillmentDeps;
}

/** Seed a paid, unsubmitted order with a controllable updatedAt age. */
async function seedStuck(
  db: Db,
  { ageMs = HOUR, overrides = {} }: { ageMs?: number; overrides?: Partial<typeof schema.order.$inferInsert> } = {}
) {
  const userId = `u-${Math.round(ageMs)}-${Object.keys(overrides).length}-${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.user).values({ id: userId, email: `${userId}@example.com`, name: "U" });
  const [design] = await db.insert(schema.design).values({ userId }).returning();
  const updatedAt = new Date(Date.now() - ageMs);
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
      status: "paid",
      shippingName: "Jane Doe",
      shippingAddress1: "1 Main St",
      shippingCity: "Town",
      shippingState: "CA",
      shippingZip: "90001",
      shippingCountry: "US",
      updatedAt,
      ...overrides,
    })
    .returning();
  return { userId, design, order };
}

describe("retryStuckFulfillments (#39)", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("retries a stuck paid order and submits it to Printful", async () => {
    const { order } = await seedStuck(db);
    const deps = makeDeps(db);

    const res = await retryStuckFulfillments(deps);

    expect(res.scanned).toBe(1);
    expect(res.results).toEqual([{ orderId: order.id, action: "submitted" }]);
    expect(deps.createPrintfulOrder).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: order.id })
    );

    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("submitted");
    expect(updated?.printfulOrderId).toBe("9999");
  });

  it("skips orders inside the 10-min floor (too fresh — may be an in-flight webhook)", async () => {
    await seedStuck(db, { ageMs: 2 * 60 * 1000 });
    const deps = makeDeps(db);

    const res = await retryStuckFulfillments(deps);

    expect(res.scanned).toBe(0);
    expect(deps.createPrintfulOrder).not.toHaveBeenCalled();
  });

  it("skips orders past the 24h ceiling (left for admin)", async () => {
    await seedStuck(db, { ageMs: 25 * HOUR });
    const deps = makeDeps(db);

    const res = await retryStuckFulfillments(deps);

    expect(res.scanned).toBe(0);
    expect(deps.createPrintfulOrder).not.toHaveBeenCalled();
  });

  it("ignores orders that already submitted (have a printfulOrderId)", async () => {
    await seedStuck(db, { overrides: { status: "submitted", printfulOrderId: "already" } });
    const deps = makeDeps(db);

    const res = await retryStuckFulfillments(deps);

    expect(res.scanned).toBe(0);
  });

  it("a Printful failure leaves the order paid and does not abort the sweep", async () => {
    const { order: failOrder } = await seedStuck(db);
    const { order: okOrder } = await seedStuck(db, { ageMs: 2 * HOUR });
    // Key the mock on externalId (= our order id), so the outcome is
    // deterministic regardless of the sweep's processing order.
    const createPrintfulOrder = vi
      .fn()
      .mockImplementation(async ({ externalId }: { externalId: string }) => {
        if (externalId === failOrder.id) throw new Error("Printful 500");
        return { id: 4321, costs: { total: "12.50" } };
      });
    const deps = makeDeps(db, { createPrintfulOrder });

    const res = await retryStuckFulfillments(deps);

    expect(res.scanned).toBe(2);
    const byId = Object.fromEntries(res.results.map((r) => [r.orderId, r.action]));
    expect(byId[okOrder.id]).toBe("submitted"); // sibling still processed
    expect(byId[failOrder.id]).toBe("paid_printful_failed");

    const stillPaid = await db.query.order.findFirst({
      where: eq(schema.order.id, failOrder.id),
    });
    expect(stillPaid?.status).toBe("paid");
    expect(stillPaid?.printfulOrderId).toBeNull();
  });

  it("honors the batch limit", async () => {
    for (let i = 0; i < 3; i++) await seedStuck(db, { ageMs: (i + 1) * HOUR });
    const deps = makeDeps(db);

    const res = await retryStuckFulfillments(deps, { limit: 2 });

    expect(res.scanned).toBe(2);
  });
});

describe("order naming off the payment path (#39)", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  async function fulfill(order: typeof schema.order.$inferSelect, deps: FulfillmentDeps) {
    return submitOrderFulfillment(
      order,
      [],
      {
        name: "Jane Doe",
        address1: "1 Main St",
        address2: "",
        city: "Town",
        state: "CA",
        zip: "90001",
        country: "US",
      },
      deps
    );
  }

  it("submits even when order naming throws (naming is post-submission, fails soft)", async () => {
    const { order } = await seedStuck(db);
    const createPrintfulOrder = vi
      .fn()
      .mockResolvedValue({ id: 9999, costs: { total: "12.50" } });
    const deps = makeDeps(db, {
      createPrintfulOrder,
      generateOrderName: vi.fn().mockRejectedValue(new Error("Anthropic down")),
    });

    const res = await fulfill(order, deps);

    expect(res.action).toBe("submitted");
    // The shirt went to Printful despite the naming failure.
    expect(createPrintfulOrder).toHaveBeenCalled();
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("submitted");
    expect(updated?.printfulOrderId).toBe("9999");
    expect(updated?.displayName).toBeNull();
  });

  it("names the order after a successful submission", async () => {
    const { order } = await seedStuck(db);
    const deps = makeDeps(db);

    const res = await fulfill(order, deps);

    expect(res.action).toBe("submitted");
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.displayName).toBe("Named Order");
  });

  it("does not re-name an order that already has a name (admin/cron retry)", async () => {
    const { order } = await seedStuck(db, { overrides: { displayName: "Existing Name" } });
    const generateOrderName = vi.fn().mockResolvedValue("New Name");
    const deps = makeDeps(db, { generateOrderName });

    await fulfill(order, deps);

    expect(generateOrderName).not.toHaveBeenCalled();
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.displayName).toBe("Existing Name");
  });
});
