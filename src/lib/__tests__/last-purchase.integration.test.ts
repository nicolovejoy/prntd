/**
 * Remembered purchase defaults (#44) against a real in-memory DB: order +
 * order_item rows are real, so status filtering, line ordering, and
 * resolveOrderLines are exercised end to end.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign } from "./factories";
import * as schema from "@/lib/db/schema";
import { resolveLastPurchaseDefaults } from "@/lib/last-purchase";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const USER = { id: "buyer-1" };

/**
 * An order header plus its single line. `item: null` seeds a header with no
 * order_item rows at all (shouldn't exist post-1c — one test proves it degrades
 * to "no default" rather than throwing).
 */
async function seedOrder(
  db: Db,
  designId: string,
  opts: {
    order?: Partial<typeof schema.order.$inferInsert>;
    item?: Partial<typeof schema.orderItem.$inferInsert> | null;
  } = {}
) {
  const [row] = await db
    .insert(schema.order)
    .values({
      userId: USER.id,
      designId,
      totalPrice: 24.12,
      status: "paid",
      ...opts.order,
    })
    .returning();
  if (opts.item !== null) {
    await db.insert(schema.orderItem).values({
      orderId: row.id,
      designId,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      itemPrice: 19.43,
      ...opts.item,
    });
  }
  return row;
}

describe("resolveLastPurchaseDefaults", () => {
  let db: Db;
  let designId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await makeUser(db, USER.id);
    designId = (await makeDesign(db, USER.id)).id;
  });

  it("returns the last order's blank + size via its order_item row", async () => {
    await seedOrder(db, designId, {
      item: { productId: "bella-canvas-6400", size: "L", color: "White" },
    });

    expect(await resolveLastPurchaseDefaults(db, USER)).toEqual({
      blankId: "bella-canvas-6400",
      size: "L",
    });
  });

  it("returns null for an order with no lines", async () => {
    await seedOrder(db, designId, { item: null });

    expect(await resolveLastPurchaseDefaults(db, USER)).toBeNull();
  });

  it("uses the first line of a multi-item order (order_item by createdAt)", async () => {
    const order = await seedOrder(db, designId, { item: null });
    const base = { orderId: order.id, designId, color: "Black", itemPrice: 19.43 };
    // Inserted newest-first to prove ordering comes from createdAt, not
    // insertion order.
    await db.insert(schema.orderItem).values({
      ...base,
      productId: "cotton-heritage-mc1087",
      size: "2XL",
      createdAt: new Date("2026-07-02T00:00:10Z"),
    });
    await db.insert(schema.orderItem).values({
      ...base,
      productId: "bella-canvas-3001",
      size: "S",
      createdAt: new Date("2026-07-02T00:00:00Z"),
    });

    expect(await resolveLastPurchaseDefaults(db, USER)).toEqual({
      blankId: "bella-canvas-3001",
      size: "S",
    });
  });

  it("skips pending and canceled orders, even when newer", async () => {
    await seedOrder(db, designId, {
      order: { createdAt: new Date("2026-07-01T00:00:00Z") },
      item: { size: "L" },
    });
    await seedOrder(db, designId, {
      order: { status: "pending", createdAt: new Date("2026-07-02T00:00:00Z") },
      item: { size: "S" },
    });
    await seedOrder(db, designId, {
      order: { status: "canceled", createdAt: new Date("2026-07-03T00:00:00Z") },
      item: { size: "2XL" },
    });

    expect(await resolveLastPurchaseDefaults(db, USER)).toEqual({
      blankId: "bella-canvas-3001",
      size: "L",
    });
  });

  it("returns null with only pending/canceled history", async () => {
    await seedOrder(db, designId, { order: { status: "pending" } });
    await seedOrder(db, designId, { order: { status: "canceled" } });

    expect(await resolveLastPurchaseDefaults(db, USER)).toBeNull();
  });

  it("returns null when the last blank is discontinued", async () => {
    await seedOrder(db, designId, {
      item: { productId: "clear-case-iphone", size: "iPhone 15" },
    });

    expect(await resolveLastPurchaseDefaults(db, USER)).toBeNull();
  });

  it("drops a size the blank no longer offers, keeps the blank", async () => {
    await seedOrder(db, designId, { item: { size: "5XL" } });

    expect(await resolveLastPurchaseDefaults(db, USER)).toEqual({
      blankId: "bella-canvas-3001",
      size: null,
    });
  });

  it("returns null for anonymous users regardless of history", async () => {
    await seedOrder(db, designId, { item: { size: "L" } });

    expect(
      await resolveLastPurchaseDefaults(db, { id: USER.id, isAnonymous: true })
    ).toBeNull();
    expect(await resolveLastPurchaseDefaults(db, null)).toBeNull();
  });
});
