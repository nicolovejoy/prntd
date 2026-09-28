/**
 * loadExportRows against a real (in-memory) libSQL DB: owner isolation, the
 * same rows as the My Designs library in exactly the reverse order, parts,
 * legacy key resolution.
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
import {
  exportObjectKey,
  exportPartCount,
  exportPartRows,
  loadExportRows,
} from "@/lib/design-export";

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

  it("has getUserImageLibrary's ids in exactly the reverse order (oldest first)", async () => {
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
    expect(rows.map((r) => r.imageId)).toEqual(
      library.map((i) => i.imageId).reverse()
    );
    expect(new Set(rows.map((r) => r.imageId))).toEqual(
      new Set(library.map((i) => i.imageId))
    );
    const times = rows.map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("splits 250 images into parts of 100, 100 and 50, oldest first", async () => {
    const db = h.db as Db;
    await makeUser(db, "other");
    const mine = await makeDesign(db, "owner");
    const theirs = await makeDesign(db, "other");
    const base = Date.UTC(2026, 0, 1);
    // Three images per second, so same-second ties rely on the rowid order.
    const seeded = Array.from({ length: 250 }, (_, i) => ({
      id: `own-${String(i).padStart(3, "0")}`,
      ownerId: "owner",
      imageUrl: `https://r2/own-${i}.png`,
      aspectRatio: "1:1",
      sourceDesignId: mine.id,
      createdAt: new Date(base + Math.floor(i / 3) * 1000),
    }));
    // Inserted out of order: the order must come from created_at, not rowid alone.
    const shuffled = [...seeded].sort((a, b) =>
      a.createdAt.getTime() === b.createdAt.getTime() ? 0 : a.id < b.id ? 1 : -1
    );
    for (let k = 0; k < shuffled.length; k += 50) {
      await db.insert(schema.image).values(shuffled.slice(k, k + 50));
    }
    await db.insert(schema.image).values(
      Array.from({ length: 30 }, (_, i) => ({
        id: `their-${i}`,
        ownerId: "other",
        imageUrl: `https://r2/their-${i}.png`,
        aspectRatio: "1:1",
        sourceDesignId: theirs.id,
        createdAt: new Date(base + i * 1000),
      }))
    );

    const rows = await loadExportRows(db, "owner");
    const partCount = exportPartCount(rows.length);
    expect(partCount).toBe(3);
    const parts = [1, 2, 3].map((n) => exportPartRows(rows, n));
    expect(parts.map((p) => p.length)).toEqual([100, 100, 50]);

    const union = parts.flat().map((r) => r.imageId);
    expect(new Set(union).size).toBe(250);
    expect(new Set(union)).toEqual(new Set(seeded.map((r) => r.id)));
    expect(union.some((id) => id.startsWith("their-"))).toBe(false);

    // Oldest first within and across parts.
    const times = parts.flat().map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(parts[0][0].createdAt.getTime()).toBe(base);
    expect(parts[2][49].createdAt.getTime()).toBe(base + 83_000);
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
