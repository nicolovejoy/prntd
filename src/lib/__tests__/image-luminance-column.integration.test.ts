import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign, makeSourceImage } from "./factories";
import * as schema from "@/lib/db/schema";
import { buildImageRow } from "@/lib/model-b-writes";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await makeUser(db, "u1");
});

describe("image.luminance (#139)", () => {
  it("is nullable and defaults to NULL on rows that omit it", async () => {
    const designId = (await makeDesign(db, "u1")).id;
    const id = await makeSourceImage(db, { designId, ownerId: "u1", imageUrl: "https://r2/a.png" });
    const [row] = await db.select().from(schema.image).where(eq(schema.image.id, id));
    expect(row.luminance).toBeNull();
  });

  it("stores the value the factory and buildImageRow pass", async () => {
    const designId = (await makeDesign(db, "u1")).id;
    const id = await makeSourceImage(db, {
      designId, ownerId: "u1", imageUrl: "https://r2/b.png", luminance: 0.82,
    });
    const [row] = await db.select().from(schema.image).where(eq(schema.image.id, id));
    expect(row.luminance).toBeCloseTo(0.82, 6);

    const built = buildImageRow({
      id: "img-built", ownerId: "u1", designId, imageUrl: "https://r2/c.png",
      aspectRatio: "1:1", generationCost: 0, luminance: 0.1,
    });
    expect(built.luminance).toBe(0.1);
    const omitted = buildImageRow({
      id: "img-omitted", ownerId: "u1", designId, imageUrl: "https://r2/d.png",
      aspectRatio: "1:1", generationCost: 0,
    });
    expect(omitted.luminance).toBeNull();
  });
});
