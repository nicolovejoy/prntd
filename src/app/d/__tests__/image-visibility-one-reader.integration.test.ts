// @vitest-environment node
/**
 * #289 item 4: `image_publication` (published_at, is_hidden) is the one
 * reader of image visibility. Each reader below is driven with a `product`
 * mirror whose status disagrees with the publication row, so a reader that
 * still follows the mirror fails.
 *
 * Real in-memory libSQL; db and session mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;
let currentUserId: string | null;

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
      getSession: async () =>
        currentUserId
          ? { user: { id: currentUserId, email: "admin@example.com" } }
          : null,
    },
  },
  isAnonymousUser: () => false,
}));

process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
process.env.RESEND_API_KEY ??= "re_dummy";
process.env.ADMIN_EMAIL = "admin@example.com";

const { getImagePage } = await import("@/app/d/actions");
const { getImageShareCard } = await import("@/lib/image-share");
const { getRecentPublishedForAdmin } = await import("@/app/admin/actions");

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = null;
  await makeUser(testDb, "owner");
  await makeUser(testDb, "viewer");
});

async function seed(opts: { publishedAt?: Date | null; isHidden?: boolean; title?: string } = {}) {
  const design = await makeDesign(testDb, "owner");
  return makeSourceImage(testDb, {
    designId: design.id,
    ownerId: "owner",
    imageUrl: "https://img.example/a.png",
    publishedAt: opts.publishedAt === undefined ? new Date("2026-01-01T00:00:00Z") : opts.publishedAt,
    isHidden: opts.isHidden ?? false,
    title: opts.title ?? "Tiger",
  });
}

async function patchMirror(imageId: string, set: Partial<typeof schema.product.$inferInsert>) {
  await testDb.update(schema.product).set(set).where(eq(schema.product.frontImageId, imageId));
}
async function patchPublication(imageId: string, set: Partial<typeof schema.imagePublication.$inferInsert>) {
  await testDb
    .update(schema.imagePublication)
    .set(set)
    .where(eq(schema.imagePublication.imageId, imageId));
}

describe("getImagePage reads visibility from image_publication", () => {
  it("hidden publication + mirror still 'listed': a stranger gets nothing", async () => {
    const imageId = await seed();
    await patchPublication(imageId, { isHidden: true });
    await patchMirror(imageId, { status: "listed" });
    currentUserId = "viewer";
    expect(await getImagePage(imageId)).toBeNull();
  });

  it("visible publication + mirror 'hidden': the page is served to a stranger", async () => {
    const imageId = await seed();
    await patchMirror(imageId, { status: "hidden" });
    currentUserId = "viewer";
    const page = await getImagePage(imageId);
    expect(page).not.toBeNull();
    expect(page!.publishedAt).toBeInstanceOf(Date);
  });

  it("publication row and no mirror product: published", async () => {
    const imageId = await seed();
    await testDb.delete(schema.product).where(eq(schema.product.frontImageId, imageId));
    currentUserId = "viewer";
    const page = await getImagePage(imageId);
    expect(page).not.toBeNull();
    expect(page!.publishedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(page!.title).toBeNull();
  });

  it("no publication row beside a 'listed' mirror: unpublished, not served to a stranger", async () => {
    const imageId = await seed();
    await testDb
      .delete(schema.imagePublication)
      .where(eq(schema.imagePublication.imageId, imageId));
    currentUserId = "viewer";
    expect(await getImagePage(imageId)).toBeNull();
  });

  it("publishedAt is the publication's, not the mirror's listedAt", async () => {
    const imageId = await seed();
    await patchMirror(imageId, { listedAt: new Date("2030-05-05T00:00:00Z") });
    currentUserId = "viewer";
    const page = await getImagePage(imageId);
    expect(page!.publishedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("the fork chain stops at a parent the publication row hides, whatever the mirror says", async () => {
    const parent = await seed({ title: "Parent" });
    const design = await makeDesign(testDb, "owner");
    const child = await makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://img.example/child.png",
      seedImageId: parent,
      publishedAt: new Date("2026-02-01T00:00:00Z"),
      title: "Child",
    });
    currentUserId = "viewer";
    expect((await getImagePage(child))!.forkChain.map((e) => e.imageId)).toEqual([parent]);

    await patchPublication(parent, { isHidden: true });
    await patchMirror(parent, { status: "listed" });
    expect((await getImagePage(child))!.forkChain).toEqual([]);
  });
});

describe("getImageShareCard reads visibility from image_publication", () => {
  it("no card for a hidden publication even if the mirror is listed", async () => {
    const imageId = await seed();
    await patchPublication(imageId, { isHidden: true });
    await patchMirror(imageId, { status: "listed" });
    expect(await getImageShareCard(imageId)).toBeNull();
  });

  it("a card for a visible publication even if the mirror says hidden", async () => {
    const imageId = await seed();
    await patchMirror(imageId, { status: "hidden" });
    expect((await getImageShareCard(imageId))?.title).toBe("Tiger");
  });
});

describe("the admin published grid reads visibility from image_publication", () => {
  it("isHidden follows the publication row, not the mirror", async () => {
    currentUserId = "viewer";
    const imageId = await seed();
    await patchMirror(imageId, { status: "hidden" });
    expect((await getRecentPublishedForAdmin())[0].isHidden).toBe(false);

    await patchMirror(imageId, { status: "listed" });
    await patchPublication(imageId, { isHidden: true });
    const row = (await getRecentPublishedForAdmin())[0];
    expect(row.isHidden).toBe(true);
    expect(row.publishedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
  });
});
