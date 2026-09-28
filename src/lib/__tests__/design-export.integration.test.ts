/**
 * loadExportRows against a real (in-memory) libSQL DB: owner isolation, the
 * same rows and order as the My Designs library, legacy key resolution.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import {
  makeUser,
  makeDesign,
  makeSourceImage,
} from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import { getUserImageLibrary } from "@/lib/user-designs";
import { exportObjectKey, loadExportRows } from "@/lib/design-export";

type Db = Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  h.db = await createTestDb();
  await makeUser(h.db as Db, "owner");
});

describe("loadExportRows", () => {
  it("returns the caller's images and none of another user's", async () => {
    const db = h.db as Db;
    await makeUser(db, "other");
    const mine = await makeDesign(db, "owner");
    const theirs = await makeDesign(db, "other");
    const mineId = await makeSourceImage(db, {
      designId: mine.id,
      ownerId: "owner",
      imageUrl: "https://r2/mine.png",
      prompt: "a fox",
      aspectRatio: "3:4",
    });
    await makeSourceImage(db, {
      designId: theirs.id,
      ownerId: "other",
      imageUrl: "https://r2/theirs.png",
    });

    const rows = await loadExportRows(db, "owner");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      imageId: mineId,
      imageUrl: "https://r2/mine.png",
      prompt: "a fox",
      aspectRatio: "3:4",
    });
  });

  it("matches getUserImageLibrary's ids and order", async () => {
    const db = h.db as Db;
    const open = await makeDesign(db, "owner");
    const archived = await makeDesign(db, "owner");
    await db
      .update(schema.design)
      .set({ closedAt: new Date("2026-08-30T00:00:00Z") })
      .where(eq(schema.design.id, archived.id));

    const sameSecond = new Date("2026-09-01T10:00:00Z");
    await makeSourceImage(db, {
      designId: open.id,
      ownerId: "owner",
      imageUrl: "https://r2/old.png",
      createdAt: new Date("2026-08-01T00:00:00Z"),
    });
    await makeSourceImage(db, {
      designId: archived.id,
      ownerId: "owner",
      imageUrl: "https://r2/archived.png",
      createdAt: new Date("2026-08-15T00:00:00Z"),
    });
    await makeSourceImage(db, {
      designId: open.id,
      ownerId: "owner",
      imageUrl: "https://r2/published.png",
      createdAt: sameSecond,
      publishedAt: new Date("2026-09-02T00:00:00Z"),
      backgroundColor: "Navy",
    });
    for (const n of [1, 2, 3]) {
      await makeSourceImage(db, {
        designId: open.id,
        ownerId: "owner",
        imageUrl: `https://r2/same-${n}.png`,
        createdAt: sameSecond,
      });
    }

    const library = await getUserImageLibrary("owner");
    const rows = await loadExportRows(db, "owner");
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.imageId)).toEqual(library.map((i) => i.imageId));
  });

  it("resolves a legacy row's key from its URL", async () => {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://r2.test/designs/abc/1.png",
    });
    const [legacy] = await loadExportRows(db, "owner");
    expect(legacy.r2Key).toBeNull();
    const key = exportObjectKey(legacy, (url) =>
      url.startsWith("https://r2.test/") ? url.slice("https://r2.test/".length) : null
    );
    expect(key).toBe("designs/abc/1.png");
  });

  it("returns a guest's own rows", async () => {
    const db = h.db as Db;
    await db.insert(schema.user).values({
      id: "guest",
      email: "guest@example.com",
      name: "guest",
      isAnonymous: true,
    });
    const design = await makeDesign(db, "guest");
    const id = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "guest",
      imageUrl: "https://r2/guest.png",
    });
    const rows = await loadExportRows(db, "guest");
    expect(rows.map((r) => r.imageId)).toEqual([id]);
    expect(await loadExportRows(db, "owner")).toEqual([]);
  });
});
