/**
 * deleteImages (bulk, image-level) against real in-memory libSQL with FKs
 * enforced (the #28 harness), driving the server action with db/auth/R2
 * mocked.
 *
 * The rules under test are the image-level ones (#195): ownership is
 * image.owner_id (a legacy row with no source design is still the owner's to
 * delete); an order reference refuses; a reference from another conversation,
 * a shop product or a cart keeps the image (the studio's bulk copy already
 * promises exactly that at the conversation level).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;
let currentUserId: string;
const deleteObjectByKey = vi.fn(async (_key: string) => {});

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
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
}));
vi.mock("@/lib/r2", () => ({
  deleteObjectByKey: (key: string) => deleteObjectByKey(key),
  imageKeyFromUrl: (url: string) => url.replace("https://r2/", ""),
}));

const { deleteImages } = await import("@/app/designs/actions");

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = "u1";
  deleteObjectByKey.mockClear();
  await makeUser(testDb, "u1");
  await makeUser(testDb, "u2");
});

async function imageRows(id: string) {
  return testDb.select().from(schema.image).where(eq(schema.image.id, id));
}

/** Seed a paid order with one order_item line. */
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

describe("deleteImages — ownership", () => {
  it("deletes an owned image with its link, listing and mirror product", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/a.png",
      publishedAt: new Date(),
    });

    const result = await deleteImages([imageId]);

    expect(result).toEqual({ deleted: [imageId], skipped: [] });
    expect(await imageRows(imageId)).toHaveLength(0);
    expect(await testDb.select().from(schema.conversationImage)).toHaveLength(0);
    expect(await testDb.select().from(schema.listing)).toHaveLength(0);
    expect(await testDb.select().from(schema.product)).toHaveLength(0);
    expect(deleteObjectByKey).toHaveBeenCalledWith("images/a.png");
  });

  it("skips an image owned by someone else and leaves it alone", async () => {
    const other = await makeDesign(testDb, "u2");
    const imageId = await makeSourceImage(testDb, {
      designId: other.id,
      ownerId: "u2",
      imageUrl: "https://r2/images/theirs.png",
    });

    const result = await deleteImages([imageId]);

    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([{ imageId, reason: "not-owned" }]);
    expect(await imageRows(imageId)).toHaveLength(1);
    expect(deleteObjectByKey).not.toHaveBeenCalled();
  });

  it("is idempotent: a second call on the same id reports not-found", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/gone.png",
    });

    await deleteImages([imageId]);
    const second = await deleteImages([imageId]);

    expect(second).toEqual({
      deleted: [],
      skipped: [{ imageId, reason: "not-found" }],
    });
  });

  it("deletes a legacy row with no source design", async () => {
    const [row] = await testDb
      .insert(schema.image)
      .values({
        ownerId: "u1",
        imageUrl: "https://r2/images/legacy.png",
        aspectRatio: "1:1",
        sourceDesignId: null,
      })
      .returning();

    const result = await deleteImages([row.id]);

    expect(result.deleted).toEqual([row.id]);
    expect(await imageRows(row.id)).toHaveLength(0);
  });
});

describe("deleteImages — order references refuse", () => {
  it("refuses when the image's own design's order line pins it", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/ordered.png",
    });
    await makeOrderWithLine({
      userId: "u1",
      headDesignId: d.id,
      lineDesignId: d.id,
      placements: { front: imageId },
    });

    const result = await deleteImages([imageId]);

    expect(result.skipped).toEqual([{ imageId, reason: "order" }]);
    expect(await imageRows(imageId)).toHaveLength(1);
  });

  it("refuses when another order's placements pin it (back design, #72/#95)", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/pinned-elsewhere.png",
    });
    const other = await makeDesign(testDb, "u1");
    await makeOrderWithLine({
      userId: "u1",
      headDesignId: other.id,
      lineDesignId: other.id,
      placements: { back: imageId },
    });

    const result = await deleteImages([imageId]);

    expect(result.skipped).toEqual([{ imageId, reason: "order" }]);
    expect(await imageRows(imageId)).toHaveLength(1);
  });

  it("refuses a legacy line with no placements that falls back to the primary", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/legacy-primary.png",
    });
    await testDb
      .update(schema.design)
      .set({ primaryImageId: imageId })
      .where(eq(schema.design.id, d.id));
    await makeOrderWithLine({
      userId: "u1",
      headDesignId: d.id,
      lineDesignId: d.id,
      placements: null,
    });

    const result = await deleteImages([imageId]);

    expect(result.skipped).toEqual([{ imageId, reason: "order" }]);
  });
});

describe("deleteImages — references elsewhere keep the image", () => {
  it("keeps an image seeded into another conversation", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/seeded.png",
    });
    const other = await makeDesign(testDb, "u1");
    await testDb
      .insert(schema.conversationImage)
      .values({ designId: other.id, imageId, role: "seed" });

    const result = await deleteImages([imageId]);

    expect(result.skipped).toEqual([{ imageId, reason: "in-use" }]);
    expect(await imageRows(imageId)).toHaveLength(1);
    // Both links survive — nothing was written at all.
    expect(await testDb.select().from(schema.conversationImage)).toHaveLength(2);
    expect(deleteObjectByKey).not.toHaveBeenCalled();
  });

  it("keeps an image a cart line pins", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/in-cart.png",
    });
    const other = await makeDesign(testDb, "u1");
    await testDb.insert(schema.cartItem).values({
      userId: "u1",
      designId: other.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "White",
      placements: { back: imageId },
    });

    const result = await deleteImages([imageId]);

    expect(result.skipped).toEqual([{ imageId, reason: "in-use" }]);
    expect(await imageRows(imageId)).toHaveLength(1);
  });

  it("keeps an image a shop product pins", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/on-product.png",
    });
    const other = await makeDesign(testDb, "u1");
    await testDb.insert(schema.product).values({
      ownerId: "u1",
      designId: other.id,
      blankId: "bella-canvas-3001",
      placements: { front_large: imageId },
    });

    const result = await deleteImages([imageId]);

    expect(result.skipped).toEqual([{ imageId, reason: "in-use" }]);
    expect(await imageRows(imageId)).toHaveLength(1);
  });
});

describe("deleteImages — thread state", () => {
  it("moves primary_image_id to the most recent remaining source image", async () => {
    const d = await makeDesign(testDb, "u1");
    const older = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/one.png",
      createdAt: new Date(1000),
    });
    const newest = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/two.png",
      createdAt: new Date(2000),
    });
    await testDb
      .update(schema.design)
      .set({ primaryImageId: newest })
      .where(eq(schema.design.id, d.id));

    await deleteImages([newest]);

    const row = await testDb.query.design.findFirst({
      where: eq(schema.design.id, d.id),
    });
    expect(row?.primaryImageId).toBe(older);
  });

  it("reports deleted and skipped from one call", async () => {
    const d = await makeDesign(testDb, "u1");
    const free = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/free.png",
    });
    const ordered = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/kept.png",
    });
    await makeOrderWithLine({
      userId: "u1",
      headDesignId: d.id,
      lineDesignId: d.id,
      placements: { front: ordered },
    });

    const result = await deleteImages([free, ordered, free]);

    expect(result.deleted).toEqual([free]);
    expect(result.skipped).toEqual([{ imageId: ordered, reason: "order" }]);
    expect(await imageRows(free)).toHaveLength(0);
    expect(await imageRows(ordered)).toHaveLength(1);
  });
});
