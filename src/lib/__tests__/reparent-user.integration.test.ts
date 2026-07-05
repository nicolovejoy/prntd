/**
 * Guest→account claim (#37): reparentUserData must move EVERY user-owned table
 * in one atomic batch — the anonymous plugin deletes the anon user right after,
 * so anything left behind gets cascaded away. One seeded row per table doubles
 * as the checklist when new user-owned tables land (conversation/image model).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { reparentUserData } from "@/lib/reparent-user";

type Db = Awaited<ReturnType<typeof createTestDb>>;

describe("reparentUserData", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(schema.user).values([
      { id: "anon-1", email: "anon@example.com", name: "Guest" },
      { id: "real-1", email: "real@example.com", name: "Real" },
    ]);
  });

  it("re-parents one row per user-owned table", async () => {
    const [design] = await db
      .insert(schema.design)
      .values({ userId: "anon-1" })
      .returning();
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: "anon-1",
        designId: design.id,
        productId: "bella-canvas-3001",
        size: "M",
        color: "Black",
        totalPrice: 24.12,
        status: "pending",
      })
      .returning();
    const [cart] = await db
      .insert(schema.cartItem)
      .values({
        userId: "anon-1",
        designId: design.id,
        productId: "bella-canvas-3001",
        size: "M",
        color: "Black",
      })
      .returning();
    const [store] = await db
      .insert(schema.store)
      .values({ ownerId: "anon-1", slug: "guest-shop", name: "Guest Shop" })
      .returning();
    const [product] = await db
      .insert(schema.product)
      .values({
        ownerId: "anon-1",
        designId: design.id,
        blankId: "bella-canvas-3001",
      })
      .returning();

    await reparentUserData(db, "anon-1", "real-1");

    expect(
      (await db.query.design.findFirst({ where: eq(schema.design.id, design.id) }))
        ?.userId
    ).toBe("real-1");
    expect(
      (await db.query.order.findFirst({ where: eq(schema.order.id, order.id) }))
        ?.userId
    ).toBe("real-1");
    expect(
      (await db.query.cartItem.findFirst({ where: eq(schema.cartItem.id, cart.id) }))
        ?.userId
    ).toBe("real-1");
    expect(
      (await db.query.store.findFirst({ where: eq(schema.store.id, store.id) }))
        ?.ownerId
    ).toBe("real-1");
    expect(
      (await db.query.product.findFirst({ where: eq(schema.product.id, product.id) }))
        ?.ownerId
    ).toBe("real-1");

    // Nothing still points at the anon user.
    expect(
      await db.query.design.findMany({ where: eq(schema.design.userId, "anon-1") })
    ).toHaveLength(0);
    expect(
      await db.query.cartItem.findMany({
        where: eq(schema.cartItem.userId, "anon-1"),
      })
    ).toHaveLength(0);
  });

  it("no-ops when from and to are the same user", async () => {
    await db.insert(schema.design).values({ userId: "anon-1" });
    await reparentUserData(db, "anon-1", "anon-1");
    expect(
      await db.query.design.findMany({ where: eq(schema.design.userId, "anon-1") })
    ).toHaveLength(1);
  });

  it("leaves the other user's rows alone", async () => {
    await db.insert(schema.design).values({ userId: "real-1" });
    await db.insert(schema.design).values({ userId: "anon-1" });
    await reparentUserData(db, "anon-1", "real-1");
    expect(
      await db.query.design.findMany({ where: eq(schema.design.userId, "real-1") })
    ).toHaveLength(2);
  });
});
