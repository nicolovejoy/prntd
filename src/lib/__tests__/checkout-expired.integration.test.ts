/**
 * Real-DB tests (#231) for the `checkout.session.expired` webhook path:
 * Stripe's minimum Checkout Session TTL is 30 minutes, and the session
 * never fires this event for one that completed — so the handler's only
 * job is to mark a still-`pending` order abandoned, exactly once, and
 * leave anything else alone.
 */
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign } from "./factories";
import { handleStripeCheckoutExpired } from "@/lib/webhook-handlers";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seedOrder(
  db: Db,
  overrides: Partial<typeof schema.order.$inferInsert> = {}
) {
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
      ...overrides,
    })
    .returning();
  return order;
}

describe("handleStripeCheckoutExpired", () => {
  it("marks a pending order abandoned and sets abandonedAt", async () => {
    const db = await createTestDb();
    const order = await seedOrder(db);

    const result = await handleStripeCheckoutExpired(order.id, { db });

    expect(result).toEqual({ action: "abandoned" });
    const [updated] = await db
      .select()
      .from(schema.order)
      .where(eq(schema.order.id, order.id));
    expect(updated.abandonedAt).not.toBeNull();
    expect(updated.status).toBe("pending");
  });

  it("ignores a paid order and leaves it untouched", async () => {
    const db = await createTestDb();
    const order = await seedOrder(db, { status: "paid" });

    const result = await handleStripeCheckoutExpired(order.id, { db });

    expect(result).toEqual({ action: "ignored" });
    const [updated] = await db
      .select()
      .from(schema.order)
      .where(eq(schema.order.id, order.id));
    expect(updated.abandonedAt).toBeNull();
    expect(updated.status).toBe("paid");
  });

  it("ignores a second delivery on an already-abandoned order (timestamp unchanged)", async () => {
    const db = await createTestDb();
    const order = await seedOrder(db);

    const first = await handleStripeCheckoutExpired(order.id, { db });
    expect(first).toEqual({ action: "abandoned" });
    const [afterFirst] = await db
      .select()
      .from(schema.order)
      .where(eq(schema.order.id, order.id));
    const firstAbandonedAt = afterFirst.abandonedAt;
    expect(firstAbandonedAt).not.toBeNull();

    const second = await handleStripeCheckoutExpired(order.id, { db });
    expect(second).toEqual({ action: "ignored" });
    const [afterSecond] = await db
      .select()
      .from(schema.order)
      .where(eq(schema.order.id, order.id));
    expect(afterSecond.abandonedAt).toEqual(firstAbandonedAt);
  });

  it("ignores an unknown order id", async () => {
    const db = await createTestDb();

    const result = await handleStripeCheckoutExpired("no-such-order", { db });

    expect(result).toEqual({ action: "ignored" });
  });
});
