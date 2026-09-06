/**
 * The image's `product` row — the Shop composition
 * (docs/composition-first-class-plan.md §5). Every publish-family action
 * maintains it; since the slice-4 writer cutover it is the ONLY home of the
 * sellable fields, and the `image_publication` row beside it is the
 * visibility grant. Runs against a real in-memory libSQL (#28), driving the
 * server actions with db + auth mocked so the batches actually run.
 *
 * Composition contract: blankId NULL, placements exactly { front: imageId },
 * price NULL, found by the generated `front_image_id` column. Publish inserts
 * (or revives a draft), unpublish flips to draft (row kept), edits mirror
 * through only on non-draft rows. Never two compositions for one front image
 * — DB-enforced by `product_front_image_unique` since composition slice 5.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign, makeSourceImage } from "./factories";
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
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: currentUserId, email: process.env.ADMIN_EMAIL },
      }),
    },
  },
  isAnonymousUser: () => false,
}));
vi.mock("@/lib/ai", () => ({
  generatePublishedNaming: async () => ({
    title: "Auto Title",
    description: "Auto Description",
  }),
}));

process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
process.env.RESEND_API_KEY ??= "re_dummy";
process.env.ADMIN_EMAIL = "owner@example.com";

const { publishImage, unpublishImage, updatePublishedNaming, deleteDesign } =
  await import("@/app/designs/actions");
const { setImageHidden, setImageFeedRank } = await import("@/app/admin/actions");
const { deleteDesignImageRow } = await import("@/lib/design-images");

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = "owner-1";
  await makeUser(testDb, "owner-1");
});

async function seedImage() {
  const design = await makeDesign(testDb, "owner-1");
  const imageId = await makeSourceImage(testDb, {
    designId: design.id,
    ownerId: "owner-1",
    imageUrl: "https://img/pub.png",
  });
  return { designId: design.id, imageId };
}

/** Every product row whose front slot is the image — the way readers find it. */
async function mirrorsOf(imageId: string) {
  return testDb
    .select()
    .from(schema.product)
    .where(eq(schema.product.frontImageId, imageId));
}

describe("publish-family mirror writes", () => {
  it("publish creates the mirror product with the contract fields", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "T", backgroundColor: "Black" });

    const mirrors = await mirrorsOf(imageId);
    expect(mirrors).toHaveLength(1);
    const m = mirrors[0];
    expect(m.ownerId).toBe("owner-1");
    expect(m.blankId).toBeNull();
    expect(m.placements).toEqual({ front: imageId });
    expect(m.price).toBeNull();
    expect(m.status).toBe("listed");
    expect(m.title).toBe("T");
    expect(m.description).toBeNull();
    expect(m.backdropColor).toBe("Black");
    expect(m.feedRank).toBeNull();
    // listedAt tracks the publication row's publishedAt.
    const [publication] = await testDb
      .select()
      .from(schema.imagePublication)
      .where(eq(schema.imagePublication.imageId, imageId));
    expect(m.listedAt?.getTime()).toBe(publication.publishedAt.getTime());
  });

  it("unpublish flips the mirror to draft and keeps the row", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    await unpublishImage(imageId);

    const mirrors = await mirrorsOf(imageId);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0].status).toBe("draft");
    // Publication row is gone (existing semantics).
    expect(
      await testDb
        .select()
        .from(schema.imagePublication)
        .where(eq(schema.imagePublication.imageId, imageId))
    ).toHaveLength(0);
  });

  it("re-publish after unpublish revives the mirror — no duplicate, fresh state", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "First", backgroundColor: "Black" });
    await setImageFeedRank(imageId, 7);
    const firstId = (await mirrorsOf(imageId))[0].id;

    await unpublishImage(imageId);
    await publishImage(imageId, { title: "Second", backgroundColor: "White" });

    const mirrors = await mirrorsOf(imageId);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0].id).toBe(firstId); // revived, not re-minted
    expect(mirrors[0].status).toBe("listed");
    expect(mirrors[0].title).toBe("Second");
    expect(mirrors[0].backdropColor).toBe("White");
    // Fresh-listing semantics: rank does not carry across a re-publish.
    expect(mirrors[0].feedRank).toBeNull();
  });

  it("naming/backdrop edits mirror through", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "T", backgroundColor: "Black" });
    await updatePublishedNaming(imageId, {
      title: "New",
      description: "Desc",
      backgroundColor: "Navy",
    });

    const [m] = await mirrorsOf(imageId);
    expect(m.title).toBe("New");
    expect(m.description).toBe("Desc");
    expect(m.backdropColor).toBe("Navy");
  });

  it("feedRank and hidden mirror through (hidden maps to status)", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });

    await setImageFeedRank(imageId, 3);
    expect((await mirrorsOf(imageId))[0].feedRank).toBe(3);

    await setImageHidden(imageId, true);
    expect((await mirrorsOf(imageId))[0].status).toBe("hidden");

    await setImageHidden(imageId, false);
    expect((await mirrorsOf(imageId))[0].status).toBe("listed");
  });

  it("edits on a draft mirror are a no-op (matching the absent listing)", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    await unpublishImage(imageId);

    // The listing is gone, so these no-op on it; the mirror must not be
    // resurrected out of draft either.
    await setImageHidden(imageId, false);
    await setImageFeedRank(imageId, 9);
    await updatePublishedNaming(imageId, { title: "Ghost" }).catch(() => {});

    const [m] = await mirrorsOf(imageId);
    expect(m.status).toBe("draft");
    expect(m.feedRank).toBeNull();
    expect(m.title).toBe("T");
  });

  it("a second composition for the same front image is rejected by the DB", async () => {
    // Composition slice 5: `product_front_image_unique` on the generated
    // front_image_id column. The publish path never gets here (it looks the
    // row up first and revives it), so this pins the constraint itself.
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });

    // Drizzle wraps the libSQL error ("Failed query: …"); the constraint
    // name is on the cause.
    const err = await testDb
      .insert(schema.product)
      .values({ ownerId: "owner-1", placements: { front: imageId } })
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).cause ?? err)).toMatch(
      /UNIQUE constraint failed: product\.front_image_id/
    );
    expect(await mirrorsOf(imageId)).toHaveLength(1);
  });
});

describe("delete interactions", () => {
  it("deleteDesign removes the published image's mirror with it", async () => {
    const { designId, imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    expect(await mirrorsOf(imageId)).toHaveLength(1);

    await deleteDesign(designId);

    expect(await testDb.select().from(schema.image)).toHaveLength(0);
    expect(await testDb.select().from(schema.imagePublication)).toHaveLength(0);
    // The mirror doesn't strand deletion and doesn't survive as an orphan.
    expect(await testDb.select().from(schema.product)).toHaveLength(0);
  });

  it("a Shop-bought image archives instead of deleting — the order FKs its mirror", async () => {
    // Composition slice 4 put order.store_product_id → product.id in play for
    // Shop sales, so deleting the mirror out from under a sold order would
    // trip that FK. The order guard fires first and archives the design.
    const { designId, imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    const [mirror] = await mirrorsOf(imageId);

    await makeUser(testDb, "buyer-1");
    const [order] = await testDb
      .insert(schema.order)
      .values({
        userId: "buyer-1",
        designId,
        totalPrice: 24.12,
        status: "paid",
        storeProductId: mirror.id,
      })
      .returning();
    await testDb.insert(schema.orderItem).values({
      orderId: order.id,
      designId,
      productId: "bella-canvas-3001",
      size: "L",
      color: "Black",
      placements: { front: imageId },
      itemPrice: 19.43,
    });

    await deleteDesign(designId);

    const [d] = await testDb
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, designId));
    expect(d.status).toBe("archived");
    expect(await mirrorsOf(imageId)).toHaveLength(1);
  });

  it("deleteDesign keeps the mirror of an image that survives (detached)", async () => {
    const { designId, imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    // Another conversation seed-links the image → it must survive the delete.
    const other = await makeDesign(testDb, "owner-1");
    await testDb.insert(schema.conversationImage).values({
      designId: other.id,
      imageId,
      role: "seed",
    });

    await deleteDesign(designId);

    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(1);
    expect(await mirrorsOf(imageId)).toHaveLength(1);
  });

  it("an unpublished-then-deleted image's draft mirror is deleted too", async () => {
    const { designId, imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    await unpublishImage(imageId);

    await deleteDesign(designId);

    expect(await testDb.select().from(schema.product)).toHaveLength(0);
  });

  it("deleteDesignImageRow deletes the mirror with the image", async () => {
    const { designId, imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });

    await deleteDesignImageRow(designId, imageId);

    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(0);
    expect(await testDb.select().from(schema.product)).toHaveLength(0);
  });

  it("deleteDesignImageRow still detaches when another composition pins the image", async () => {
    const { designId, imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    // A two-sided composition with this image on the back and another
    // conversation's image on the front — a real reference, unlike the
    // image's own front-only composition.
    const other = await makeDesign(testDb, "owner-1");
    const otherFront = await makeSourceImage(testDb, {
      designId: other.id,
      ownerId: "owner-1",
      imageUrl: "https://img/other-front.png",
    });
    await testDb.insert(schema.product).values({
      ownerId: "owner-1",
      blankId: "bella-canvas-3001",
      placements: { front: otherFront, back: imageId },
    });

    await deleteDesignImageRow(designId, imageId);

    // Image survives for the other composition; its own survives with it.
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(1);
    expect(await mirrorsOf(imageId)).toHaveLength(1);
  });
});
