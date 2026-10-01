/**
 * prefetchProductMockups write-back: warms the DEFAULT front, so it must not
 * store a render of the old primary under source-less keys when a generation
 * claimed the primary (and cleared mockup_urls) while Printful was rendering.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { getBlank } from "@/lib/blanks";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

const printful = vi.hoisted(() => ({
  createMockupTask: vi.fn(async () => "task-key"),
  pollMockupTask: vi.fn(),
}));
vi.mock("@/lib/printful", () => printful);
vi.mock("@/lib/r2", () => ({
  uploadMockupImage: vi.fn(async () => "https://r2.example/mockup.jpg"),
}));

import { prefetchProductMockups } from "@/lib/mockup-prefetch";

type Db = Awaited<ReturnType<typeof createTestDb>>;
const PRODUCT = "bella-canvas-3001";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }))
  );
});
afterEach(() => vi.unstubAllGlobals());

function blackVariant() {
  const m = getBlank(PRODUCT)!.variants["Black"];
  return m["M"] ?? Object.values(m)[0];
}

async function setup() {
  const db = (h.db = await createTestDb()) as Db;
  await makeUser(db, "nico");
  const design = await makeDesign(db, "nico");
  const p1 = await makeSourceImage(db, { designId: design.id, ownerId: "nico", imageUrl: "https://img.example/p1.png" });
  const p2 = await makeSourceImage(db, { designId: design.id, ownerId: "nico", imageUrl: "https://img.example/p2.png" });
  await db.update(schema.design).set({ primaryImageId: p1 }).where(eq(schema.design.id, design.id));
  return { db, designId: design.id, p1, p2 };
}
const urls = async (db: Db, id: string) =>
  (await db.select().from(schema.design).where(eq(schema.design.id, id)))[0].mockupUrls ?? {};

describe("prefetchProductMockups write-back", () => {
  it("writes the default-key entries when the primary is unchanged", async () => {
    const { db, designId } = await setup();
    printful.pollMockupTask.mockResolvedValueOnce([
      { mockupUrl: "https://printful.example/t.jpg", variantIds: [blackVariant()] },
    ]);
    await prefetchProductMockups(designId, PRODUCT);
    expect(Object.keys(await urls(db, designId))).toContain(
      "v2:bella-canvas-3001:front:Black:100"
    );
  });

  it("writes nothing when the primary moved (and cleared the cache) during the render", async () => {
    const { db, designId, p2 } = await setup();
    printful.pollMockupTask.mockImplementationOnce(async () => {
      await db
        .update(schema.design)
        .set({ primaryImageId: p2, mockupUrls: null })
        .where(eq(schema.design.id, designId));
      return [{ mockupUrl: "https://printful.example/t.jpg", variantIds: [blackVariant()] }];
    });
    await prefetchProductMockups(designId, PRODUCT);
    expect(await urls(db, designId)).toEqual({});
  });
});
