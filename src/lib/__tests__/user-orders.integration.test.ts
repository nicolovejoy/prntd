/**
 * Integration test for getUserOrdersData against a real (in-memory) libSQL DB.
 * Locks the behavior that the resolveOrderLines wiring fixes: a multi-item
 * cart order must surface every line, not just the first item written to the
 * order's scalar columns. The db singleton is mocked to the test DB; the
 * database itself is real (FKs enforced, schema-derived). Auth lives at the
 * page boundary now (requireRealUser) and is covered in require-user.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import { getUserOrdersData } from "@/lib/user-orders";

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
  const imageId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: userId,
    imageUrl,
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: imageId })
    .where(eq(schema.design.id, design.id));
  return { designId: design.id, imageId };
}

beforeEach(async () => {
  h.db = await createTestDb();
  await (h.db as Db)
    .insert(schema.user)
    .values({ id: "buyer", email: "buyer@example.com", name: "Buyer" });
});

describe("getUserOrdersData", () => {
  it("surfaces every line of a multi-item cart order", async () => {
    const db = h.db as Db;
    const a = await seedDesignWithImage(db, "buyer", "https://r2/a.png");
    const b = await seedDesignWithImage(db, "buyer", "https://r2/b.png");

    // The header carries money + linkage; every shirt is an order_item row.
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: "buyer",
        designId: a.designId,
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

    const orders = await getUserOrdersData("buyer");
    expect(orders).toHaveLength(1);
    expect(orders[0].lines).toHaveLength(2);
    expect(orders[0].lines.map((l) => l.color)).toEqual(["White", "Black"]);
    expect(orders[0].lines[1].quantity).toBe(2);
    expect(orders[0].lines[1].blankId).toBe("bella-canvas-6400");
    // Each line resolves its own pinned image.
    expect(orders[0].lines[0].imageUrl).toBe("https://r2/a.png");
    expect(orders[0].lines[1].imageUrl).toBe("https://r2/b.png");
  });

  it("renders a single-line order from its one order_item row", async () => {
    const db = h.db as Db;
    const a = await seedDesignWithImage(db, "buyer", "https://r2/legacy.png");
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: "buyer",
        designId: a.designId,
        totalPrice: 24.12,
        status: "shipped",
      })
      .returning();
    await db.insert(schema.orderItem).values({
      orderId: order.id,
      designId: a.designId,
      productId: "bella-canvas-3001",
      size: "L",
      color: "Navy",
      quantity: 1,
      placements: { front: a.imageId },
      itemPrice: 19.43,
    });

    const orders = await getUserOrdersData("buyer");
    expect(orders[0].lines).toHaveLength(1);
    expect(orders[0].lines[0].size).toBe("L");
    expect(orders[0].lines[0].color).toBe("Navy");
    expect(orders[0].lines[0].imageUrl).toBe("https://r2/legacy.png");
  });

  it("resolves a distinct back thumbnail when the line pins one (#167)", async () => {
    const db = h.db as Db;
    const a = await seedDesignWithImage(db, "buyer", "https://r2/front.png");
    const backImageId = await makeSourceImage(db, {
      designId: a.designId,
      ownerId: "buyer",
      imageUrl: "https://r2/back.png",
    });
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: "buyer",
        designId: a.designId,
        totalPrice: 27.43,
        status: "paid",
      })
      .returning();
    await db.insert(schema.orderItem).values({
      orderId: order.id,
      designId: a.designId,
      productId: "bella-canvas-3001",
      size: "M",
      color: "White",
      quantity: 1,
      placements: { front: a.imageId, back: backImageId },
      itemPrice: 27.43,
    });

    const orders = await getUserOrdersData("buyer");
    expect(orders[0].lines[0].imageUrl).toBe("https://r2/front.png");
    expect(orders[0].lines[0].backImageUrl).toBe("https://r2/back.png");
    expect(orders[0].lines[0].backImageUrl).not.toBe(orders[0].lines[0].imageUrl);
  });

  it("leaves backImageUrl null for a front-only line", async () => {
    const db = h.db as Db;
    const a = await seedDesignWithImage(db, "buyer", "https://r2/front-only.png");
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: "buyer",
        designId: a.designId,
        totalPrice: 19.43,
        status: "paid",
      })
      .returning();
    await db.insert(schema.orderItem).values({
      orderId: order.id,
      designId: a.designId,
      productId: "bella-canvas-3001",
      size: "M",
      color: "White",
      quantity: 1,
      placements: { front: a.imageId },
      itemPrice: 19.43,
    });

    const orders = await getUserOrdersData("buyer");
    expect(orders[0].lines[0].backImageUrl).toBeNull();
  });

  it("pairs each line of a multi-line order with its own identity, even behind a zero-line order (#198 task 3)", async () => {
    const db = h.db as Db;
    const a = await seedDesignWithImage(db, "buyer", "https://r2/one.png");
    const b = await seedDesignWithImage(db, "buyer", "https://r2/two.png");
    const c = await seedDesignWithImage(db, "buyer", "https://r2/three.png");

    // A more recent order with NO order_item rows sorts first (desc
    // createdAt) and contributes zero lines to the flat identities array.
    // The offset for every order after it must skip past nothing, exactly
    // as if this order weren't here at all.
    await db.insert(schema.order).values({
      userId: "buyer",
      designId: a.designId,
      totalPrice: 19.43,
      status: "pending",
      createdAt: new Date("2026-09-06T12:00:00Z"),
    });

    const [multiLine] = await db
      .insert(schema.order)
      .values({
        userId: "buyer",
        designId: a.designId,
        totalPrice: 3 * 19.43,
        status: "paid",
        createdAt: new Date("2026-09-06T11:00:00Z"),
      })
      .returning();
    await db.insert(schema.orderItem).values([
      {
        orderId: multiLine.id,
        designId: a.designId,
        productId: "bella-canvas-3001",
        size: "S",
        color: "White",
        quantity: 1,
        placements: { front: a.imageId },
        itemPrice: 19.43,
      },
      {
        orderId: multiLine.id,
        designId: b.designId,
        productId: "bella-canvas-3001",
        size: "M",
        color: "Black",
        quantity: 1,
        placements: { front: b.imageId },
        itemPrice: 19.43,
      },
      {
        orderId: multiLine.id,
        designId: c.designId,
        productId: "bella-canvas-3001",
        size: "L",
        color: "Navy",
        quantity: 1,
        placements: { front: c.imageId },
        itemPrice: 19.43,
      },
    ]);

    const orders = await getUserOrdersData("buyer");
    expect(orders).toHaveLength(2);
    expect(orders[0].lines).toHaveLength(0);
    expect(orders[1].lines.map((l) => l.imageUrl)).toEqual([
      "https://r2/one.png",
      "https://r2/two.png",
      "https://r2/three.png",
    ]);
  });

  it("only returns the buyer's own orders", async () => {
    const db = h.db as Db;
    await db
      .insert(schema.user)
      .values({ id: "other", email: "other@example.com", name: "Other" });
    const a = await seedDesignWithImage(db, "other", "https://r2/o.png");
    await db.insert(schema.order).values({
      userId: "other",
      designId: a.designId,
      totalPrice: 24.12,
      status: "paid",
    });

    expect(await getUserOrdersData("buyer")).toEqual([]);
  });
});
