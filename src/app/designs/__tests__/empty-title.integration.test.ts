/**
 * updatePublishedNaming's blank-title refusal. An owner could previously
 * save "" (the action persisted title.trim() with no non-empty check), which
 * rendered an empty <h1> and a blank labelled TITLE row for every viewer —
 * finding F3 of PR #224's review. Runs against a real in-memory libSQL (#28)
 * so the "writes nothing" half is checked against actual rows.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, isNull } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { EMPTY_TITLE_REJECTED, TITLE_TOO_LONG } from "@/lib/action-copy";
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
      getSession: async () => ({ user: { id: currentUserId } }),
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

const { publishImage, updatePublishedNaming } = await import(
  "@/app/designs/actions"
);

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = "u1";
  await makeUser(testDb, "u1");
});

/** Publish an image so there is a listing + mirror product to edit. */
async function publishedImage() {
  const d = await makeDesign(testDb, "u1");
  const imageId = await makeSourceImage(testDb, {
    designId: d.id,
    ownerId: "u1",
    imageUrl: "https://r2/images/a.png",
  });
  await publishImage(imageId, { title: "Real Title" });
  return imageId;
}

/**
 * The mirror `product` row for a published image isn't keyed by imageId
 * directly (composition slice 1: `product.placements` is a JSON
 * `{ front: imageId }` map) — mirrors `setPublication`'s lookup in
 * factories.ts, which is the only existing precedent for reading a mirror
 * row by image. The brief's draft used a nonexistent `product.imageId`
 * column; corrected here.
 */
async function mirrorRow(imageId: string) {
  const rows = await testDb
    .select({
      id: schema.product.id,
      title: schema.product.title,
      description: schema.product.description,
      placements: schema.product.placements,
    })
    .from(schema.product)
    .where(and(isNull(schema.product.storeId), isNull(schema.product.designId)));
  return rows.find((r) => (r.placements ?? {}).front === imageId) ?? null;
}

async function mirrorTitle(imageId: string) {
  return (await mirrorRow(imageId))?.title ?? null;
}

describe("updatePublishedNaming — blank titles", () => {
  it("refuses an empty title and leaves the stored title untouched", async () => {
    const imageId = await publishedImage();
    const result = await updatePublishedNaming(imageId, { title: "" });
    expect(result).toEqual({ error: EMPTY_TITLE_REJECTED });
    expect(await mirrorTitle(imageId)).toBe("Real Title");
  });

  it("refuses a whitespace-only title", async () => {
    const imageId = await publishedImage();
    const result = await updatePublishedNaming(imageId, { title: "   " });
    expect(result).toEqual({ error: EMPTY_TITLE_REJECTED });
    expect(await mirrorTitle(imageId)).toBe("Real Title");
  });

  it("refuses a title longer than 80 characters and leaves the stored title untouched", async () => {
    const imageId = await publishedImage();
    const tooLong = "a".repeat(81);
    const result = await updatePublishedNaming(imageId, { title: tooLong });
    expect(result).toEqual({ error: TITLE_TOO_LONG });
    expect(await mirrorTitle(imageId)).toBe("Real Title");
  });

  it("saves a title that is exactly 80 characters", async () => {
    const imageId = await publishedImage();
    const exactly80 = "b".repeat(80);
    const result = await updatePublishedNaming(imageId, { title: exactly80 });
    expect(result).toEqual({});
    expect(await mirrorTitle(imageId)).toBe(exactly80);
  });

  it("still saves a real title, trimmed", async () => {
    const imageId = await publishedImage();
    const result = await updatePublishedNaming(imageId, { title: "  New  " });
    expect(result).toEqual({});
    expect(await mirrorTitle(imageId)).toBe("New");
  });

  it("still saves a backdrop-only edit, which sends no title at all", async () => {
    const imageId = await publishedImage();
    const result = await updatePublishedNaming(imageId, {
      backgroundColor: "Black",
    });
    expect(result).toEqual({});
    expect(await mirrorTitle(imageId)).toBe("Real Title");
  });

  it("still allows clearing the description, which is not a title", async () => {
    const imageId = await publishedImage();
    // Give the mirror row a real description first, so clearing it is a
    // meaningful check rather than a no-op that would pass either way.
    await updatePublishedNaming(imageId, { description: "A real description." });
    expect((await mirrorRow(imageId))?.description).toBe("A real description.");

    const result = await updatePublishedNaming(imageId, { description: "" });
    expect(result).toEqual({});
    expect((await mirrorRow(imageId))?.description).toBe("");
  });
});
