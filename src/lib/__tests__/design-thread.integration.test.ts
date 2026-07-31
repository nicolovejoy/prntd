/**
 * Integration test for getDesignThreadData against a real (in-memory) libSQL
 * DB. The contract that kills the "Generations — no images yet" flash (#127):
 * chat and gallery are one payload — a thread with images can never be
 * observed with chat present and sources absent.
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

import { getDesignThreadData } from "@/lib/design-thread";

type Db = Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  h.db = await createTestDb();
  await makeUser(h.db as Db, "owner");
});

describe("getDesignThreadData", () => {
  it("returns chat and gallery together for the owner", async () => {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    const imageId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://r2/gen1.png",
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: imageId })
      .where(eq(schema.design.id, design.id));
    await db.insert(schema.chatMessage).values([
      { designId: design.id, role: "user", content: "a fox" },
      {
        designId: design.id,
        role: "assistant",
        content: "here you go",
        imageId,
      },
    ]);

    const thread = await getDesignThreadData(design.id, "owner");
    expect(thread).not.toBeNull();
    expect(thread!.chat.map((m) => m.content)).toEqual([
      "a fox",
      "here you go",
    ]);
    expect(thread!.sources.map((s) => s.imageUrl)).toEqual([
      "https://r2/gen1.png",
    ]);
    expect(thread!.design.displayImageUrl).toBe("https://r2/gen1.png");
    expect(thread!.design.closedAt).toBeNull();
    expect(thread!.productGroups).toEqual([]);
  });

  it("carries the closed state", async () => {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    const closedAt = new Date("2026-07-01T00:00:00Z");
    await db
      .update(schema.design)
      .set({ closedAt })
      .where(eq(schema.design.id, design.id));

    const thread = await getDesignThreadData(design.id, "owner");
    expect(thread!.design.closedAt).toEqual(closedAt);
  });

  it("returns null for a design owned by someone else", async () => {
    const db = h.db as Db;
    await makeUser(db, "other");
    const design = await makeDesign(db, "other");

    expect(await getDesignThreadData(design.id, "owner")).toBeNull();
  });

  it("returns null for a missing design", async () => {
    expect(await getDesignThreadData("nope", "owner")).toBeNull();
  });
});
