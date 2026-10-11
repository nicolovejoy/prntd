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

describe("getDesignThreadData and admin-hidden images", () => {
  const publishedAt = new Date(Date.UTC(2026, 0, 1, 11, 55));
  const ART_URL = "https://r2/primary-art.png";
  const RENDER_URL = "https://r2/primary-render.png";

  // A conversation whose primary image has a placement render sourced from it
  // and a chat turn naming it. `hidden` flips the primary to admin-hidden.
  async function seedThread(hidden: boolean) {
    const db = h.db as Db;
    const design = await makeDesign(db, "owner");
    const primaryId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: ART_URL,
      publishedAt,
      isHidden: hidden,
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: primaryId })
      .where(eq(schema.design.id, design.id));
    await db.insert(schema.placementRender).values({
      designId: design.id,
      sourceImageId: primaryId,
      blankId: "bella-canvas-3001",
      placementId: "front",
      imageUrl: RENDER_URL,
      aspectRatio: "1:1",
    });
    await db.insert(schema.chatMessage).values([
      { designId: design.id, role: "user", content: "a fox" },
      {
        designId: design.id,
        role: "assistant",
        content: "here you go",
        imageId: primaryId,
      },
    ]);
    return { designId: design.id, primaryId };
  }

  it("a thread with nothing hidden carries the artwork and its render", async () => {
    const { designId } = await seedThread(false);
    const json = JSON.stringify(await getDesignThreadData(designId, "owner"));
    expect(json).toContain(ART_URL);
    expect(json).toContain(RENDER_URL);
  });

  it("a hidden primary and its render appear nowhere in the payload", async () => {
    const { designId, primaryId } = await seedThread(true);
    const thread = await getDesignThreadData(designId, "owner");
    const json = JSON.stringify(thread);
    expect(json).not.toContain(ART_URL);
    expect(json).not.toContain(RENDER_URL);
    expect(thread!.design.displayImageUrl).toBeNull();
    expect(thread!.sources).toEqual([]);
    expect(thread!.productGroups).toEqual([]);
    // The chat row keeps its image id (an id, not artwork); the client shows
    // no picture for an id with no matching source.
    expect(thread!.chat.map((m) => m.imageId)).toEqual([null, primaryId]);
  });

  it("a hidden primary falls back to the latest visible output for the display image", async () => {
    const db = h.db as Db;
    const { designId } = await seedThread(true);
    await makeSourceImage(db, {
      designId,
      ownerId: "owner",
      imageUrl: "https://r2/visible-older.png",
    });
    await makeSourceImage(db, {
      designId,
      ownerId: "owner",
      imageUrl: "https://r2/visible-newest.png",
    });
    const thread = await getDesignThreadData(designId, "owner");
    expect(thread!.design.displayImageUrl).toBe("https://r2/visible-newest.png");
    expect(thread!.sources.map((s) => s.imageUrl)).toEqual([
      "https://r2/visible-older.png",
      "https://r2/visible-newest.png",
    ]);
  });

  it("keeps a render that has no recorded source image", async () => {
    const db = h.db as Db;
    const { designId } = await seedThread(true);
    await db.insert(schema.placementRender).values({
      designId,
      sourceImageId: null,
      blankId: "bella-canvas-3001",
      placementId: "front",
      imageUrl: "https://r2/legacy-render.png",
      aspectRatio: "1:1",
    });
    const thread = await getDesignThreadData(designId, "owner");
    expect(
      thread!.productGroups.flatMap((g) => g.images.map((i) => i.imageUrl))
    ).toEqual(["https://r2/legacy-render.png"]);
  });
});
