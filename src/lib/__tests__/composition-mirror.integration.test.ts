/**
 * The image's mirror `product` row — the Shop composition
 * (docs/composition-first-class-plan.md §5). Every publish-family action
 * maintains it, and the backfill converts pre-slice-1 listings. Since the
 * slice-4 writer cutover it is the ONLY home of the sellable fields; the
 * listing row beside it is the visibility grant. Runs against a real
 * in-memory libSQL (#28), driving the server actions with db + auth mocked so
 * the batches actually run.
 *
 * Mirror contract: storeId NULL, designId NULL, blankId NULL, placements
 * exactly { front: imageId }, price NULL. Publish inserts (or revives a
 * draft), unpublish flips to draft (row kept), edits mirror through only on
 * non-draft rows. Never two mirrors for one image.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
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
const { planImageDeletion, executeImageDeletion } = await import(
  "@/lib/delete-image"
);

/** What the /design thread delete does to one image: plan scoped to that
 * conversation, then execute. Was deleteDesignImageRow before #195. */
async function deleteImageFromDesign(designId: string, imageId: string) {
  const plan = await planImageDeletion(testDb, imageId, { designId });
  return executeImageDeletion(testDb, plan);
}
const { backfillCompositionMirrors, verifyCompositionMirrors } = await import(
  "@/lib/composition-backfill"
);

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = "owner-1";
  await makeUser(testDb, "owner-1");
});

async function seedImage(params?: { publishedAt?: Date }) {
  const design = await makeDesign(testDb, "owner-1");
  const imageId = await makeSourceImage(testDb, {
    designId: design.id,
    ownerId: "owner-1",
    imageUrl: "https://img/pub.png",
    publishedAt: params?.publishedAt ?? null,
  });
  return { designId: design.id, imageId };
}

async function mirrorsOf(imageId: string) {
  const rows = await testDb
    .select()
    .from(schema.product)
    .where(
      and(isNull(schema.product.storeId), isNull(schema.product.designId))
    );
  return rows.filter((r) => {
    const entries = Object.entries(r.placements ?? {});
    return entries.length === 1 && entries[0][0] === "front" && entries[0][1] === imageId;
  });
}

describe("publish-family mirror writes", () => {
  it("publish creates the mirror product with the contract fields", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "T", backgroundColor: "Black" });

    const mirrors = await mirrorsOf(imageId);
    expect(mirrors).toHaveLength(1);
    const m = mirrors[0];
    expect(m.ownerId).toBe("owner-1");
    expect(m.storeId).toBeNull();
    expect(m.designId).toBeNull();
    expect(m.blankId).toBeNull();
    expect(m.placements).toEqual({ front: imageId });
    expect(m.price).toBeNull();
    expect(m.status).toBe("listed");
    expect(m.title).toBe("T");
    expect(m.description).toBeNull();
    expect(m.backdropColor).toBe("Black");
    expect(m.feedRank).toBeNull();
    // listedAt tracks the listing's publishedAt.
    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(m.listedAt?.getTime()).toBe(listing.publishedAt.getTime());
  });

  it("unpublish flips the mirror to draft and keeps the row", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    await unpublishImage(imageId);

    const mirrors = await mirrorsOf(imageId);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0].status).toBe("draft");
    // Listing is gone (existing semantics).
    expect(
      await testDb
        .select()
        .from(schema.listing)
        .where(eq(schema.listing.imageId, imageId))
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

  it("publish-family writes leave organizer products alone", async () => {
    // An organizer product that pins the same image must never be mistaken
    // for the mirror (it has a designId).
    const { designId, imageId } = await seedImage();
    await testDb.insert(schema.product).values({
      ownerId: "owner-1",
      designId,
      blankId: "bella-canvas-3001",
      placements: { front: imageId },
      status: "listed",
    });

    await publishImage(imageId, { title: "T" });
    await setImageHidden(imageId, true);
    await unpublishImage(imageId);

    const organizer = await testDb
      .select()
      .from(schema.product)
      .where(eq(schema.product.designId, designId));
    expect(organizer).toHaveLength(1);
    expect(organizer[0].status).toBe("listed");
    expect(organizer[0].title).toBeNull();
  });
});

describe("delete interactions", () => {
  it("deleteDesign removes the published image's mirror with it", async () => {
    const { designId, imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    expect(await mirrorsOf(imageId)).toHaveLength(1);

    await deleteDesign(designId);

    expect(await testDb.select().from(schema.image)).toHaveLength(0);
    expect(await testDb.select().from(schema.listing)).toHaveLength(0);
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

  it("the thread image delete deletes the mirror with the image", async () => {
    const { designId, imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });

    await deleteImageFromDesign(designId, imageId);

    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(0);
    expect(await testDb.select().from(schema.product)).toHaveLength(0);
  });

  it("the thread image delete still detaches when a real organizer product pins the image", async () => {
    const { designId, imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    const other = await makeDesign(testDb, "owner-1");
    await testDb.insert(schema.product).values({
      ownerId: "owner-1",
      designId: other.id,
      blankId: "bella-canvas-3001",
      placements: { front_large: imageId },
    });

    await deleteImageFromDesign(designId, imageId);

    // Image survives for the organizer product; mirror survives with it.
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(1);
    expect(await mirrorsOf(imageId)).toHaveLength(1);
  });
});

describe("backfill", () => {
  it("creates mirrors for listings without one, carrying fields over", async () => {
    const publishedAt = new Date("2026-06-01T00:00:00Z");
    const design = await makeDesign(testDb, "owner-1");
    const listed = await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "owner-1",
      imageUrl: "https://img/a.png",
      publishedAt,
      title: "Carried",
      description: "Kept",
      backgroundColor: "Navy",
      feedRank: 4,
      mirror: false,
    });
    const hidden = await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "owner-1",
      imageUrl: "https://img/b.png",
      publishedAt,
      isHidden: true,
      mirror: false,
    });

    const dry = await backfillCompositionMirrors(testDb, { apply: false });
    expect(dry).toMatchObject({
      listings: 2,
      mirrorsFound: 0,
      mirrorsCreated: 2,
    });
    // Dry run wrote nothing.
    expect(await testDb.select().from(schema.product)).toHaveLength(0);

    const applied = await backfillCompositionMirrors(testDb, { apply: true });
    expect(applied.mirrorsCreated).toBe(2);

    const [mListed] = await mirrorsOf(listed);
    expect(mListed.status).toBe("listed");
    expect(mListed.title).toBe("Carried");
    expect(mListed.description).toBe("Kept");
    expect(mListed.backdropColor).toBe("Navy");
    expect(mListed.feedRank).toBe(4);
    expect(mListed.listedAt?.getTime()).toBe(publishedAt.getTime());

    const [mHidden] = await mirrorsOf(hidden);
    expect(mHidden.status).toBe("hidden");

    expect(await verifyCompositionMirrors(testDb)).toEqual([]);
  });

  it("is idempotent — a second run finds everything and creates nothing", async () => {
    const { imageId } = await seedImage({ publishedAt: new Date() });
    await backfillCompositionMirrors(testDb, { apply: true });
    const second = await backfillCompositionMirrors(testDb, { apply: true });
    expect(second).toMatchObject({
      listings: 1,
      mirrorsFound: 1,
      mirrorsCreated: 0,
    });
    expect(await mirrorsOf(imageId)).toHaveLength(1);
  });

  it("skips dual-written listings (publish already made the mirror)", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "T" });
    const run = await backfillCompositionMirrors(testDb, { apply: true });
    expect(run).toMatchObject({ mirrorsFound: 1, mirrorsCreated: 0 });
    expect(await mirrorsOf(imageId)).toHaveLength(1);
  });

  it("verify ignores post-cutover sellable drift (the listing copies are frozen)", async () => {
    // A pre-cutover row: sellable fields on the listing, mirror built by the
    // backfill. Then an owner edits it — slice 4 writes the product only, so
    // the two copies now differ by design.
    const design = await makeDesign(testDb, "owner-1");
    const imageId = await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "owner-1",
      imageUrl: "https://img/legacy.png",
      publishedAt: new Date("2026-06-01T00:00:00Z"),
      title: "Old",
      backgroundColor: "Navy",
      feedRank: 2,
      mirror: false,
    });
    await backfillCompositionMirrors(testDb, { apply: true });

    await updatePublishedNaming(imageId, { title: "New", backgroundColor: "White" });
    await setImageFeedRank(imageId, 9);

    const [m] = await mirrorsOf(imageId);
    expect(m.title).toBe("New");
    expect(m.feedRank).toBe(9);
    const [l] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(l.title).toBe("Old"); // frozen, not rewritten

    expect(await verifyCompositionMirrors(testDb)).toEqual([]);
  });

  it("verify still catches a hidden-state or listedAt disagreement", async () => {
    const { imageId } = await seedImage({ publishedAt: new Date() });
    await backfillCompositionMirrors(testDb, { apply: true });
    expect(await verifyCompositionMirrors(testDb)).toEqual([]);

    // Poke the mirror out of agreement the way no writer ever would.
    const [m] = await mirrorsOf(imageId);
    await testDb
      .update(schema.product)
      .set({ status: "hidden", listedAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(schema.product.id, m.id));

    const problems = await verifyCompositionMirrors(testDb);
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toContain("status");
    expect(problems.join(" ")).toContain("listedAt");
  });

  it("reports a listing whose image row is missing instead of inserting", async () => {
    await testDb.insert(schema.listing).values({
      imageId: "ghost-image",
      publishedAt: new Date(),
    });
    const run = await backfillCompositionMirrors(testDb, { apply: true });
    expect(run.missingImageIds).toEqual(["ghost-image"]);
    expect(run.mirrorsCreated).toBe(0);
    expect(await testDb.select().from(schema.product)).toHaveLength(0);
  });
});
