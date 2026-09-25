/**
 * "Which composition belongs to an image" — one rule for both delete paths
 * (composition slice 5 review). The product whose FRONT slot is image I is
 * I's own composition: deleted with I, never a reference keeping I alive.
 * Any other image that product places (a back slot) is kept alive by it.
 *
 * delete-image.ts reaches the rule through `findMirrorProduct` (SQL on the
 * generated `product.front_image_id`); delete-design.ts through
 * `compositionFrontImageId` over `placements` it already loaded. Before the
 * two were aligned, delete-design.ts required a single-slot `{front}` row,
 * so a two-sided composition fronted by one of the conversation's images
 * was a "pin" to the conversation delete and "its own composition" to the
 * image delete. Nothing writes two-sided compositions yet; this pins the
 * agreement before something does. Real in-memory libSQL, FKs enforced.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { planDesignDeletion, executeDesignDeletion } from "@/lib/delete-design";
import { planImageDeletion } from "@/lib/delete-image";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await makeUser(db, "u1");
});

async function image(designId: string, name: string) {
  return makeSourceImage(db, {
    designId,
    ownerId: "u1",
    imageUrl: `https://r2/images/${name}.png`,
  });
}

async function composition(placements: Record<string, string>) {
  const [row] = await db
    .insert(schema.product)
    .values({ ownerId: "u1", placements, status: "listed", listedAt: new Date() })
    .returning();
  return row;
}

function outcomeOf(
  plan: Awaited<ReturnType<typeof planDesignDeletion>>,
  imageId: string
) {
  return plan.images.find((i) => i.imageId === imageId)?.outcome;
}

describe("an image's own composition is the one it fronts — both delete paths agree", () => {
  it("a two-sided composition fronted by the conversation's image goes with that image", async () => {
    const d = await makeDesign(db, "u1");
    const front = await image(d.id, "front");
    const other = await makeDesign(db, "u1");
    const back = await image(other.id, "back");
    const own = await composition({ front, back });

    const designPlan = await planDesignDeletion(db, d.id);
    const imagePlan = await planImageDeletion(db, front, { designId: d.id });

    expect(outcomeOf(designPlan, front)).toBe("delete");
    expect(designPlan.removableMirrorIds).toEqual([own.id]);
    expect(imagePlan.outcome).toBe("delete");
    expect(imagePlan.mirrorProductId).toBe(own.id);

    await executeDesignDeletion(db, designPlan);
    expect(
      await db.select().from(schema.product).where(eq(schema.product.id, own.id))
    ).toHaveLength(0);
    // The back image belongs to another conversation and is untouched.
    expect(
      await db.select().from(schema.image).where(eq(schema.image.id, back))
    ).toHaveLength(1);
  });

  it("a composition fronted by another conversation's image keeps our back image alive", async () => {
    const other = await makeDesign(db, "u1");
    const front = await image(other.id, "front");
    const d = await makeDesign(db, "u1");
    const back = await image(d.id, "back");
    const theirs = await composition({ front, back });

    const designPlan = await planDesignDeletion(db, d.id);
    const imagePlan = await planImageDeletion(db, back, { designId: d.id });

    expect(outcomeOf(designPlan, back)).toBe("detach-product-pin");
    expect(designPlan.removableMirrorIds).toEqual([]);
    expect(imagePlan.outcome).toBe("detach-product-pin");
    expect(imagePlan.mirrorProductId).toBeNull();

    await executeDesignDeletion(db, designPlan);
    expect(
      await db.select().from(schema.image).where(eq(schema.image.id, back))
    ).toHaveLength(1);
    expect(
      await db.select().from(schema.product).where(eq(schema.product.id, theirs.id))
    ).toHaveLength(1);
  });

  it("the single-slot composition publish writes is still the image's own", async () => {
    const d = await makeDesign(db, "u1");
    const imageId = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/published.png",
      publishedAt: new Date(),
    });
    const [mirror] = await db
      .select({ id: schema.product.id })
      .from(schema.product)
      .where(eq(schema.product.frontImageId, imageId));

    const designPlan = await planDesignDeletion(db, d.id);
    const imagePlan = await planImageDeletion(db, imageId, { designId: d.id });

    expect(outcomeOf(designPlan, imageId)).toBe("delete");
    expect(designPlan.removableMirrorIds).toEqual([mirror.id]);
    expect(imagePlan.outcome).toBe("delete");
    expect(imagePlan.mirrorProductId).toBe(mirror.id);
  });
});
