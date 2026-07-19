/**
 * createDefaultOrderEmailDeps.loadOrderForEmail against a real (in-memory) DB.
 * This is the query that feeds order emails; it moved from the legacy scalar
 * order columns onto resolveOrderLines, and these tests lock that a cart order
 * emails every line (and keep the loader honest when Phase 1c drops the scalar
 * columns). Only the image-resolution module is mocked — it instantiates a
 * libSQL client at module load and is exercised elsewhere.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { createDefaultOrderEmailDeps } from "@/lib/order-emails";

vi.mock("@/lib/design-images", () => ({
  getDesignDisplayImageUrl: vi.fn().mockResolvedValue("https://img.example/x.png"),
  getDesignImageById: vi.fn().mockResolvedValue(null),
}));

type Db = Awaited<ReturnType<typeof createTestDb>>;

const senders = {
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
};

async function seedOrder(db: Db) {
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
      discountCode: "HALF",
      displayName: "Raccoon Café",
      status: "paid",
    })
    .returning();
  return { userId, design, order };
}

describe("createDefaultOrderEmailDeps.loadOrderForEmail", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("resolves a legacy single-item order to one named line", async () => {
    const { order } = await seedOrder(db);
    const deps = createDefaultOrderEmailDeps(db, senders);

    const payload = await deps.loadOrderForEmail(order.id);

    expect(payload).not.toBeNull();
    expect(payload?.email).toBe("buyer@example.com");
    expect(payload?.totalPrice).toBe(24.12);
    expect(payload?.discountCode).toBe("HALF");
    expect(payload?.displayName).toBe("Raccoon Café");
    expect(payload?.lines).toEqual([
      { productName: "Classic Tee", size: "M", color: "Black", quantity: 1 },
    ]);
  });

  it("resolves a cart order to every order_item line", async () => {
    const { userId, design, order } = await seedOrder(db);
    const [design2] = await db.insert(schema.design).values({ userId }).returning();
    await db.insert(schema.orderItem).values([
      {
        orderId: order.id,
        designId: design.id,
        productId: "bella-canvas-3001",
        size: "M",
        color: "Black",
        quantity: 1,
        itemPrice: 19.43,
      },
      {
        orderId: order.id,
        designId: design2.id,
        productId: "bella-canvas-3001",
        size: "L",
        color: "White",
        quantity: 2,
        itemPrice: 19.43,
      },
    ]);
    const deps = createDefaultOrderEmailDeps(db, senders);

    const payload = await deps.loadOrderForEmail(order.id);

    expect(payload?.lines).toEqual([
      { productName: "Classic Tee", size: "M", color: "Black", quantity: 1 },
      { productName: "Classic Tee", size: "L", color: "White", quantity: 2 },
    ]);
  });

  it("labels an unknown historical blank id as 'product' instead of breaking", async () => {
    const { order } = await seedOrder(db);
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.order)
      .set({ productId: "discontinued-blank" })
      .where(eq(schema.order.id, order.id));
    const deps = createDefaultOrderEmailDeps(db, senders);

    const payload = await deps.loadOrderForEmail(order.id);

    expect(payload?.lines[0].productName).toBe("product");
  });

  it("returns null for a missing order", async () => {
    const deps = createDefaultOrderEmailDeps(db, senders);
    expect(await deps.loadOrderForEmail("nope")).toBeNull();
  });
});
