/**
 * deleteDesign / deleteDesignImage against real in-memory libSQL with FKs
 * enforced (the #28 harness), driving the server actions with db/auth mocked.
 *
 * Prod bug (#121, 2026-07-28): deleteDesign's order guard only counted
 * `order.design_id`, but three other tables FK `design.id` — `order_item`
 * (authoritative lines since Phase 1c; a cart order's non-head designs appear
 * ONLY there), `cart_item`, and `product`. Hard-deleting a design any of them
 * referenced failed the FK constraint inside db.batch → masked Server
 * Components error on prod.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;
let currentUserId: string;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/app/preview/actions", () => ({
  prefetchProductMockups: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: currentUserId } }),
    },
  },
  isAnonymousUser: () => false,
}));
vi.mock("@/lib/ai", () => ({
  generatePublishedNaming: async () => ({ title: "T", description: "D" }),
  assessReadiness: vi.fn(),
  constructDesignBrief: vi.fn(),
  chatAboutDesign: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  uploadImageObject: vi.fn(async () => "https://r2/x.png"),
  deleteImageObject: vi.fn(async () => {}),
}));
vi.mock("@/lib/generators/registry", () => ({
  DEFAULT_GENERATOR_ID: "ideogram",
  GENERATORS: {},
  getGenerator: () => ({ id: "ideogram", costFor: () => 0.03 }),
}));

const { deleteDesign } = await import("@/app/designs/actions");
const { deleteDesignImage } = await import("@/app/design/actions");

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = "u1";
  await makeUser(testDb, "u1");
});

async function designRow(id: string) {
  return testDb.query.design.findFirst({ where: eq(schema.design.id, id) });
}

/** Seed a paid order for `designId` with one order_item line. */
async function makeOrderWithLine(params: {
  userId: string;
  headDesignId: string;
  lineDesignId: string;
  placements?: Record<string, string> | null;
}) {
  const [o] = await testDb
    .insert(schema.order)
    .values({
      userId: params.userId,
      designId: params.headDesignId,
      totalPrice: 24.12,
      status: "paid",
    })
    .returning();
  await testDb.insert(schema.orderItem).values({
    orderId: o.id,
    designId: params.lineDesignId,
    productId: "bella-canvas-3001",
    size: "L",
    color: "Black",
    placements: params.placements ?? null,
    itemPrice: 19.43,
  });
  return o;
}

describe("deleteDesign — rows that FK design.id (#121)", () => {
  it("deletes a design sitting in a cart (cart_item FK)", async () => {
    const d = await makeDesign(testDb, "u1");
    await testDb.insert(schema.cartItem).values({
      userId: "u1",
      designId: d.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "White",
    });

    await deleteDesign(d.id);

    expect(await designRow(d.id)).toBeUndefined();
    expect(await testDb.select().from(schema.cartItem)).toHaveLength(0);
  });

  it("archives a design bought only as a cart-order line (order_item FK, non-head design)", async () => {
    const head = await makeDesign(testDb, "u1");
    const d = await makeDesign(testDb, "u1");
    await makeOrderWithLine({ userId: "u1", headDesignId: head.id, lineDesignId: d.id });

    await deleteDesign(d.id);

    const row = await designRow(d.id);
    expect(row?.status).toBe("archived");
    expect(await testDb.select().from(schema.orderItem)).toHaveLength(1);
  });

  it("archives a design whose image is pinned as a back placement on another design's order", async () => {
    const d = await makeDesign(testDb, "u1");
    const backImageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/back.png",
    });
    const other = await makeDesign(testDb, "u1");
    const frontImageId = await makeSourceImage(testDb, {
      designId: other.id,
      ownerId: "u1",
      imageUrl: "https://img/front.png",
    });
    await makeOrderWithLine({
      userId: "u1",
      headDesignId: other.id,
      lineDesignId: other.id,
      placements: { front: frontImageId, back: backImageId },
    });

    await deleteDesign(d.id);

    const row = await designRow(d.id);
    expect(row?.status).toBe("archived");
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, backImageId))
    ).toHaveLength(1);
  });

  it("refuses with a message when a shop product uses the design (product FK)", async () => {
    const d = await makeDesign(testDb, "u1");
    await testDb.insert(schema.product).values({
      ownerId: "u1",
      designId: d.id,
      blankId: "bella-canvas-3001",
    });

    const result = await deleteDesign(d.id);

    expect(result?.error).toMatch(/product/i);
    expect(await designRow(d.id)).toBeDefined();
  });

  it("keeps an image (and its listing) that another conversation seed-links; deletes the rest", async () => {
    const d = await makeDesign(testDb, "u1");
    const sharedId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/shared.png",
      publishedAt: new Date(),
    });
    const privateId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/private.png",
    });
    const other = await makeDesign(testDb, "u1");
    // Backfill/fork shape: the other conversation carries the image as a seed.
    await testDb.insert(schema.conversationImage).values({
      designId: other.id,
      imageId: sharedId,
      role: "seed",
    });

    await deleteDesign(d.id);

    expect(await designRow(d.id)).toBeUndefined();
    // Shared image + listing survive so the other thread keeps rendering.
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, sharedId))
    ).toHaveLength(1);
    expect(
      await testDb.select().from(schema.listing).where(eq(schema.listing.imageId, sharedId))
    ).toHaveLength(1);
    // The other design's link is untouched.
    expect(
      await testDb
        .select()
        .from(schema.conversationImage)
        .where(eq(schema.conversationImage.designId, other.id))
    ).toHaveLength(1);
    // Everything owned solely by the deleted design is gone.
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, privateId))
    ).toHaveLength(0);
    expect(
      await testDb
        .select()
        .from(schema.conversationImage)
        .where(ne(schema.conversationImage.designId, other.id))
    ).toHaveLength(0);
  });

  it("hard-deletes everything when nothing else references the design", async () => {
    const d = await makeDesign(testDb, "u1");
    await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/solo.png",
    });
    await testDb.insert(schema.chatMessage).values({
      designId: d.id,
      role: "user",
      content: "hi",
    });

    await deleteDesign(d.id);

    expect(await designRow(d.id)).toBeUndefined();
    expect(await testDb.select().from(schema.image)).toHaveLength(0);
    expect(await testDb.select().from(schema.conversationImage)).toHaveLength(0);
    expect(await testDb.select().from(schema.chatMessage)).toHaveLength(0);
  });
});

describe("deleteDesignImage — cross-design references", () => {
  it("refuses when another design's order line pins the image", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/pinned.png",
    });
    const other = await makeDesign(testDb, "u1");
    await makeOrderWithLine({
      userId: "u1",
      headDesignId: other.id,
      lineDesignId: other.id,
      placements: { back: imageId },
    });

    await expect(deleteDesignImage(d.id, imageId)).rejects.toThrow(
      /referenced by an order/
    );
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(1);
  });

  it("keeps the image row and the other design's link when seed-linked elsewhere", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/seeded.png",
    });
    const other = await makeDesign(testDb, "u1");
    await testDb.insert(schema.conversationImage).values({
      designId: other.id,
      imageId,
      role: "seed",
    });

    await deleteDesignImage(d.id, imageId);

    // Own-thread link is gone…
    expect(
      await testDb
        .select()
        .from(schema.conversationImage)
        .where(
          and(
            eq(schema.conversationImage.imageId, imageId),
            eq(schema.conversationImage.designId, d.id)
          )
        )
    ).toHaveLength(0);
    // …but the shared artifact and the other conversation's link survive.
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(1);
    expect(
      await testDb
        .select()
        .from(schema.conversationImage)
        .where(eq(schema.conversationImage.designId, other.id))
    ).toHaveLength(1);
  });

  it("deletes image and listing when nothing else references it", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/alone.png",
      publishedAt: new Date(),
    });

    await deleteDesignImage(d.id, imageId);

    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(0);
    expect(
      await testDb.select().from(schema.listing).where(eq(schema.listing.imageId, imageId))
    ).toHaveLength(0);
    expect(
      await testDb.select().from(schema.conversationImage)
    ).toHaveLength(0);
  });

  it("keeps the image row when a shop product pins it (detach, slice 4)", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/on-product.png",
    });
    const other = await makeDesign(testDb, "u1");
    await testDb.insert(schema.product).values({
      ownerId: "u1",
      designId: other.id,
      blankId: "bella-canvas-3001",
      placements: { front_large: imageId },
    });

    await deleteDesignImage(d.id, imageId);

    // Own-thread link is gone, but the artifact survives for the product.
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(1);
    expect(
      await testDb
        .select()
        .from(schema.conversationImage)
        .where(eq(schema.conversationImage.imageId, imageId))
    ).toHaveLength(0);
  });

  it("keeps the image row when another design's cart line pins it (detach, slice 4)", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/in-cart.png",
    });
    const other = await makeDesign(testDb, "u1");
    await testDb.insert(schema.cartItem).values({
      userId: "u1",
      designId: other.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "White",
      placements: { front: `e2e-${other.id}`, back: imageId },
    });

    await deleteDesignImage(d.id, imageId);

    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(1);
  });
});

describe("deleteDesign — slice-4 ref-count", () => {
  it("keeps an image a shop product pins while deleting the rest of the thread", async () => {
    const d = await makeDesign(testDb, "u1");
    const pinnedId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/product-pin.png",
    });
    const looseId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/loose.png",
    });
    const other = await makeDesign(testDb, "u1");
    await testDb.insert(schema.product).values({
      ownerId: "u1",
      designId: other.id,
      blankId: "bella-canvas-3001",
      placements: { front_large: pinnedId },
    });

    await deleteDesign(d.id);

    expect(await designRow(d.id)).toBeUndefined();
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, pinnedId))
    ).toHaveLength(1);
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, looseId))
    ).toHaveLength(0);
  });
});
