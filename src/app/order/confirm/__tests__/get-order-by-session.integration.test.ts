/**
 * getOrderBySession front/back thumbnail resolution (#167), against a real
 * (in-memory) libSQL DB. The db singleton is mocked to the test DB (the h.db
 * pattern from get-listing-mockup.integration.test.ts); the database itself
 * is real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import { getOrderBySession } from "../actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  h.db = await createTestDb();
});

describe("getOrderBySession back thumbnails (#167)", () => {
  it("resolves imageUrl for every line and backImageUrl only where pinned", async () => {
    const db = h.db as Db;
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

    const result = await getOrderBySession("cs_test_167");

    expect(result).not.toBeNull();
    expect(result?.lines).toHaveLength(2);

    expect(result?.lines[0].imageUrl).toBe("https://img.example/line-1-front.png");
    expect(result?.lines[0].backImageUrl).toBeNull();

    expect(result?.lines[1].imageUrl).toBe("https://img.example/line-2-front.png");
    expect(result?.lines[1].backImageUrl).toBe("https://img.example/line-2-back.png");
    expect(result?.lines[1].backImageUrl).not.toBe(result?.lines[1].imageUrl);
  });

  it("returns null for an unknown session id", async () => {
    expect(await getOrderBySession("cs_does_not_exist")).toBeNull();
  });
});
