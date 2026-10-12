/**
 * lineHiddenArt (#310 items 1 and 7) against a real in-memory libSQL: which
 * sides of a cart or order line show admin-hidden artwork.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "./factories";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { lineHiddenArt } = await import("@/lib/line-hidden-art");

async function image(designId: string, opts: { published?: boolean; hidden?: boolean } = {}) {
  return makeSourceImage(testDb, {
    designId,
    ownerId: "owner",
    imageUrl: `https://img.example/${crypto.randomUUID()}.png`,
    publishedAt: opts.published || opts.hidden ? new Date() : null,
    isHidden: opts.hidden ?? false,
  });
}

async function setHidden(imageId: string, hidden: boolean) {
  await testDb
    .update(schema.imagePublication)
    .set({ isHidden: hidden })
    .where(eq(schema.imagePublication.imageId, imageId));
}

async function setPrimary(designId: string, imageId: string | null) {
  await testDb
    .update(schema.design)
    .set({ primaryImageId: imageId })
    .where(eq(schema.design.id, designId));
}

describe("lineHiddenArt", () => {
  let designId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    await makeUser(testDb, "owner");
    designId = (await makeDesign(testDb, "owner")).id;
  });

  it("front pin hidden, no back", async () => {
    const front = await image(designId, { hidden: true });
    expect(await lineHiddenArt({ designId, placements: { front } })).toEqual({
      front: true,
      back: false,
    });
  });

  it("front visible and published, back pin hidden", async () => {
    const front = await image(designId, { published: true });
    const back = await image(designId, { hidden: true });
    expect(await lineHiddenArt({ designId, placements: { front, back } })).toEqual({
      front: false,
      back: true,
    });
  });

  it("both pins published and visible", async () => {
    const front = await image(designId, { published: true });
    const back = await image(designId, { published: true });
    expect(await lineHiddenArt({ designId, placements: { front, back } })).toEqual({
      front: false,
      back: false,
    });
  });

  it("a pin with no publication row is not hidden", async () => {
    const front = await image(designId);
    expect(await lineHiddenArt({ designId, placements: { front } })).toEqual({
      front: false,
      back: false,
    });
  });

  it("no placements: the design's hidden primary counts as the front", async () => {
    const primary = await image(designId, { hidden: true });
    await setPrimary(designId, primary);
    expect(await lineHiddenArt({ designId, placements: null })).toEqual({
      front: true,
      back: false,
    });
  });

  it("no placements: a visible primary is not hidden", async () => {
    const primary = await image(designId, { published: true });
    await setPrimary(designId, primary);
    expect(await lineHiddenArt({ designId, placements: null })).toEqual({
      front: false,
      back: false,
    });
  });

  it("no placements and no primary", async () => {
    expect(await lineHiddenArt({ designId, placements: null })).toEqual({
      front: false,
      back: false,
    });
  });

  it("a placement render pin is judged by its hidden source image", async () => {
    const source = await image(designId, { hidden: true });
    const renderId = crypto.randomUUID();
    await testDb.insert(schema.placementRender).values({
      id: renderId,
      designId,
      sourceImageId: source,
      blankId: "bella-canvas-3001",
      placementId: "front",
      imageUrl: "https://img.example/render.png",
      aspectRatio: "1:1",
    });
    const visible = await image(designId, { published: true });
    expect(
      await lineHiddenArt({ designId, placements: { front: visible, back: renderId } })
    ).toEqual({ front: false, back: true });
  });

  it("a pin id that names no row is not hidden", async () => {
    expect(
      await lineHiddenArt({
        designId,
        placements: { front: crypto.randomUUID(), back: crypto.randomUUID() },
      })
    ).toEqual({ front: false, back: false });
  });

  it("hidden, then unhidden", async () => {
    const front = await image(designId, { hidden: true });
    expect((await lineHiddenArt({ designId, placements: { front } })).front).toBe(true);
    await setHidden(front, false);
    expect((await lineHiddenArt({ designId, placements: { front } })).front).toBe(false);
  });
});
