/**
 * Composition slice 2 (docs/composition-first-class-plan.md §5): the four
 * "job A" sellable surfaces read from the image's mirror `product` row, not
 * its `listing` row.
 *
 * The tests drive the REAL publish-family actions against a real in-memory
 * libSQL (#28), then assert each reader returns the product-sourced values.
 * To prove the readers are actually on `product`, several cases mutate the
 * mirror or the listing directly and check which one the reader follows.
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
    description: null,
  }),
}));

process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
process.env.RESEND_API_KEY ??= "re_dummy";
process.env.ADMIN_EMAIL = "owner@example.com";

const { publishImage, unpublishImage, updatePublishedNaming } = await import(
  "@/app/designs/actions"
);
const { setImageHidden, setImageFeedRank, getRecentPublishedForAdmin } =
  await import("@/app/admin/actions");
const { getImagePage } = await import("@/app/d/actions");
const { getPublishedFeed } = await import("@/lib/discover-feed");
const { getUserDesignsData } = await import("@/lib/user-designs");
const { getDesign, setPrimaryImage } = await import("@/app/design/actions");
const { loadLineIdentityContext, buildLineIdentities } = await import(
  "@/lib/order-line-identity"
);

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = "owner-1";
  await makeUser(testDb, "owner-1");
});

async function seedImage(imageUrl = "https://img/pub.png") {
  const design = await makeDesign(testDb, "owner-1");
  const imageId = await makeSourceImage(testDb, {
    designId: design.id,
    ownerId: "owner-1",
    imageUrl,
  });
  return { designId: design.id, imageId };
}

/** Direct write to the image's mirror product row (bypasses the dual-write). */
async function patchMirror(
  imageId: string,
  set: Partial<typeof schema.product.$inferInsert>
) {
  const rows = await testDb
    .select()
    .from(schema.product)
    .where(and(isNull(schema.product.storeId), isNull(schema.product.designId)));
  const mirror = rows.find((r) => (r.placements ?? {}).front === imageId);
  if (!mirror) throw new Error("no mirror to patch");
  await testDb
    .update(schema.product)
    .set(set)
    .where(eq(schema.product.id, mirror.id));
}

/** Direct write to the image's listing row (bypasses the dual-write). */
async function patchListing(
  imageId: string,
  set: Partial<typeof schema.listing.$inferInsert>
) {
  await testDb
    .update(schema.listing)
    .set(set)
    .where(eq(schema.listing.imageId, imageId));
}

describe("feed reads the mirror product", () => {
  it("returns the published image with product-sourced sellable fields", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });

    const feed = await getPublishedFeed();
    expect(feed).toHaveLength(1);
    expect(feed[0].imageId).toBe(imageId);
    expect(feed[0].title).toBe("Tiger");
    expect(feed[0].backgroundColor).toBe("Black");
    expect(feed[0].publishedAt).toBeInstanceOf(Date);
  });

  it("follows the product title, not the listing title", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await patchMirror(imageId, { title: "Product Title" });
    await testDb
      .update(schema.listing)
      .set({ title: "Listing Title" })
      .where(eq(schema.listing.imageId, imageId));

    const feed = await getPublishedFeed();
    expect(feed[0].title).toBe("Product Title");
  });

  it("drops a hidden image and brings it back on unhide", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });

    await setImageHidden(imageId, true);
    expect(await getPublishedFeed()).toHaveLength(0);

    await setImageHidden(imageId, false);
    expect(await getPublishedFeed()).toHaveLength(1);
  });

  it("drops an unpublished image (mirror goes draft)", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await unpublishImage(imageId);

    expect(await getPublishedFeed()).toHaveLength(0);
  });

  it("orders by the product feed rank, ranked before unranked", async () => {
    const a = await seedImage("https://img/a.png");
    const b = await seedImage("https://img/b.png");
    const c = await seedImage("https://img/c.png");
    for (const s of [a, b, c]) {
      await publishImage(s.imageId, { title: "t", backgroundColor: "Black" });
    }
    await setImageFeedRank(c.imageId, 1);
    await setImageFeedRank(b.imageId, 2);

    const feed = await getPublishedFeed();
    expect(feed.map((r) => r.imageId)).toEqual([
      c.imageId,
      b.imageId,
      a.imageId,
    ]);
  });

  it("ignores organizer products that happen to have no store", async () => {
    const { imageId, designId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    // A loose organizer product: storeId null (not shelved yet) but designId
    // set — listed, and pointing at the same image.
    await testDb.insert(schema.product).values({
      ownerId: "owner-1",
      storeId: null,
      designId,
      blankId: "bella-canvas-3001",
      placements: { front: imageId },
      status: "listed",
      title: "Organizer Item",
      listedAt: new Date(),
    });

    const feed = await getPublishedFeed();
    expect(feed).toHaveLength(1);
    expect(feed[0].title).toBe("Tiger");
  });
});

describe("getImagePage reads the mirror product", () => {
  it("returns product-sourced fields for a published image", async () => {
    const { imageId, designId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await updatePublishedNaming(imageId, { description: "A tiger" });

    const page = await getImagePage(imageId);
    expect(page).not.toBeNull();
    expect(page!.title).toBe("Tiger");
    expect(page!.description).toBe("A tiger");
    expect(page!.backgroundColor).toBe("Black");
    expect(page!.publishedAt).toBeInstanceOf(Date);
    expect(page!.sourceDesignId).toBe(designId);
  });

  it("follows the product backdrop, not the listing backdrop", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await patchMirror(imageId, { backdropColor: "Navy" });
    await testDb
      .update(schema.listing)
      .set({ backgroundColor: "Red" })
      .where(eq(schema.listing.imageId, imageId));

    expect((await getImagePage(imageId))!.backgroundColor).toBe("Navy");
  });

  it("still returns an unpublished image to its owner, with null publish fields", async () => {
    const { imageId } = await seedImage();

    const page = await getImagePage(imageId);
    expect(page).not.toBeNull();
    expect(page!.publishedAt).toBeNull();
    expect(page!.title).toBeNull();
    expect(page!.backgroundColor).toBeNull();
  });

  it("404s an unpublished image for a non-owner", async () => {
    const { imageId } = await seedImage();
    await makeUser(testDb, "someone-else");
    currentUserId = "someone-else";

    expect(await getImagePage(imageId)).toBeNull();
  });

  it("404s a hidden image (mirror status drives the guard)", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await setImageHidden(imageId, true);

    expect(await getImagePage(imageId)).toBeNull();
  });

  it("falls back to createdAt when a published mirror has no listedAt", async () => {
    // The one publish-timestamp rule (composition-reads.mirrorPublishedAt):
    // the feed and /d must agree, or an image lists in the Shop and 404s on
    // its own page for everyone but the owner.
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await patchMirror(imageId, { listedAt: null });
    await makeUser(testDb, "someone-else");
    currentUserId = "someone-else";

    const page = await getImagePage(imageId);
    expect(page).not.toBeNull();
    expect(page!.publishedAt).toBeInstanceOf(Date);
    expect(await getPublishedFeed()).toHaveLength(1);
  });

  it("treats a draft mirror as unpublished after unpublish", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await unpublishImage(imageId);

    const page = await getImagePage(imageId);
    expect(page).not.toBeNull(); // owner still sees it
    expect(page!.publishedAt).toBeNull();
    expect(page!.title).toBeNull();
  });
});

describe("admin published grid reads the mirror product", () => {
  it("lists published images with product title, rank and hidden state", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await setImageFeedRank(imageId, 3);
    // Diverge every mirrored field so the row can only have come from the
    // product; on the pre-swap reader each assertion below reads the listing.
    await patchMirror(imageId, { title: "Product Title", feedRank: 7 });
    await patchListing(imageId, { title: "Listing Title", feedRank: 3 });

    const rows = await getRecentPublishedForAdmin();
    expect(rows).toHaveLength(1);
    expect(rows[0].imageId).toBe(imageId);
    expect(rows[0].title).toBe("Product Title");
    expect(rows[0].feedRank).toBe(7);
    expect(rows[0].isHidden).toBe(false);
    expect(rows[0].publishedAt).toBeInstanceOf(Date);

    // Hidden state too: the mirror says hidden, the listing says visible.
    await patchMirror(imageId, { status: "hidden" });
    await patchListing(imageId, { isHidden: false });
    const hidden = await getRecentPublishedForAdmin();
    expect(hidden).toHaveLength(1);
    expect(hidden[0].isHidden).toBe(true);
  });

  it("drops an image whose mirror is a draft, even with the listing intact", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    // Only the mirror is retired — the listing row stays, so a pre-swap
    // reader would still list this image.
    await patchMirror(imageId, { status: "draft" });

    expect(await getRecentPublishedForAdmin()).toHaveLength(0);
  });

  it("drops an unpublished image from the grid", async () => {
    const { imageId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await unpublishImage(imageId);

    expect(await getRecentPublishedForAdmin()).toHaveLength(0);
  });
});

describe("My Designs backdrop reads the mirror product", () => {
  it("follows the product backdrop while publish state stays on the listing", async () => {
    const { designId, imageId } = await seedImage();
    await setPrimaryImage(designId, imageId);
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await patchMirror(imageId, { backdropColor: "Navy" });
    await patchListing(imageId, { backgroundColor: "Red" });

    const designs = await getUserDesignsData(currentUserId);
    const card = designs.find((d) => d.id === designId);
    expect(card!.primaryImageBackgroundColor).toBe("Navy");
    // Publish state is job B and still comes off the listing.
    expect(card!.primaryImagePublishedAt).toBeInstanceOf(Date);
  });

  it("shows no backdrop once the mirror is a draft", async () => {
    const { designId, imageId } = await seedImage();
    await setPrimaryImage(designId, imageId);
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await patchMirror(imageId, { status: "draft" });

    const designs = await getUserDesignsData(currentUserId);
    const card = designs.find((d) => d.id === designId);
    expect(card!.primaryImageBackgroundColor).toBeNull();
  });
});

describe("getDesign backdrop reads the mirror product", () => {
  it("follows the product backdrop, not the listing backdrop", async () => {
    const { designId, imageId } = await seedImage();
    await setPrimaryImage(designId, imageId);
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await patchMirror(imageId, { backdropColor: "Navy" });
    await patchListing(imageId, { backgroundColor: "Red" });

    expect((await getDesign(designId))!.backgroundColor).toBe("Navy");
  });

  it("drops the pinned backdrop once the mirror is a draft", async () => {
    const { designId, imageId } = await seedImage();
    await setPrimaryImage(designId, imageId);
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    // Listing untouched: a pre-swap reader would still return "Black".
    await patchMirror(imageId, { status: "draft" });

    expect((await getDesign(designId))!.backgroundColor).toBeNull();
  });
});

describe("order-line titles read the mirror product", () => {
  it("names a line from the pinned image's product title", async () => {
    const { imageId, designId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await patchMirror(imageId, { title: "Product Title" });
    await testDb
      .update(schema.listing)
      .set({ title: "Listing Title" })
      .where(eq(schema.listing.imageId, imageId));

    const lines = [{ designId, placements: { front: imageId } }];
    const ctx = await loadLineIdentityContext(testDb, lines);
    expect(buildLineIdentities(lines, ctx)[0].title).toBe("Product Title");
  });

  it("leaves the title null for an unpublished pinned image", async () => {
    const { imageId, designId } = await seedImage();

    const lines = [{ designId, placements: { front: imageId } }];
    const ctx = await loadLineIdentityContext(testDb, lines);
    expect(buildLineIdentities(lines, ctx)[0].title).toBeNull();
  });

  it("leaves the title null once the image is unpublished (draft mirror)", async () => {
    const { imageId, designId } = await seedImage();
    await publishImage(imageId, { title: "Tiger", backgroundColor: "Black" });
    await unpublishImage(imageId);

    const lines = [{ designId, placements: { front: imageId } }];
    const ctx = await loadLineIdentityContext(testDb, lines);
    expect(buildLineIdentities(lines, ctx)[0].title).toBeNull();
  });
});
