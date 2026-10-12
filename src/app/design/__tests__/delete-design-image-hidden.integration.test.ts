/**
 * deleteDesignImage refuses an admin-hidden image (#310 item 2) against a real
 * in-memory libSQL with FKs enforced. The refusal sits after the ownership,
 * order and reachability checks, so a hidden id never changes which of those
 * messages a caller sees.
 *
 * Auth is mocked; the database is real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({ userId: "owner" as string | null }));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        h.userId ? { user: { id: h.userId, isAnonymous: false } } : null,
    },
  },
  isAnonymousUser: () => false,
}));
vi.mock("@/lib/ai", () => ({
  constructDesignBrief: vi.fn(),
  chatAboutDesign: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  uploadImageObject: vi.fn(),
  deleteImageObject: vi.fn(),
}));

const { deleteDesignImage } = await import("@/app/design/actions");

const PUBLISHED_AT = new Date("2026-02-01");

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "owner";
  await makeUser(testDb, "owner");
});

async function seedHidden() {
  const design = await makeDesign(testDb, "owner");
  const hiddenId = await makeSourceImage(testDb, {
    designId: design.id,
    ownerId: "owner",
    imageUrl: "https://r2/hidden.png",
    publishedAt: PUBLISHED_AT,
    isHidden: true,
  });
  return { designId: design.id, hiddenId };
}

async function rowCounts(designId: string, imageId: string) {
  return {
    image: (
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).length,
    publication: (
      await testDb
        .select()
        .from(schema.imagePublication)
        .where(eq(schema.imagePublication.imageId, imageId))
    ).length,
    product: (await testDb.select().from(schema.product)).length,
    links: (
      await testDb
        .select()
        .from(schema.conversationImage)
        .where(eq(schema.conversationImage.imageId, imageId))
    ).length,
    design: (
      await testDb.select().from(schema.design).where(eq(schema.design.id, designId))
    ).length,
  };
}

describe("deleteDesignImage and an admin-hidden image", () => {
  it("refuses the owner's own hidden image and leaves every row", async () => {
    const { designId, hiddenId } = await seedHidden();

    await expect(deleteDesignImage(designId, hiddenId)).rejects.toThrow(
      "This image is not available"
    );

    expect(await rowCounts(designId, hiddenId)).toEqual({
      image: 1,
      publication: 1,
      product: 1,
      links: 1,
      design: 1,
    });
  });

  it("tells a non-owner Unauthorized, not that the image is hidden", async () => {
    const { designId, hiddenId } = await seedHidden();
    await makeUser(testDb, "stranger");
    h.userId = "stranger";

    await expect(deleteDesignImage(designId, hiddenId)).rejects.toThrow(
      "Unauthorized"
    );
  });

  it("tells the owner Image not found for a hidden image this thread can't reach", async () => {
    const { designId } = await seedHidden();
    const other = await makeDesign(testDb, "owner");
    const foreignHidden = await makeSourceImage(testDb, {
      designId: other.id,
      ownerId: "owner",
      imageUrl: "https://r2/foreign-hidden.png",
      publishedAt: PUBLISHED_AT,
      isHidden: true,
    });

    await expect(deleteDesignImage(designId, foreignHidden)).rejects.toThrow(
      "Image not found"
    );
  });

  it("gives the order message for a hidden image an order line pins", async () => {
    const { designId, hiddenId } = await seedHidden();
    const [order] = await testDb
      .insert(schema.order)
      .values({ userId: "owner", designId, totalPrice: 24.12, status: "paid" })
      .returning();
    await testDb.insert(schema.orderItem).values({
      orderId: order.id,
      designId,
      productId: "bella-canvas-3001",
      size: "L",
      color: "Black",
      placements: { front: hiddenId },
      itemPrice: 19.43,
    });

    await expect(deleteDesignImage(designId, hiddenId)).rejects.toThrow(
      /referenced by an order/
    );
  });

  it("still deletes a visible image", async () => {
    const design = await makeDesign(testDb, "owner");
    const visibleId = await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://r2/visible.png",
      publishedAt: PUBLISHED_AT,
      isHidden: false,
    });

    await deleteDesignImage(design.id, visibleId);

    expect((await rowCounts(design.id, visibleId)).image).toBe(0);
  });

  it("refuses a hidden image that is a seed in this thread and keeps the seed link", async () => {
    await makeUser(testDb, "other");
    const origin = await makeDesign(testDb, "other");
    const seedId = await makeSourceImage(testDb, {
      designId: origin.id,
      ownerId: "other",
      imageUrl: "https://r2/seed-hidden.png",
      publishedAt: PUBLISHED_AT,
      isHidden: true,
    });
    const mine = await makeDesign(testDb, "owner");
    await testDb.insert(schema.conversationImage).values({
      designId: mine.id,
      imageId: seedId,
      role: "seed",
    });

    await expect(deleteDesignImage(mine.id, seedId)).rejects.toThrow(
      "This image is not available"
    );

    const links = await testDb
      .select()
      .from(schema.conversationImage)
      .where(eq(schema.conversationImage.designId, mine.id));
    expect(links).toHaveLength(1);
  });
});
