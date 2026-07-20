/**
 * Back-design source groups + choke-point guard (#72), against a real
 * in-memory libSQL (the #28 pattern). Proves the picker's reach and the
 * checkout guard agree: everything the groups return passes
 * assertUsableBackImage; a stranger's unpublished or hidden image does not.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser } from "./factories";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

// vi.mock is hoisted; the getter defers db access until call time, by when
// beforeEach has assigned the per-test database.
vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const {
  getBackSourceGroups,
  getBuyPageBackSourceGroups,
  assertUsableBackImage,
} = await import("@/lib/back-sources");
const { getDesignImageById } = await import("@/lib/design-images");

async function makeDesignWithImage(
  db: Db,
  userId: string,
  opts: { published?: boolean; hidden?: boolean } = {}
): Promise<{ designId: string; imageId: string }> {
  const [design] = await db
    .insert(schema.design)
    .values({ userId })
    .returning();
  const [image] = await db
    .insert(schema.designImage)
    .values({
      designId: design.id,
      aspectRatio: "1:1",
      imageUrl: `https://img.example/${design.id}.png`,
      publishedAt: opts.published ? new Date() : null,
      isHidden: opts.hidden ?? false,
    })
    .returning();
  return { designId: design.id, imageId: image.id };
}

describe("getBackSourceGroups / assertUsableBackImage (#72)", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  async function seed() {
    await makeUser(testDb, "nico");
    await makeUser(testDb, "stranger");

    // Current thread: two source images, one of them published.
    const [d1] = await testDb
      .insert(schema.design)
      .values({ userId: "nico" })
      .returning();
    const [s1] = await testDb
      .insert(schema.designImage)
      .values({
        designId: d1.id,
        aspectRatio: "1:1",
        imageUrl: "https://img.example/s1.png",
      })
      .returning();
    const [s2] = await testDb
      .insert(schema.designImage)
      .values({
        designId: d1.id,
        aspectRatio: "1:1",
        imageUrl: "https://img.example/s2.png",
        publishedAt: new Date(),
      })
      .returning();

    // Another design of nico's, with a primary → My Designs.
    const [d2] = await testDb
      .insert(schema.design)
      .values({ userId: "nico" })
      .returning();
    const [p2] = await testDb
      .insert(schema.designImage)
      .values({
        designId: d2.id,
        aspectRatio: "1:1",
        imageUrl: "https://img.example/p2.png",
      })
      .returning();
    await testDb
      .update(schema.design)
      .set({ primaryImageId: p2.id })
      .where(eq(schema.design.id, d2.id));

    // Nico design with no primary → excluded from My Designs.
    await testDb.insert(schema.design).values({ userId: "nico" });

    // Stranger: one published (Shop), one hidden, one unpublished.
    const pub = await makeDesignWithImage(testDb, "stranger", {
      published: true,
    });
    const hidden = await makeDesignWithImage(testDb, "stranger", {
      published: true,
      hidden: true,
    });
    const priv = await makeDesignWithImage(testDb, "stranger", {});

    return { d1: d1.id, s1: s1.id, s2: s2.id, d2: d2.id, p2: p2.id, pub, hidden, priv };
  }

  it("returns the three groups, scoped and filtered", async () => {
    const ids = await seed();
    const groups = await getBackSourceGroups({
      designId: ids.d1,
      userId: "nico",
    });

    const byId = new Map(groups.map((g) => [g.id, g]));

    // This design: both thread sources, including the published one.
    expect(byId.get("this-design")?.images.map((i) => i.id).sort()).toEqual(
      [ids.s1, ids.s2].sort()
    );

    // My Designs: the other design's primary; not the current thread's, not
    // the primary-less design.
    expect(byId.get("my-designs")?.images.map((i) => i.id)).toEqual([ids.p2]);

    // Shop: the stranger's published image only — no hidden, no unpublished,
    // and not the current thread's published image (already in This design).
    expect(byId.get("shop")?.images.map((i) => i.id)).toEqual([
      ids.pub.imageId,
    ]);
  });

  it("anonymous users get no My Designs group", async () => {
    const ids = await seed();
    const groups = await getBackSourceGroups({
      designId: ids.d1,
      userId: null,
    });
    expect(groups.map((g) => g.id)).not.toContain("my-designs");
    expect(groups.map((g) => g.id)).toContain("this-design");
    expect(groups.map((g) => g.id)).toContain("shop");
  });

  it("everything the groups return passes the checkout guard", async () => {
    const ids = await seed();
    const groups = await getBackSourceGroups({
      designId: ids.d1,
      userId: "nico",
    });
    for (const g of groups) {
      for (const img of g.images) {
        await expect(
          assertUsableBackImage(img.id, ids.d1, "nico")
        ).resolves.toBeUndefined();
      }
    }
  });

  it("rejects a stranger's unpublished image at the choke point", async () => {
    const ids = await seed();
    await expect(
      assertUsableBackImage(ids.priv.imageId, ids.d1, "nico")
    ).rejects.toThrow("Back image is not available");
  });

  it("rejects a hidden image at the choke point", async () => {
    const ids = await seed();
    await expect(
      assertUsableBackImage(ids.hidden.imageId, ids.d1, "nico")
    ).rejects.toThrow("Back image is not available");
  });

  it("rejects an unknown image id", async () => {
    const ids = await seed();
    await expect(
      assertUsableBackImage("no-such-image", ids.d1, "nico")
    ).rejects.toThrow("Back image is not available");
  });

  it("allows the stranger's published image cross-user (Shop path)", async () => {
    const ids = await seed();
    await expect(
      assertUsableBackImage(ids.pub.imageId, ids.d1, "nico")
    ).resolves.toBeUndefined();
  });

  it("rejects a forged private image id from the SELLER's thread for a cross-owner buyer", async () => {
    // The /d buy case: the order's designId is the seller's design (d1 is
    // nico's). The stranger, buying nico's published s2, must not be able to
    // print nico's private s1 by forging its id — thread membership alone
    // grants nothing (canUseAsPlacementSource tightening).
    const ids = await seed();
    await expect(
      assertUsableBackImage(ids.s1, ids.d1, "stranger")
    ).rejects.toThrow("Back image is not available");
  });

  it("allows the seller's PUBLISHED thread image for a cross-owner buyer", async () => {
    const ids = await seed();
    await expect(
      assertUsableBackImage(ids.s2, ids.d1, "stranger")
    ).resolves.toBeUndefined();
  });

  it("the webhook's id resolver finds a cross-design back image", async () => {
    // Fulfillment resolves placements.back purely by design_image id
    // (getDesignImageById via resolveImageUrlById) with no design scoping, so
    // an order on design d1 whose back pins another design's image still
    // resolves to the right URL for the Printful submission.
    const ids = await seed();
    const row = await getDesignImageById(ids.pub.imageId);
    expect(row?.imageUrl).toBe(`https://img.example/${ids.pub.designId}.png`);
    expect(row?.designId).not.toBe(ids.d1);
  });
});

describe("getBuyPageBackSourceGroups (/d back picker)", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  async function seedBuyPage() {
    await makeUser(testDb, "seller");
    await makeUser(testDb, "buyer");

    // Seller's design being bought: one private + one published image.
    const [sold] = await testDb
      .insert(schema.design)
      .values({ userId: "seller" })
      .returning();
    const [privImg] = await testDb
      .insert(schema.designImage)
      .values({
        designId: sold.id,
        aspectRatio: "1:1",
        imageUrl: "https://img.example/priv.png",
      })
      .returning();
    const [pubImg] = await testDb
      .insert(schema.designImage)
      .values({
        designId: sold.id,
        aspectRatio: "1:1",
        imageUrl: "https://img.example/pub.png",
        publishedAt: new Date(),
      })
      .returning();

    // Buyer's own design with a primary → My Designs.
    const [mine] = await testDb
      .insert(schema.design)
      .values({ userId: "buyer" })
      .returning();
    const [mineImg] = await testDb
      .insert(schema.designImage)
      .values({
        designId: mine.id,
        aspectRatio: "1:1",
        imageUrl: "https://img.example/mine.png",
      })
      .returning();
    await testDb
      .update(schema.design)
      .set({ primaryImageId: mineImg.id })
      .where(eq(schema.design.id, mine.id));

    return {
      soldDesignId: sold.id,
      privImgId: privImg.id,
      pubImgId: pubImg.id,
      mineImgId: mineImg.id,
    };
  }

  it("a cross-owner buyer gets My Designs + Shop, never the seller's thread", async () => {
    const ids = await seedBuyPage();
    const groups = await getBuyPageBackSourceGroups({
      designId: ids.soldDesignId,
      viewerId: "buyer",
    });

    expect(groups.map((g) => g.id)).not.toContain("this-design");

    const byId = new Map(groups.map((g) => [g.id, g]));
    expect(byId.get("my-designs")?.images.map((i) => i.id)).toEqual([
      ids.mineImgId,
    ]);
    // Shop keeps the sold design's PUBLISHED image (no This-design group to
    // carry it) and never leaks the private one.
    expect(byId.get("shop")?.images.map((i) => i.id)).toEqual([ids.pubImgId]);
    const all = groups.flatMap((g) => g.images.map((i) => i.id));
    expect(all).not.toContain(ids.privImgId);
  });

  it("the owner viewing their own listing gets the /preview groups incl. This design", async () => {
    const ids = await seedBuyPage();
    const groups = await getBuyPageBackSourceGroups({
      designId: ids.soldDesignId,
      viewerId: "seller",
    });
    const byId = new Map(groups.map((g) => [g.id, g]));
    expect(byId.get("this-design")?.images.map((i) => i.id).sort()).toEqual(
      [ids.privImgId, ids.pubImgId].sort()
    );
  });

  it("everything the buy-page groups return passes the checkout guard for that buyer", async () => {
    const ids = await seedBuyPage();
    const groups = await getBuyPageBackSourceGroups({
      designId: ids.soldDesignId,
      viewerId: "buyer",
    });
    for (const g of groups) {
      for (const img of g.images) {
        await expect(
          assertUsableBackImage(img.id, ids.soldDesignId, "buyer")
        ).resolves.toBeUndefined();
      }
    }
  });

  it("returns no groups for an unknown design", async () => {
    await seedBuyPage();
    const groups = await getBuyPageBackSourceGroups({
      designId: "no-such-design",
      viewerId: "buyer",
    });
    expect(groups).toEqual([]);
  });
});
