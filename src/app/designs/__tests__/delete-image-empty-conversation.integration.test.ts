/**
 * "Delete the last image of a conversation removes the conversation" (owner
 * ruling, 2026-09-09) — against real in-memory libSQL with FKs enforced (the
 * #28 harness), driving both delete paths (`deleteDesignImage`, the bulk
 * `deleteImages`) the way `delete-design.integration.test.ts` and
 * `delete-images.integration.test.ts` already do.
 *
 * The rule lives in one place — `removeDesignIfNowEmpty` in
 * src/lib/delete-image.ts, called from the end of `executeImageDeletion` —
 * so every caller gets it: a design that loses its last image link is
 * removed via delete-design.ts's own rules (order-referenced designs
 * archive, everything else hard-deletes), UNLESS a generation job is still
 * `running` for it, in which case the conversation is left alone — that job
 * is about to append an image.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { getStudioLanesData } from "@/lib/studio";

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
  constructDesignBrief: vi.fn(),
  chatAboutDesign: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  uploadImageObject: vi.fn(async () => "https://r2/x.png"),
  deleteImageObject: vi.fn(async () => {}),
  deleteObjectByKey: vi.fn(async () => {}),
  imageKeyFromUrl: (url: string) => url.replace("https://r2/", ""),
}));
vi.mock("@/lib/generators/registry", () => ({
  DEFAULT_GENERATOR_ID: "ideogram",
  GENERATORS: {},
  getGenerator: () => ({ id: "ideogram", costFor: () => 0.03 }),
}));

const { deleteDesignImage } = await import("@/app/design/actions");
const { deleteImages } = await import("@/app/designs/actions");

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = "u1";
  await makeUser(testDb, "u1");
});

async function designRow(id: string) {
  return testDb.query.design.findFirst({ where: eq(schema.design.id, id) });
}

/** Minimal `image_generation` row in `running` status for `designId`. */
async function makeRunningJob(designId: string, userId: string) {
  await testDb.insert(schema.imageGeneration).values({
    designId,
    userId,
    status: "running",
    operation: "generate",
    imageId: crypto.randomUUID(),
    r2Key: "images/pending.png",
    generationNumber: 1,
    dayKey: "2026-09-09",
    startedAt: new Date(),
  });
}

/** A paid order whose HEADER points at `designId`, with no order_item line —
 * enough to block the design delete without pinning (and so blocking) the
 * image itself. */
async function makeHeaderOnlyOrder(designId: string, userId: string) {
  await testDb.insert(schema.order).values({
    userId,
    designId,
    totalPrice: 24.12,
    status: "paid",
  });
}

describe("deleting a conversation's last image removes the conversation", () => {
  it("(a) deletes the only image → the design row is gone, and the lane disappears from Studio", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/only.png",
    });

    await deleteDesignImage(d.id, imageId);

    expect(await designRow(d.id)).toBeUndefined();
    const lanes = await getStudioLanesData("u1", { db: testDb });
    expect(lanes.find((l) => l.designId === d.id)).toBeUndefined();
  });

  it("(b) deletes one of two images → the design and the other image both stay", async () => {
    const d = await makeDesign(testDb, "u1");
    const keep = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/keep.png",
    });
    const gone = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/gone.png",
    });

    await deleteDesignImage(d.id, gone);

    expect(await designRow(d.id)).toBeDefined();
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, keep))
    ).toHaveLength(1);
    const lanes = await getStudioLanesData("u1", { db: testDb });
    const lane = lanes.find((l) => l.designId === d.id);
    expect(lane).toBeDefined();
    expect(lane?.cells.map((c) => c.imageId)).toEqual([keep]);
  });

  it("(c) leaves the design alone when a generation job is still running for it", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/only.png",
    });
    await makeRunningJob(d.id, "u1");

    await deleteDesignImage(d.id, imageId);

    expect(await designRow(d.id)).toBeDefined();
    // The image itself is still gone — only the CONVERSATION removal is held
    // back by the running job.
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(0);
  });

  it("(d) archives (not deletes) a design an order references, and leaves the order intact", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/only.png",
    });
    await makeHeaderOnlyOrder(d.id, "u1");

    await deleteDesignImage(d.id, imageId);

    const row = await designRow(d.id);
    expect(row).toBeDefined();
    expect(row?.status).toBe("archived");
    expect(await testDb.select().from(schema.order)).toHaveLength(1);
  });

  it("(e) bulk deleteImages across two conversations removes only the one left empty", async () => {
    const emptied = await makeDesign(testDb, "u1");
    const emptiedImage = await makeSourceImage(testDb, {
      designId: emptied.id,
      ownerId: "u1",
      imageUrl: "https://img/emptied.png",
    });
    const kept = await makeDesign(testDb, "u1");
    const keptImageDeleted = await makeSourceImage(testDb, {
      designId: kept.id,
      ownerId: "u1",
      imageUrl: "https://img/kept-deleted.png",
    });
    const keptImageSurviving = await makeSourceImage(testDb, {
      designId: kept.id,
      ownerId: "u1",
      imageUrl: "https://img/kept-surviving.png",
    });

    const result = await deleteImages([emptiedImage, keptImageDeleted]);

    expect(result.deleted.sort()).toEqual([emptiedImage, keptImageDeleted].sort());
    expect(await designRow(emptied.id)).toBeUndefined();
    const keptRow = await designRow(kept.id);
    expect(keptRow).toBeDefined();
    expect(
      await testDb
        .select()
        .from(schema.image)
        .where(eq(schema.image.id, keptImageSurviving))
    ).toHaveLength(1);
  });

  it("(f) a cart line pinning the design's own last image survives the delete, along with the conversation and the cart line (#242 review finding 1, \"the cart contradiction\")", async () => {
    // Exercised through deleteDesignImage (the /design lightbox path), not
    // the library's bulk deleteImages: planImageDeletion's cart probe
    // (delete-image.ts) doesn't exclude the scope design's own cart line, so
    // this image resolves to a detach — its row is kept because the cart
    // line still needs it — rather than a delete. Only a design-scoped call
    // reaches executeImageDeletion at all for a detach outcome; deleteImages
    // is image-scoped and skips any non-"delete" outcome without touching
    // the DB (the library-view.ts docblock: "a detach here would be a
    // silent no-op"), so it can't exercise this path.
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/cart-pinned.png",
    });
    await testDb.insert(schema.cartItem).values({
      userId: "u1",
      designId: d.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "White",
      placements: { front: imageId },
    });

    await deleteDesignImage(d.id, imageId);

    // The image detaches — a cart line still needs it — so the row survives.
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(1);
    // Before the fix, the now-empty conversation fell straight through to
    // executeDesignDeletion, which unconditionally drops every cart_item row
    // FK-ing the design — including the very line the image detach was
    // protecting.
    expect(await designRow(d.id)).toBeDefined();
    expect(await testDb.select().from(schema.cartItem)).toHaveLength(1);
  });

  it("(g) an organizer product on the design keeps the conversation — not archived — after its last image is deleted", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/only.png",
    });
    // The design's own organizer sellable (product.designId = d.id) — not a
    // pin on the image itself, so the image's own plan is a plain "delete".
    await testDb.insert(schema.product).values({
      ownerId: "u1",
      designId: d.id,
      blankId: "bella-canvas-3001",
    });

    await deleteDesignImage(d.id, imageId);

    // Nothing keeps the image itself alive, so it's a real delete...
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(0);
    // ...but the conversation is left exactly as it was: archiving it would
    // falsify openConversation's documented invariant that "archived" only
    // ever means "was ordered" (#242 review finding 2), and the product
    // still needs a live design row to compose from.
    const row = await designRow(d.id);
    expect(row).toBeDefined();
    expect(row?.status).toBe("draft");
  });

  it("(h) deleteDesignImage reports designRemoved for a last-image delete", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://img/only.png",
    });

    const result = await deleteDesignImage(d.id, imageId);

    expect(result).toEqual({ designRemoved: "deleted" });
  });
});
