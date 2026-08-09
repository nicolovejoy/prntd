// @vitest-environment node
/**
 * getOrderDetail against a real in-memory DB: a two-item order whose lines
 * carry DIFFERENT designs must come back with a different thumbnail per line
 * (prod order `de8c1723` showed only line 1's artwork everywhere).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const state = vi.hoisted(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  return { db: null as unknown };
});

vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({ user: { email: "admin@example.com" } })),
    },
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/printful", () => ({
  createOrder: vi.fn(),
  getOrderByExternalId: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({ generateOrderName: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
}));

import { getOrderDetail } from "../actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

function db(): Db {
  return state.db as Db;
}

beforeEach(async () => {
  state.db = await createTestDb();
});

async function seedTwoDesignOrder() {
  await makeUser(db(), "buyer");
  await makeUser(db(), "seller");
  const buyerDesign = await makeDesign(db(), "buyer");
  const sellerDesign = await makeDesign(db(), "seller");

  const buyerImage = await makeSourceImage(db(), {
    designId: buyerDesign.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/line-1.png",
  });
  const sellerImage = await makeSourceImage(db(), {
    designId: sellerDesign.id,
    ownerId: "seller",
    imageUrl: "https://img.example/line-2.png",
    publishedAt: new Date(),
    title: "Neon Raccoon",
  });
  await db()
    .update(schema.design)
    .set({ primaryImageId: buyerImage })
    .where(eq(schema.design.id, buyerDesign.id));
  await db()
    .update(schema.design)
    .set({ primaryImageId: sellerImage })
    .where(eq(schema.design.id, sellerDesign.id));

  const [order] = await db()
    .insert(schema.order)
    .values({
      userId: "buyer",
      designId: buyerDesign.id,
      totalPrice: 43.55,
      status: "paid",
    })
    .returning();

  // Deliberately identical blank / size / color on both lines.
  await db().insert(schema.orderItem).values({
    orderId: order.id,
    designId: buyerDesign.id,
    productId: "bella-canvas-3001",
    size: "L",
    color: "Black",
    quantity: 1,
    itemPrice: 19.43,
    createdAt: new Date(1000),
  });
  await db().insert(schema.orderItem).values({
    orderId: order.id,
    designId: sellerDesign.id,
    productId: "bella-canvas-3001",
    size: "L",
    color: "Black",
    quantity: 1,
    itemPrice: 19.43,
    placements: { front: sellerImage },
    createdAt: new Date(2000),
  });

  return { order };
}

describe("getOrderDetail per-line identity", () => {
  it("returns a different thumbnail, title and designer for each line", async () => {
    const { order } = await seedTwoDesignOrder();

    const detail = await getOrderDetail(order.id);

    expect(detail.lines).toHaveLength(2);
    expect(detail.lines[0].imageUrl).toBe("https://img.example/line-1.png");
    expect(detail.lines[1].imageUrl).toBe("https://img.example/line-2.png");
    expect(detail.lines[0].imageUrl).not.toBe(detail.lines[1].imageUrl);

    expect(detail.lines[0].title).toBeNull();
    expect(detail.lines[1].title).toBe("Neon Raccoon");

    // Line 1 is the buyer's own design → no attribution; line 2 is someone
    // else's published image → attributed.
    expect(detail.lines[0].designedByName).toBeNull();
    expect(detail.lines[1].designedByName).toBe("seller");
  });

  it("keeps a single-line order unchanged apart from the added fields", async () => {
    await makeUser(db(), "solo");
    const design = await makeDesign(db(), "solo");
    const imageId = await makeSourceImage(db(), {
      designId: design.id,
      ownerId: "solo",
      imageUrl: "https://img.example/solo.png",
    });
    await db()
      .update(schema.design)
      .set({ primaryImageId: imageId })
      .where(eq(schema.design.id, design.id));
    const [order] = await db()
      .insert(schema.order)
      .values({ userId: "solo", designId: design.id, totalPrice: 24.12, status: "paid" })
      .returning();
    await db().insert(schema.orderItem).values({
      orderId: order.id,
      designId: design.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      quantity: 1,
      itemPrice: 19.43,
    });

    const detail = await getOrderDetail(order.id);

    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0].imageUrl).toBe("https://img.example/solo.png");
    expect(detail.designImageUrl).toBe("https://img.example/solo.png");
    expect(detail.lines[0].designedByName).toBeNull();
  });
});
