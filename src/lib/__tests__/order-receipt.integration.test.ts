/**
 * getOrderReceipt against a real (in-memory) libSQL DB: the owner check
 * (#317 item 3) and the front/back thumbnail resolution (#167). The db
 * singleton is mocked to the test DB (the h.db pattern from
 * get-listing-mockup.integration.test.ts); the database itself is real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "./factories";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import { getOrderReceipt } from "@/lib/order-receipt";

type Db = Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  h.db = await createTestDb();
});

async function seedTwoLineOrder(
  db: Db,
  opts: { abandonedAt?: Date | null } = {}
) {
  await makeUser(db, "buyer");
  const design = await makeDesign(db, "buyer");

  const frontOnly = await makeSourceImage(db, {
    designId: design.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/line-1-front.png",
  });
  const twoSidedFront = await makeSourceImage(db, {
    designId: design.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/line-2-front.png",
  });
  const twoSidedBack = await makeSourceImage(db, {
    designId: design.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/line-2-back.png",
  });

  const [order] = await db
    .insert(schema.order)
    .values({
      userId: "buyer",
      designId: design.id,
      totalPrice: 47.55,
      status: "paid",
      stripeSessionId: "cs_test_167",
      abandonedAt: opts.abandonedAt ?? null,
    })
    .returning();

  await db.insert(schema.orderItem).values([
    {
      orderId: order.id,
      designId: design.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "White",
      quantity: 1,
      placements: { front: frontOnly },
      itemPrice: 19.43,
      createdAt: new Date(1000),
    },
    {
      orderId: order.id,
      designId: design.id,
      productId: "bella-canvas-3001",
      size: "L",
      color: "Black",
      quantity: 1,
      placements: { front: twoSidedFront, back: twoSidedBack },
      itemPrice: 27.43,
      createdAt: new Date(2000),
    },
  ]);
  return order;
}

describe("getOrderReceipt", () => {
  it("gives the owner the receipt shape, one line per order_item (#167 thumbnails)", async () => {
    const db = h.db as Db;
    const order = await seedTwoLineOrder(db);

    const result = await getOrderReceipt({
      stripeSessionId: "cs_test_167",
      viewerId: "buyer",
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe(order.id);
    expect(result?.status).toBe("paid");
    expect(result?.abandoned).toBe(false);
    expect(result?.totalPrice).toBe(47.55);
    expect(result?.lines).toHaveLength(2);

    expect(result?.lines[0].imageUrl).toBe("https://img.example/line-1-front.png");
    expect(result?.lines[0].backImageUrl).toBeNull();

    expect(result?.lines[1].imageUrl).toBe("https://img.example/line-2-front.png");
    expect(result?.lines[1].backImageUrl).toBe("https://img.example/line-2-back.png");
    expect(result?.lines[1].backImageUrl).not.toBe(result?.lines[1].imageUrl);
  });

  it("returns null for another user's id on the same session id", async () => {
    const db = h.db as Db;
    await seedTwoLineOrder(db);
    await makeUser(db, "stranger");

    expect(
      await getOrderReceipt({ stripeSessionId: "cs_test_167", viewerId: "stranger" })
    ).toBeNull();
  });

  it("returns null for an unknown session id", async () => {
    expect(
      await getOrderReceipt({ stripeSessionId: "cs_does_not_exist", viewerId: "buyer" })
    ).toBeNull();
  });

  it("reports abandoned when abandoned_at is set", async () => {
    const db = h.db as Db;
    await seedTwoLineOrder(db, { abandonedAt: new Date(5000) });

    const result = await getOrderReceipt({
      stripeSessionId: "cs_test_167",
      viewerId: "buyer",
    });
    expect(result?.abandoned).toBe(true);
  });
});
