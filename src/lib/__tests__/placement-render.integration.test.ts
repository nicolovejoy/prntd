/**
 * Placement-render source keying (#25). Regression for the display bug where
 * picking a different back image returned the first cached back render: the
 * lookup keyed on (design, product, placement) but not the chosen source.
 * Runs against a real in-memory libSQL (the #28 pattern).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

// vi.mock is hoisted; the getter defers db access until call time, by when
// beforeEach has assigned the per-test database.
vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { insertDesignImage, findPlacementRender } = await import(
  "@/lib/design-images"
);

const PRODUCT = "bella-canvas-3001";

async function seedDesign(db: Db): Promise<string> {
  await db
    .insert(schema.user)
    .values({ id: "u1", email: "a@b.c", name: "A" });
  const [design] = await db
    .insert(schema.design)
    .values({ userId: "u1" })
    .returning();
  return design.id;
}

describe("findPlacementRender — source keying (#25)", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  it("returns the render anchored on the requested source, not the first one", async () => {
    const designId = await seedDesign(testDb);

    const srcA = await insertDesignImage({
      designId,
      imageUrl: "https://img/srcA.png",
      aspectRatio: "1:1",
      generationCost: 0,
    });
    const srcB = await insertDesignImage({
      designId,
      imageUrl: "https://img/srcB.png",
      aspectRatio: "1:1",
      generationCost: 0,
    });

    // Two back renders for the same product, each anchored on a different source.
    await insertDesignImage({
      designId,
      imageUrl: "https://img/backA.png",
      aspectRatio: "1:2",
      generationCost: 0,
      productId: PRODUCT,
      placementId: "back",
      parentImageId: srcA,
    });
    await insertDesignImage({
      designId,
      imageUrl: "https://img/backB.png",
      aspectRatio: "1:2",
      generationCost: 0,
      productId: PRODUCT,
      placementId: "back",
      parentImageId: srcB,
    });

    const a = await findPlacementRender(designId, PRODUCT, "back", srcA);
    const b = await findPlacementRender(designId, PRODUCT, "back", srcB);
    expect(a?.imageUrl).toBe("https://img/backA.png");
    expect(b?.imageUrl).toBe("https://img/backB.png"); // the bug returned backA here
  });

  it("front lookup (no source) is unaffected by the parent filter", async () => {
    const designId = await seedDesign(testDb);
    await insertDesignImage({
      designId,
      imageUrl: "https://img/front.png",
      aspectRatio: "1:2",
      generationCost: 0,
      productId: PRODUCT,
      placementId: "front",
    });
    // No sourceImageId → legacy behavior: matches on (design, product, front).
    const front = await findPlacementRender(designId, PRODUCT, "front");
    expect(front?.imageUrl).toBe("https://img/front.png");
  });

  it("misses when no render is anchored on the requested source", async () => {
    const designId = await seedDesign(testDb);
    const srcA = await insertDesignImage({
      designId,
      imageUrl: "https://img/srcA.png",
      aspectRatio: "1:1",
      generationCost: 0,
    });
    // A back render anchored elsewhere must not satisfy a srcA lookup.
    await insertDesignImage({
      designId,
      imageUrl: "https://img/backOther.png",
      aspectRatio: "1:2",
      generationCost: 0,
      productId: PRODUCT,
      placementId: "back",
      parentImageId: "some-other-source",
    });
    const hit = await findPlacementRender(designId, PRODUCT, "back", srcA);
    expect(hit).toBeNull();
  });
});
