/**
 * Per-line identity on a multi-item order (real DB).
 *
 * Motivating case: prod order `de8c1723` had line 1 = one design on a Classic
 * Tee and line 2 = a *different* design on a Box Tee, and every read site
 * showed only line 1's artwork. These tests lock that both the email loader
 * and the admin loader hand back a DIFFERENT thumbnail per line.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "./factories";
import { createDefaultOrderEmailDeps } from "@/lib/order-emails";
import {
  buildLineIdentities,
  resolveOrderLineIdentities,
} from "@/lib/order-line-identity";

vi.mock("@/lib/design-images", () => ({
  getDesignDisplayImageUrl: vi.fn().mockResolvedValue("https://img.example/hero.png"),
  getDesignImageById: vi.fn().mockResolvedValue(null),
}));

type Db = Awaited<ReturnType<typeof createTestDb>>;

const senders = {
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
};

/**
 * Two designs, two owners, one order with a line for each. Line 1 pins its
 * front image (published, titled); line 2 has no pin, so it falls back to its
 * design's primary image and stays untitled.
 */
async function seedTwoDesignOrder(db: Db) {
  await makeUser(db, "buyer");
  await makeUser(db, "seller");

  const buyerDesign = await makeDesign(db, "buyer");
  const sellerDesign = await makeDesign(db, "seller");

  const buyerImage = await makeSourceImage(db, {
    designId: buyerDesign.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/line-1.png",
  });
  const sellerImage = await makeSourceImage(db, {
    designId: sellerDesign.id,
    ownerId: "seller",
    imageUrl: "https://img.example/line-2.png",
    publishedAt: new Date(),
    title: "Neon Raccoon",
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: buyerImage })
    .where(eq(schema.design.id, buyerDesign.id));
  await db
    .update(schema.design)
    .set({ primaryImageId: sellerImage })
    .where(eq(schema.design.id, sellerDesign.id));

  const [order] = await db
    .insert(schema.order)
    .values({
      userId: "buyer",
      designId: buyerDesign.id,
      totalPrice: 43.55,
      status: "paid",
    })
    .returning();

  // Line 1: same blank/color/size as line 2 on purpose — without per-line
  // artwork the two rows would be indistinguishable.
  await db.insert(schema.orderItem).values({
    orderId: order.id,
    designId: buyerDesign.id,
    productId: "bella-canvas-3001",
    size: "L",
    color: "Black",
    quantity: 1,
    itemPrice: 19.43,
    createdAt: new Date(1000),
  });
  await db.insert(schema.orderItem).values({
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

  return { order, buyerDesign, sellerDesign, buyerImage, sellerImage };
}

describe("resolveOrderLineIdentities", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("gives each line its own thumbnail, title and designer", async () => {
    const { buyerDesign, sellerDesign, sellerImage } = await seedTwoDesignOrder(db);

    const identities = await resolveOrderLineIdentities(db, [
      { designId: buyerDesign.id, placements: null },
      { designId: sellerDesign.id, placements: { front: sellerImage } },
    ]);

    expect(identities[0].imageUrl).toBe("https://img.example/line-1.png");
    expect(identities[1].imageUrl).toBe("https://img.example/line-2.png");
    expect(identities[0].imageUrl).not.toBe(identities[1].imageUrl);

    // Only the published line has a name; an unpublished design has no title.
    expect(identities[0].title).toBeNull();
    expect(identities[1].title).toBe("Neon Raccoon");

    // Line 1 has no placements, so it falls back to the conversation owner;
    // line 2 derives its contributor from the pinned image's owner.
    expect(identities[0].contributors).toEqual([{ userId: "buyer", name: "buyer" }]);
    expect(identities[1].contributors).toEqual([{ userId: "seller", name: "seller" }]);
  });

  it("falls back to the design's latest output when it has no primary pointer", async () => {
    await makeUser(db, "u1");
    const design = await makeDesign(db, "u1");
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "u1",
      imageUrl: "https://img.example/only.png",
    });

    const [identity] = await resolveOrderLineIdentities(db, [
      { designId: design.id, placements: {} },
    ]);

    expect(identity.imageUrl).toBe("https://img.example/only.png");
  });

  it("resolves a pinned placement-render id (Model B id reuse)", async () => {
    await makeUser(db, "u1");
    const design = await makeDesign(db, "u1");
    const renderId = crypto.randomUUID();
    await db.insert(schema.placementRender).values({
      id: renderId,
      designId: design.id,
      blankId: "bella-canvas-3001",
      placementId: "front",
      imageUrl: "https://img.example/render.png",
      aspectRatio: "1:1",
    });

    const [identity] = await resolveOrderLineIdentities(db, [
      { designId: design.id, placements: { front: renderId } },
    ]);

    expect(identity.imageUrl).toBe("https://img.example/render.png");
  });

  it("returns nulls rather than throwing when nothing resolves", async () => {
    const identities = await resolveOrderLineIdentities(db, [
      { designId: "ghost-design", placements: { front: "ghost-image" } },
    ]);

    expect(identities).toEqual([
      { imageUrl: null, title: null, contributors: [] },
    ]);
  });
});

describe("buildLineIdentities (pure)", () => {
  const ctx = {
    urlByImageId: new Map([["img-a", "https://a.png"]]),
    titleByImageId: new Map([["img-a", "Title A"]]),
    displayUrlByDesignId: new Map([["d1", "https://d1.png"]]),
    designerByDesignId: new Map([["d1", { userId: "u1", name: "Nico" }]]),
    ownerByImageId: new Map([["img-a", { userId: "u1", name: "Nico" }]]),
  };

  it("prefers the pinned front over the design display image", () => {
    expect(
      buildLineIdentities([{ designId: "d1", placements: { front: "img-a" } }], ctx)
    ).toEqual([
      {
        imageUrl: "https://a.png",
        title: "Title A",
        contributors: [{ userId: "u1", name: "Nico" }],
      },
    ]);
  });

  it("falls back to the design display image with no title", () => {
    expect(buildLineIdentities([{ designId: "d1", placements: null }], ctx)).toEqual([
      {
        imageUrl: "https://d1.png",
        title: null,
        contributors: [{ userId: "u1", name: "Nico" }],
      },
    ]);
  });

  it("falls back to the design display image when the pin is unresolvable", () => {
    expect(
      buildLineIdentities([{ designId: "d1", placements: { front: "gone" } }], ctx)
    ).toEqual([
      {
        imageUrl: "https://d1.png",
        title: null,
        contributors: [{ userId: "u1", name: "Nico" }],
      },
    ]);
  });
});

describe("loadOrderForEmail on a two-design order", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("emails both lines with different thumbnails", async () => {
    const { order } = await seedTwoDesignOrder(db);
    const deps = createDefaultOrderEmailDeps(db, senders);

    const payload = await deps.loadOrderForEmail(order.id);

    expect(payload?.lines).toHaveLength(2);
    expect(payload?.lines[0].imageUrl).toBe("https://img.example/line-1.png");
    expect(payload?.lines[1].imageUrl).toBe("https://img.example/line-2.png");
    expect(payload?.lines[0].imageUrl).not.toBe(payload?.lines[1].imageUrl);
    expect(payload?.lines[0].designName).toBeNull();
    expect(payload?.lines[1].designName).toBe("Neon Raccoon");
    // Backdrop is the line's own shirt color, not the order header's.
    expect(payload?.lines[0].backdrop).toBeTruthy();
  });
});
