/**
 * #209: the error shapes `isUniqueViolation` has to recognise, produced by
 * real drizzle/libSQL calls rather than hand-built fakes. The unit tests in
 * ledger.test.ts prove the walk; these prove we walk the shape the driver
 * actually throws.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/ledger";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seedOrder(db: Db) {
  await db
    .insert(schema.user)
    .values({ id: "user-1", email: "buyer@example.com", name: "Buyer" });
  const [design] = await db
    .insert(schema.design)
    .values({ userId: "user-1" })
    .returning();
  const [order] = await db
    .insert(schema.order)
    .values({
      userId: "user-1",
      designId: design.id,
      totalPrice: 24.12,
      status: "canceled",
    })
    .returning();
  return order;
}

describe("isUniqueViolation against real driver errors", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("recognises a bare db.insert() that trips ledger_entry(order_id, type)", async () => {
    const order = await seedOrder(db);
    const row = {
      orderId: order.id,
      type: "refund" as const,
      amount: -24.12,
      description: "first",
    };
    await db.insert(schema.ledgerEntry).values(row);

    let caught: unknown;
    try {
      await db.insert(schema.ledgerEntry).values(row);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    // The reason this test exists: drizzle's own message says nothing about
    // the constraint, so a .message-only check can never see this.
    expect((caught as Error).message).not.toMatch(/UNIQUE constraint failed/i);
    expect(isUniqueViolation(caught)).toBe(true);
  });

  it("still recognises the same violation raised through db.batch()", async () => {
    const order = await seedOrder(db);
    const row = {
      orderId: order.id,
      type: "refund" as const,
      amount: -24.12,
      description: "first",
    };
    await db.insert(schema.ledgerEntry).values(row);

    let caught: unknown;
    try {
      await db.batch([db.insert(schema.ledgerEntry).values(row)]);
    } catch (err) {
      caught = err;
    }

    expect(isUniqueViolation(caught)).toBe(true);
  });

  it("does not mistake a foreign-key violation for a unique violation", async () => {
    let caught: unknown;
    try {
      await db.insert(schema.design).values({ userId: "no-such-user" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(isUniqueViolation(caught)).toBe(false);
  });
});
