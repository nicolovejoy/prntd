/**
 * Model B slice-1 backfill (docs/model-b-migration-plan.md). Seeds legacy
 * design_image / design rows directly (bypassing the dual-write) and asserts
 * the backfill reconstructs the new tables: the artifact/render split, listings
 * from published rows, seed lineage from forked designs — with the design_image
 * id reused verbatim (risky spot §5) — and that a second run is a no-op.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { backfillModelB } from "../../../scripts/backfill-model-b";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

async function seedUser(id: string) {
  await db.insert(schema.user).values({ id, email: `${id}@e.com`, name: id });
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("backfillModelB", () => {
  it("splits artifacts vs renders and reuses ids", async () => {
    await seedUser("u1");
    const [design] = await db
      .insert(schema.design)
      .values({ userId: "u1" })
      .returning();

    const [artifact] = await db
      .insert(schema.designImage)
      .values({
        designId: design.id,
        aspectRatio: "1:1",
        imageUrl: "https://cdn/x/designs/d/1.png",
        prompt: "a fox",
        generator: "ideogram",
        generationCost: 0.03,
      })
      .returning();
    const [render] = await db
      .insert(schema.designImage)
      .values({
        designId: design.id,
        aspectRatio: "1:2",
        productId: "bella-canvas-3001",
        placementId: "back",
        parentImageId: artifact.id,
        imageUrl: "https://cdn/x/renders/back.png",
        generationCost: 0.03,
      })
      .returning();

    const counts = await backfillModelB(db);
    expect(counts.images).toBe(1);
    expect(counts.placementRenders).toBe(1);
    expect(counts.outputLinks).toBe(1);

    // Artifact → image row, SAME id (risky spot §5).
    const [img] = await db
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, artifact.id));
    expect(img).toBeTruthy();
    expect(img.id).toBe(artifact.id);
    expect(img.ownerId).toBe("u1");
    expect(img.sourceDesignId).toBe(design.id);
    expect(img.generator).toBe("ideogram");
    expect(img.r2Key).toBe("x/designs/d/1.png");

    // The render is NOT an image; it's a placement_render with the same id.
    expect(
      await db.select().from(schema.image).where(eq(schema.image.id, render.id))
    ).toHaveLength(0);
    const [pr] = await db
      .select()
      .from(schema.placementRender)
      .where(eq(schema.placementRender.id, render.id));
    expect(pr.blankId).toBe("bella-canvas-3001");
    expect(pr.placementId).toBe("back");
    expect(pr.sourceImageId).toBe(artifact.id);

    // Output link for the artifact only.
    const links = await db.select().from(schema.conversationImage);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      designId: design.id,
      imageId: artifact.id,
      role: "output",
    });
  });

  it("coalesces a null placement to 'default'", async () => {
    await seedUser("u1");
    const [design] = await db.insert(schema.design).values({ userId: "u1" }).returning();
    const [render] = await db
      .insert(schema.designImage)
      .values({
        designId: design.id,
        aspectRatio: "1:1",
        productId: "bella-canvas-3001",
        placementId: null,
        imageUrl: "https://cdn/front.png",
        generationCost: 0,
      })
      .returning();

    await backfillModelB(db);
    const [pr] = await db
      .select()
      .from(schema.placementRender)
      .where(eq(schema.placementRender.id, render.id));
    expect(pr.placementId).toBe("default");
  });

  it("creates a listing for published rows", async () => {
    await seedUser("u1");
    const [design] = await db.insert(schema.design).values({ userId: "u1" }).returning();
    const publishedAt = new Date("2026-07-01T00:00:00Z");
    const [pubImg] = await db
      .insert(schema.designImage)
      .values({
        designId: design.id,
        aspectRatio: "1:1",
        imageUrl: "https://cdn/pub.png",
        generationCost: 0,
        publishedAt,
        isHidden: true,
        title: "Published",
        description: "Desc",
        backgroundColor: "Black",
        feedRank: 2,
      })
      .returning();

    const counts = await backfillModelB(db);
    expect(counts.listings).toBe(1);
    const [listing] = await db
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, pubImg.id));
    expect(listing.publishedAt.getTime()).toBe(publishedAt.getTime());
    expect(listing.isHidden).toBe(true);
    expect(listing.title).toBe("Published");
    expect(listing.feedRank).toBe(2);
  });

  it("records seed lineage from a forked design", async () => {
    await seedUser("u1");
    await seedUser("u2");
    // The seed image lives in another design owned by u2.
    const [seedDesign] = await db.insert(schema.design).values({ userId: "u2" }).returning();
    const [seedImg] = await db
      .insert(schema.designImage)
      .values({
        designId: seedDesign.id,
        aspectRatio: "1:1",
        imageUrl: "https://cdn/seed.png",
        generationCost: 0,
      })
      .returning();
    // A forked design under u1.
    const [forked] = await db
      .insert(schema.design)
      .values({
        userId: "u1",
        forkedFromImageId: seedImg.id,
        originalDesignerId: "u2",
      })
      .returning();
    const [forkImg] = await db
      .insert(schema.designImage)
      .values({
        designId: forked.id,
        aspectRatio: "1:1",
        imageUrl: "https://cdn/fork.png",
        generationCost: 0,
      })
      .returning();

    const counts = await backfillModelB(db);
    expect(counts.seedLinks).toBe(1);

    // Seed link on the forked conversation.
    const seedLinks = await db
      .select()
      .from(schema.conversationImage)
      .where(eq(schema.conversationImage.role, "seed"));
    expect(seedLinks).toHaveLength(1);
    expect(seedLinks[0]).toMatchObject({
      designId: forked.id,
      imageId: seedImg.id,
      role: "seed",
    });

    // The forked design's image carries seed_image_id + original_designer_id.
    const [img] = await db
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, forkImg.id));
    expect(img.seedImageId).toBe(seedImg.id);
    expect(img.originalDesignerId).toBe("u2");
  });

  it("is idempotent — a second run inserts nothing new", async () => {
    await seedUser("u1");
    const [design] = await db.insert(schema.design).values({ userId: "u1" }).returning();
    await db.insert(schema.designImage).values([
      {
        designId: design.id,
        aspectRatio: "1:1",
        imageUrl: "https://cdn/a.png",
        generationCost: 0,
        publishedAt: new Date(),
      },
      {
        designId: design.id,
        aspectRatio: "1:2",
        productId: "bella-canvas-3001",
        placementId: "back",
        imageUrl: "https://cdn/b.png",
        generationCost: 0,
      },
    ]);

    await backfillModelB(db);
    const after1 = {
      images: (await db.select().from(schema.image)).length,
      links: (await db.select().from(schema.conversationImage)).length,
      renders: (await db.select().from(schema.placementRender)).length,
      listings: (await db.select().from(schema.listing)).length,
    };
    await backfillModelB(db);
    const after2 = {
      images: (await db.select().from(schema.image)).length,
      links: (await db.select().from(schema.conversationImage)).length,
      renders: (await db.select().from(schema.placementRender)).length,
      listings: (await db.select().from(schema.listing)).length,
    };
    expect(after2).toEqual(after1);
    expect(after1).toEqual({ images: 1, links: 1, renders: 1, listings: 1 });
  });
});
