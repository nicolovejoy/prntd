/**
 * Integration test for getUserImageLibrary (the My Designs grid, studio-plan
 * slice 5) against a real (in-memory) libSQL DB. Replaces the coverage of the
 * retired getUserDesignsData card query — My Designs lists images now, so the
 * unit under test is the image query, but the same three questions are asked:
 * owner isolation, what shows, and what is hidden.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import { getUserImageLibrary } from "@/lib/user-designs";

type Db = Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  h.db = await createTestDb();
  await makeUser(h.db as Db, "owner");
});

describe("getUserImageLibrary", () => {
  it("lists every image the user owns, newest first", async () => {
    const db = h.db as Db;
    const first = await makeDesign(db, "owner");
    const older = await makeSourceImage(db, {
      designId: first.id,
      ownerId: "owner",
      imageUrl: "https://r2/older.png",
      createdAt: new Date("2026-08-01T00:00:00Z"),
    });
    // A second conversation: the grid is flat, so both threads' images sit
    // side by side ordered only by age.
    const second = await makeDesign(db, "owner");
    const newer = await makeSourceImage(db, {
      designId: second.id,
      ownerId: "owner",
      imageUrl: "https://r2/newer.png",
      createdAt: new Date("2026-08-02T00:00:00Z"),
    });

    const images = await getUserImageLibrary("owner");
    expect(images.map((i) => i.imageId)).toEqual([newer, older]);
    expect(images[0].imageUrl).toBe("https://r2/newer.png");
    expect(images[0].sourceDesignId).toBe(second.id);
    expect(images[0].isPublished).toBe(false);
    expect(images[0].isArchived).toBe(false);
  });

  it("does not return other users' images", async () => {
    const db = h.db as Db;
    await makeUser(db, "someone-else");
    const theirs = await makeDesign(db, "someone-else");
    await makeSourceImage(db, {
      designId: theirs.id,
      ownerId: "someone-else",
      imageUrl: "https://r2/theirs.png",
    });

    expect(await getUserImageLibrary("owner")).toEqual([]);
  });

  it("marks published images and carries their backdrop", async () => {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://r2/published.png",
      publishedAt: new Date("2026-07-01T00:00:00Z"),
      backgroundColor: "Navy",
    });

    const [image] = await getUserImageLibrary("owner");
    expect(image.isPublished).toBe(true);
    expect(image.backgroundColor).toBe("Navy");
  });

  it("marks images whose conversation has been archived out of the Studio", async () => {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://r2/closed.png",
    });
    await db
      .update(schema.design)
      .set({ closedAt: new Date("2026-08-30T00:00:00Z") })
      .where(eq(schema.design.id, design.id));

    const [image] = await getUserImageLibrary("owner");
    expect(image.isArchived).toBe(true);
  });

  it("keeps images whose conversation was archived away (status), marked", async () => {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://r2/ordered-then-archived.png",
    });
    // What deleteDesign leaves behind for an ordered design. The library is
    // the record of what the user made, and this is the only route back to
    // reordering it.
    await db
      .update(schema.design)
      .set({ status: "archived" })
      .where(eq(schema.design.id, design.id));

    const images = await getUserImageLibrary("owner");
    expect(images).toHaveLength(1);
    expect(images[0].isArchived).toBe(true);
  });

  it("keeps an ordered design's images, unmarked", async () => {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://r2/ordered.png",
    });
    await db
      .update(schema.design)
      .set({ status: "ordered" })
      .where(eq(schema.design.id, design.id));

    const images = await getUserImageLibrary("owner");
    expect(images).toHaveLength(1);
    expect(images[0].isArchived).toBe(false);
  });

  it("marks an image that is both published and archived", async () => {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://r2/both.png",
      publishedAt: new Date("2026-07-01T00:00:00Z"),
      backgroundColor: "Navy",
    });
    await db
      .update(schema.design)
      .set({ closedAt: new Date("2026-08-30T00:00:00Z") })
      .where(eq(schema.design.id, design.id));

    const [image] = await getUserImageLibrary("owner");
    expect(image.isPublished).toBe(true);
    expect(image.isArchived).toBe(true);
  });

  it("keeps a legacy image with no source conversation", async () => {
    const db = h.db as Db;
    await db.insert(schema.image).values({
      id: "legacy-image",
      ownerId: "owner",
      imageUrl: "https://r2/legacy.png",
      aspectRatio: "1:1",
      sourceDesignId: null,
    });

    const [image] = await getUserImageLibrary("owner");
    expect(image.imageId).toBe("legacy-image");
    expect(image.sourceDesignId).toBeNull();
    expect(image.isArchived).toBe(false);
  });
});
