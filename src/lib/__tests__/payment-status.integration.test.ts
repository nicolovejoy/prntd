/**
 * Real-DB tests (#266) for the Stripe payment_status gate. A completed
 * Checkout Session with a delayed-notification method arrives unpaid and
 * settles later via checkout.session.async_payment_succeeded / _failed, so
 * the handler must not claim, book, or fulfil until the session is paid.
 * Only Printful and naming are mocked; the database is real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign } from "./factories";
import {
  handleStripeCheckoutCompleted,
  handleStripeCheckoutExpired,
  type WebhookDeps,
  type StripeSessionData,
} from "@/lib/webhook-handlers";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(db: Db) {
  const userId = "user-1";
  await makeUser(db, userId);
  const design = await makeDesign(db, userId);
  const [order] = await db
    .insert(schema.order)
    .values({
      userId,
      designId: design.id,
      totalPrice: 24.12,
      itemPrice: 19.43,
      shippingPrice: 4.69,
      status: "pending",
    })
    .returning();
  await db.insert(schema.orderItem).values({
    orderId: order.id,
    designId: design.id,
    productId: "bella-canvas-3001",
    size: "M",
    color: "Black",
    quantity: 1,
    itemPrice: 19.43,
  });
  return { order, design };
}

function makeDeps(db: Db) {
  const createPrintfulOrder = vi
    .fn()
    .mockResolvedValue({ id: 9999, costs: { total: "12.50" } });
  const deps = {
    db,
    createPrintfulOrder,
    generateOrderName: vi.fn().mockResolvedValue("Test Order Name"),
    resolveDesignImageUrl: vi.fn().mockResolvedValue("https://img.example/x.png"),
  } as unknown as WebhookDeps;
  return { deps, createPrintfulOrder };
}

function makeSession(
  orderId: string,
  designId: string,
  paymentStatus: StripeSessionData["paymentStatus"]
): StripeSessionData {
  return {
    id: "cs_test_266",
    metadata: { orderId, designId },
    paymentStatus,
    paymentIntentId: "pi_266",
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
  };
}

async function ledgerTypes(db: Db, orderId: string) {
  const rows = await db.query.ledgerEntry.findMany({
    where: eq(schema.ledgerEntry.orderId, orderId),
  });
  return rows.map((r) => r.type).sort();
}

async function load(db: Db, orderId: string) {
  return db.query.order.findFirst({ where: eq(schema.order.id, orderId) });
}

describe("payment_status gate (#266)", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("leaves the order pending, untouched, when completed arrives unpaid", async () => {
    const { order, design } = await seed(db);
    const { deps, createPrintfulOrder } = makeDeps(db);

    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id, "unpaid"),
      deps
    );

    expect(result.action).toBe("awaiting_payment");
    const after = await load(db, order.id);
    expect(after?.status).toBe("pending");
    expect(after?.abandonedAt).toBeNull();
    expect(after?.classification).not.toBe("customer");
    expect(await ledgerTypes(db, order.id)).toEqual([]);
    expect(createPrintfulOrder).not.toHaveBeenCalled();
  });

  it("claims and fulfils when completed arrives paid", async () => {
    const { order, design } = await seed(db);
    const { deps, createPrintfulOrder } = makeDeps(db);

    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id, "paid"),
      deps
    );

    expect(result.action).toBe("submitted");
    expect((await load(db, order.id))?.status).toBe("submitted");
    expect(await ledgerTypes(db, order.id)).toEqual(["cogs", "sale", "stripe_fee"]);
    expect(createPrintfulOrder).toHaveBeenCalledTimes(1);
  });

  it("claims when payment_status is no_payment_required", async () => {
    const { order, design } = await seed(db);
    const { deps } = makeDeps(db);

    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id, "no_payment_required"),
      deps
    );

    expect(result.action).toBe("submitted");
    expect((await load(db, order.id))?.status).toBe("submitted");
  });

  it("async_payment_succeeded after an unpaid completed books one sale and one fee", async () => {
    const { order, design } = await seed(db);
    const { deps, createPrintfulOrder } = makeDeps(db);

    await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id, "unpaid"),
      deps
    );
    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id, "paid"),
      deps
    );

    expect(result.action).toBe("submitted");
    const types = await ledgerTypes(db, order.id);
    expect(types.filter((t) => t === "sale")).toHaveLength(1);
    expect(types.filter((t) => t === "stripe_fee")).toHaveLength(1);
    expect(createPrintfulOrder).toHaveBeenCalledTimes(1);
  });

  it("async_payment_succeeded delivered twice books once", async () => {
    const { order, design } = await seed(db);
    const { deps, createPrintfulOrder } = makeDeps(db);
    const paid = makeSession(order.id, design.id, "paid");

    const first = await handleStripeCheckoutCompleted(paid, deps);
    const second = await handleStripeCheckoutCompleted(paid, deps);

    expect(first.action).toBe("submitted");
    expect(second.action).toBe("skipped");
    expect(await ledgerTypes(db, order.id)).toEqual(["cogs", "sale", "stripe_fee"]);
    expect(createPrintfulOrder).toHaveBeenCalledTimes(1);
  });

  it("async_payment_succeeded after a paid completed is a no-op", async () => {
    const { order, design } = await seed(db);
    const { deps, createPrintfulOrder } = makeDeps(db);

    await handleStripeCheckoutCompleted(makeSession(order.id, design.id, "paid"), deps);
    const before = await load(db, order.id);
    const result = await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id, "paid"),
      deps
    );

    expect(result.action).toBe("skipped");
    expect(await load(db, order.id)).toEqual(before);
    expect(await ledgerTypes(db, order.id)).toEqual(["cogs", "sale", "stripe_fee"]);
    expect(createPrintfulOrder).toHaveBeenCalledTimes(1);
  });

  it("async_payment_failed marks a pending order abandoned", async () => {
    const { order, design } = await seed(db);
    const { deps } = makeDeps(db);
    await handleStripeCheckoutCompleted(
      makeSession(order.id, design.id, "unpaid"),
      deps
    );

    const result = await handleStripeCheckoutExpired(order.id, { db });

    expect(result.action).toBe("abandoned");
    const after = await load(db, order.id);
    expect(after?.status).toBe("pending");
    expect(after?.abandonedAt).not.toBeNull();
    expect(await ledgerTypes(db, order.id)).toEqual([]);
  });

  it("async_payment_failed on an already-paid order changes nothing", async () => {
    const { order, design } = await seed(db);
    const { deps } = makeDeps(db);
    await handleStripeCheckoutCompleted(makeSession(order.id, design.id, "paid"), deps);
    const before = await load(db, order.id);

    const result = await handleStripeCheckoutExpired(order.id, { db });

    expect(result.action).toBe("ignored");
    expect(await load(db, order.id)).toEqual(before);
  });
});
