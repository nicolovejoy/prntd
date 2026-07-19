/**
 * Integration test for getUserOrders against a real (in-memory) libSQL DB.
 * Locks the behavior that the resolveOrderLines wiring fixes: a multi-item
 * cart order must surface every line, not just the first item written to the
 * order's scalar columns. The db singleton + auth session are mocked; the
 * database itself is real (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) =>
    Boolean(u?.isAnonymous),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { getUserOrders } from "@/app/orders/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seedDesignWithImage(
  db: Db,
  userId: string,
  imageUrl: string
): Promise<{ designId: string; imageId: string }> {
  const [design] = await db
    .insert(schema.design)
    .values({ userId })
    .returning();
  const [image] = await db
    .insert(schema.designImage)
    .values({ designId: design.id, aspectRatio: "1:1", imageUrl })
    .returning();
  await db
    .update(schema.design)
    .set({ primaryImageId: image.id })
    .where(eq(schema.design.id, design.id));
  return { designId: design.id, imageId: image.id };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  await (h.db as Db)
    .insert(schema.user)
    .values({ id: "buyer", email: "buyer@example.com", name: "Buyer" });
});

describe("getUserOrders", () => {
  it("surfaces every line of a multi-item cart order", async () => {
    const db = h.db as Db;
    const a = await seedDesignWithImage(db, "buyer", "https://r2/a.png");
    const b = await seedDesignWithImage(db, "buyer", "https://r2/b.png");

    // A cart order writes item 1 to the scalar columns AND all items to order_item.
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: "buyer",
        designId: a.designId,
        productId: "bella-canvas-3001",
        size: "M",
        color: "White",
        placements: { front: a.imageId },
        totalPrice: 40.0,
        status: "paid",
      })
      .returning();
    await db.insert(schema.orderItem).values([
      {
        orderId: order.id,
        designId: a.designId,
        productId: "bella-canvas-3001",
        size: "M",
        color: "White",
        quantity: 1,
        placements: { front: a.imageId },
        itemPrice: 19.43,
      },
      {
        orderId: order.id,
        designId: b.designId,
        productId: "bella-canvas-6400",
        size: "S",
        color: "Black",
        quantity: 2,
        placements: { front: b.imageId },
        itemPrice: 19.43,
      },
    ]);

    const orders = await getUserOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].lines).toHaveLength(2);
    expect(orders[0].lines.map((l) => l.color)).toEqual(["White", "Black"]);
    expect(orders[0].lines[1].quantity).toBe(2);
    expect(orders[0].lines[1].blankId).toBe("bella-canvas-6400");
    // Each line resolves its own pinned image.
    expect(orders[0].lines[0].imageUrl).toBe("https://r2/a.png");
    expect(orders[0].lines[1].imageUrl).toBe("https://r2/b.png");
  });

  it("synthesizes a single line for a legacy order with no order_item rows", async () => {
    const db = h.db as Db;
    const a = await seedDesignWithImage(db, "buyer", "https://r2/legacy.png");
    await db.insert(schema.order).values({
      userId: "buyer",
      designId: a.designId,
      productId: "bella-canvas-3001",
      size: "L",
      color: "Navy",
      placements: { front: a.imageId },
      totalPrice: 24.12,
      status: "shipped",
    });

    const orders = await getUserOrders();
    expect(orders[0].lines).toHaveLength(1);
    expect(orders[0].lines[0].size).toBe("L");
    expect(orders[0].lines[0].color).toBe("Navy");
    expect(orders[0].lines[0].imageUrl).toBe("https://r2/legacy.png");
  });

  it("rejects anonymous guests", async () => {
    h.session = { user: { id: "guest", isAnonymous: true } };
    await expect(getUserOrders()).rejects.toThrow("Unauthorized");
  });
});
