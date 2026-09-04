/**
 * Link-preview share cards for /d/[imageId]. The gate here is deliberately
 * stricter than the page's own `canViewImagePage`: the routes that consume
 * this are cached Route Handlers with no viewer identity, so "the owner can
 * see their own private work" must NOT hold. A private image has no share
 * card at all, and the link falls back to the site-wide branded one.
 *
 * Composition slice 2: title/backdrop and the publish state now come off the
 * image's mirror `product` row, so two cases below deliberately set the
 * listing and the mirror to different values to pin which one is read.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign, makeSourceImage } from "./factories";
import * as schema from "@/lib/db/schema";

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

  it("reads the mirror product's title and backdrop, not the listing's", async () => {
    const imageId = await seed({
      publishedAt: new Date(),
      title: "Listing Title",
      backgroundColor: "Red",
    });
    // Diverge the two halves: the mirror is what the card must follow.
    await testDb
      .update(schema.product)
      .set({ title: "Product Title", backdropColor: "Navy" })
      .where(eq(schema.product.title, "Listing Title"));

    expect(await getImageShareCard(imageId)).toMatchObject({
      title: "Product Title",
      backgroundColor: "Navy",
    });
  });

  it("has no card once the mirror is hidden, even with the listing still visible", async () => {
    const imageId = await seed({ publishedAt: new Date(), title: "Rocket Cat" });
    await testDb
      .update(schema.product)
      .set({ status: "hidden" })
      .where(eq(schema.product.title, "Rocket Cat"));

    expect(await getImageShareCard(imageId)).toBeNull();
  });

  it("has no card once the mirror is a draft (unpublished)", async () => {
    const imageId = await seed({ publishedAt: new Date(), title: "Rocket Cat" });
    await testDb
      .update(schema.product)
      .set({ status: "draft" })
      .where(eq(schema.product.title, "Rocket Cat"));

    expect(await getImageShareCard(imageId)).toBeNull();
  });
});
