/**
 * Atomic generation-number reservation (#40, WP2). The R2 key for a generated
 * image is designs/{id}/{n}.png where n comes from design.generation_count.
 * The old read-then-write let two concurrent generates both read N and both
 * write N+1 — the second R2 put overwrote the first image while both rows
 * pointed at it. reserveGenerationNumbers replaces that with an atomic
 * UPDATE ... RETURNING so each caller gets a disjoint range. Real in-memory
 * libSQL (the #28 pattern).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { reserveGenerationNumbers } = await import("@/lib/design-images");

async function seedDesign(db: Db, generationCount = 0): Promise<string> {
  await db.insert(schema.user).values({ id: "u1", email: "a@b.c", name: "A" });
  const [design] = await db
    .insert(schema.design)
    .values({ userId: "u1", generationCount })
    .returning();
  return design.id;
}

describe("reserveGenerationNumbers", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  it("returns the next number and advances the counter", async () => {
    const designId = await seedDesign(testDb, 5);
    expect(await reserveGenerationNumbers(designId, 1)).toEqual([6]);

    const [row] = await testDb
      .select({ n: schema.design.generationCount })
      .from(schema.design)
      .where(eq(schema.design.id, designId));
    expect(row.n).toBe(6);
  });

  it("reserves a contiguous block for a multi-image compare", async () => {
    const designId = await seedDesign(testDb, 0);
    expect(await reserveGenerationNumbers(designId, 2)).toEqual([1, 2]);
    expect(await reserveGenerationNumbers(designId, 3)).toEqual([3, 4, 5]);
  });

  it("hands parallel reservations disjoint numbers (no collision)", async () => {
    const designId = await seedDesign(testDb, 0);

    const batches = await Promise.all([
      reserveGenerationNumbers(designId, 1),
      reserveGenerationNumbers(designId, 1),
      reserveGenerationNumbers(designId, 1),
      reserveGenerationNumbers(designId, 2),
    ]);

    const all = batches.flat().sort((a, b) => a - b);
    // 5 numbers reserved total, every one distinct and contiguous from 1.
    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("throws for an unknown design", async () => {
    await expect(reserveGenerationNumbers("nope", 1)).rejects.toThrow(
      "Design not found"
    );
  });
});
