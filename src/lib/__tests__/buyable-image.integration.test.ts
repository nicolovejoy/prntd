/**
 * resolveBuyableImage against a real in-memory libSQL (#321). The state under
 * test, a published image whose conversation is gone, is built with the real
 * delete path: the image is linked as a seed in a second conversation, so
 * deleting the first detaches it instead of removing it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import {
  makeUser,
  makeDesign,
  makeSourceImage,
  setPublication,
} from "@/lib/__tests__/factories";
import { planDesignDeletion, executeDesignDeletion } from "@/lib/delete-design";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import { resolveBuyableImage } from "@/lib/buyable-image";

type Db = Awaited<ReturnType<typeof createTestDb>>;

/** A published image whose conversation was deleted through the real path. */
async function seedGoneConversation(db: Db, publishedAt: Date | null) {
  const home = await makeDesign(db, "owner");
  const imageId = await makeSourceImage(db, {
    designId: home.id,
    ownerId: "owner",
    imageUrl: "https://img.example/gone.png",
    publishedAt,
  });
  const other = await makeDesign(db, "owner");
  await db
    .insert(schema.conversationImage)
    .values({ designId: other.id, imageId, role: "seed" });

  const plan = await planDesignDeletion(db, home.id);
  expect(plan.images.map((i) => [i.imageId, i.outcome])).toEqual([
    [imageId, "detach-seed"],
  ]);
  await executeDesignDeletion(db, plan);

  const [row] = await db.select().from(schema.image);
  expect(row.id).toBe(imageId);
  const designs = await db.select().from(schema.design);
  expect(designs.map((d) => d.id)).toEqual([other.id]);
  const pubs = await db.select().from(schema.imagePublication);
  expect(pubs.map((p) => p.imageId)).toEqual(publishedAt ? [imageId] : []);
  const products = await db.select().from(schema.product);
  expect(products).toHaveLength(publishedAt ? 1 : 0);
  return { imageId };
}

beforeEach(async () => {
  h.db = await createTestDb();
  const db = h.db as Db;
  await makeUser(db, "owner");
  await makeUser(db, "stranger");
});

describe("resolveBuyableImage", () => {
  it("a published image with a live conversation is buyable by anyone, owner and signed-out included", async () => {
    const db = h.db as Db;
    const d = await makeDesign(db, "owner");
    const imageId = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "owner",
      imageUrl: "https://img.example/live.png",
      publishedAt: new Date(),
    });
    for (const viewer of ["stranger", "owner", null]) {
      const res = await resolveBuyableImage(imageId, viewer);
      expect(res).toMatchObject({ ok: true, published: true, designId: d.id });
    }
  });

  it("a published image whose conversation is gone is not-allowed for everyone", async () => {
    const db = h.db as Db;
    const { imageId } = await seedGoneConversation(db, new Date());
    for (const viewer of ["stranger", "owner", null]) {
      expect(await resolveBuyableImage(imageId, viewer)).toEqual({
        ok: false,
        reason: "not-allowed",
      });
    }
  });

  it("the owner's unpublished image with a live conversation is buyable, unpublished", async () => {
    const db = h.db as Db;
    const d = await makeDesign(db, "owner");
    const imageId = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "owner",
      imageUrl: "https://img.example/private.png",
    });
    expect(await resolveBuyableImage(imageId, "owner")).toMatchObject({
      ok: true,
      published: false,
      designId: d.id,
    });
    expect(await resolveBuyableImage(imageId, "stranger")).toEqual({
      ok: false,
      reason: "not-allowed",
    });
  });

  it("the owner's unpublished image whose conversation is gone is not-allowed", async () => {
    const db = h.db as Db;
    const { imageId } = await seedGoneConversation(db, null);
    expect(await resolveBuyableImage(imageId, "owner")).toEqual({
      ok: false,
      reason: "not-allowed",
    });
  });

  it("an admin-hidden published image is not-allowed", async () => {
    const db = h.db as Db;
    const d = await makeDesign(db, "owner");
    const imageId = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "owner",
      imageUrl: "https://img.example/hidden.png",
      publishedAt: new Date(),
    });
    await setPublication(db, imageId, { isHidden: true });
    for (const viewer of ["stranger", "owner", null]) {
      expect(await resolveBuyableImage(imageId, viewer)).toEqual({
        ok: false,
        reason: "not-allowed",
      });
    }
  });

  it("a placement-render id and an unknown id are not-found", async () => {
    const db = h.db as Db;
    const d = await makeDesign(db, "owner");
    const [render] = await db
      .insert(schema.placementRender)
      .values({
        designId: d.id,
        blankId: "bella-canvas-3001",
        placementId: "front",
        imageUrl: "https://img.example/render.png",
        aspectRatio: "1:1",
      })
      .returning();
    expect(await resolveBuyableImage(render.id, "owner")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await resolveBuyableImage("no-such-id", "owner")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});
