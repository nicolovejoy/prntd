/**
 * Integration test for getUserDesignsData (the /designs card list) against a
 * real (in-memory) libSQL DB — coverage ported from the retired
 * getUserDesigns server action when the query moved to src/lib for the
 * server-component render.
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

import { getUserDesignsData } from "@/lib/user-designs";

type Db = Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  h.db = await createTestDb();
  await makeUser(h.db as Db, "owner");
});

describe("getUserDesignsData", () => {
  it("lists the user's designs with thumbnails, excluding archived", async () => {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    const imageId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://r2/current.png",
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: imageId })
      .where(eq(schema.design.id, design.id));

    const archived = await makeDesign(db, "owner");
    await db
      .update(schema.design)
      .set({ status: "archived" })
      .where(eq(schema.design.id, archived.id));

    const designs = await getUserDesignsData("owner");
    expect(designs).toHaveLength(1);
    expect(designs[0].id).toBe(design.id);
    expect(designs[0].imageUrl).toBe("https://r2/current.png");
    expect(designs[0].primaryImagePublishedAt).toBeNull();
  });

  it("surfaces publish state + backdrop for a published primary image", async () => {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    const publishedAt = new Date("2026-07-01T00:00:00Z");
    const imageId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://r2/published.png",
      publishedAt,
      backgroundColor: "Navy",
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: imageId })
      .where(eq(schema.design.id, design.id));

    const [d] = await getUserDesignsData("owner");
    expect(d.primaryImagePublishedAt).toEqual(publishedAt);
    expect(d.primaryImageBackgroundColor).toBe("Navy");
  });

  it("does not return other users' designs", async () => {
    const db = h.db as Db;
    await makeUser(db, "someone-else");
    await makeDesign(db, "someone-else");

    expect(await getUserDesignsData("owner")).toEqual([]);
  });
});
