/**
 * Link-preview share cards for /d/[imageId]. The gate here is deliberately
 * stricter than the page's own `canViewImagePage`: the routes that consume
 * this are cached Route Handlers with no viewer identity, so "the owner can
 * see their own private work" must NOT hold. A private image has no share
 * card at all, and the link falls back to the site-wide branded one.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign, makeSourceImage } from "./factories";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { getImageShareCard, canShareImageCard } = await import("@/lib/image-share");

beforeEach(async () => {
  testDb = await createTestDb();
});

describe("canShareImageCard", () => {
  it("shares a published, unhidden image", () => {
    expect(canShareImageCard({ publishedAt: new Date(), isHidden: false })).toBe(true);
  });

  it("refuses an image that was never published", () => {
    expect(canShareImageCard({ publishedAt: null, isHidden: false })).toBe(false);
  });

  it("refuses an admin-hidden image even though it is published", () => {
    expect(canShareImageCard({ publishedAt: new Date(), isHidden: true })).toBe(false);
  });
});

describe("getImageShareCard", () => {
  type SeedOpts = Partial<Parameters<typeof makeSourceImage>[1]>;

  async function seed(overrides: SeedOpts = {}) {
    await makeUser(testDb, "nico");
    const design = await makeDesign(testDb, "nico");
    return makeSourceImage(testDb, {
      designId: design.id,
      ownerId: "nico",
      imageUrl: "https://r2.example/images/a.png",
      ...overrides,
    });
  }

  it("returns the artwork, title, designer and pinned backdrop", async () => {
    const imageId = await seed({
      publishedAt: new Date(),
      title: "Rocket Cat",
      backgroundColor: "Navy",
    });

    expect(await getImageShareCard(imageId)).toEqual({
      imageUrl: "https://r2.example/images/a.png",
      title: "Rocket Cat",
      designerName: "nico",
      backgroundColor: "Navy",
    });
  });

  it("keeps a null backdrop null — the White default is the renderer's job", async () => {
    const imageId = await seed({ publishedAt: new Date(), backgroundColor: null });
    expect((await getImageShareCard(imageId))?.backgroundColor).toBeNull();
  });

  it("has no card for an owner-private image", async () => {
    const imageId = await seed({ publishedAt: null });
    expect(await getImageShareCard(imageId)).toBeNull();
  });

  it("has no card for an admin-hidden image", async () => {
    const imageId = await seed({ publishedAt: new Date(), isHidden: true });
    expect(await getImageShareCard(imageId)).toBeNull();
  });

  it("has no card for an unknown id", async () => {
    expect(await getImageShareCard(crypto.randomUUID())).toBeNull();
  });
});
