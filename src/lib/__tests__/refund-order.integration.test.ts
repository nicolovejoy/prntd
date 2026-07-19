/**
 * Admin refund core (finding #1) against a real in-memory DB. Only Stripe is
 * mocked (payment-intent lookup + refund); the ledger + order rows are real, so
 * the idempotency guard (existing `refund` row / unique index) is exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { refundOrderCore, type RefundOrderDeps } from "@/lib/refund-order";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seedCanceledOrder(
  db: Db,
  overrides: Partial<typeof schema.order.$inferInsert> = {}
) {
  const userId = "user-1";
  await db
    .insert(schema.user)
    .values({ id: userId, email: "buyer@example.com", name: "Buyer" });
  const [design] = await db.insert(schema.design).values({ userId }).returning();
  const [order] = await db
    .insert(schema.order)
    .values({
      userId,
      designId: design.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      totalPrice: 24.12,
      status: "canceled",
      stripeSessionId: "cs_test_1",
      ...overrides,
    })
    .returning();
  return { order };
}

function makeDeps(db: Db, overrides: Partial<RefundOrderDeps> = {}): RefundOrderDeps {
  return {
    db,
    retrievePaymentIntentId: vi.fn().mockResolvedValue("pi_123"),
    createRefund: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RefundOrderDeps;
}

describe("refundOrderCore", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("issues a Stripe refund and books one refund ledger row", async () => {
    const { order } = await seedCanceledOrder(db);
    const deps = makeDeps(db);

    const result = await refundOrderCore(order.id, deps);

    expect(result).toEqual({ ok: true, refunded: true });
    expect(deps.createRefund).toHaveBeenCalledTimes(1);
    expect(deps.createRefund).toHaveBeenCalledWith("pi_123", `refund-${order.id}`);

    const entries = await db.query.ledgerEntry.findMany({
      where: eq(schema.ledgerEntry.orderId, order.id),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("refund");
    expect(entries[0].amount).toBe(-24.12);
  });

  it("is idempotent: a second refund is a no-op — no second Stripe refund, no duplicate row", async () => {
    const { order } = await seedCanceledOrder(db);
    const deps = makeDeps(db);

    const first = await refundOrderCore(order.id, deps);
    expect(first).toEqual({ ok: true, refunded: true });

    const second = await refundOrderCore(order.id, deps);
    expect(second).toEqual({ ok: true, refunded: false });

    // Stripe called exactly once across both invocations.
    expect(deps.createRefund).toHaveBeenCalledTimes(1);
    const entries = await db.query.ledgerEntry.findMany({
      where: eq(schema.ledgerEntry.orderId, order.id),
    });
    expect(entries.filter((e) => e.type === "refund")).toHaveLength(1);
  });

  it("refuses a non-canceled order without touching Stripe", async () => {
    const { order } = await seedCanceledOrder(db, { status: "submitted" });
    const deps = makeDeps(db);

    const result = await refundOrderCore(order.id, deps);

    expect(result.ok).toBe(false);
    expect(deps.createRefund).not.toHaveBeenCalled();
  });

  it("refuses when the order has no Stripe session", async () => {
    const { order } = await seedCanceledOrder(db, { stripeSessionId: null });
    const deps = makeDeps(db);

    const result = await refundOrderCore(order.id, deps);

    expect(result).toEqual({ ok: false, reason: "No Stripe session on this order" });
    expect(deps.createRefund).not.toHaveBeenCalled();
  });

  it("refuses when the session has no payment intent", async () => {
    const { order } = await seedCanceledOrder(db);
    const deps = makeDeps(db, {
      retrievePaymentIntentId: vi.fn().mockResolvedValue(null),
    });

    const result = await refundOrderCore(order.id, deps);

    expect(result.ok).toBe(false);
    expect(deps.createRefund).not.toHaveBeenCalled();
  });
});
