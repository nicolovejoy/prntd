/**
 * Model B slice-1 dual-write (docs/model-b-migration-plan.md). Every write path
 * that touches design_image must land the matching new-table shape in the same
 * batch, with the id reused. Runs against a real in-memory libSQL (#28), and
 * drives the server actions with db + auth mocked so the batches actually run.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;
let currentUserId: string;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

// designs/actions.ts and admin/actions.ts authorize via the session; stub it to
// the current owner (admin email for the admin actions).
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: currentUserId, email: process.env.ADMIN_EMAIL },
      }),
    },
  },
  isAnonymousUser: () => false,
}));
vi.mock("@/lib/ai", () => ({
  generatePublishedNaming: async () => ({
    title: "Auto Title",
    description: "Auto Description",
  }),
}));

// admin/actions pulls the Stripe/Resend clients in at module load (they
// construct on import). The publish-family paths under test never call them;
// dummy keys just get the modules loaded.
process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
process.env.RESEND_API_KEY ??= "re_dummy";
// admin/actions reads ADMIN_EMAIL at module load; it also gates the admin
// actions and matches the seeded owner so the session check passes.
process.env.ADMIN_EMAIL = "owner@example.com";

const { insertDesignImage } = await import("@/lib/design-images");
const { publishImage, unpublishImage, updatePublishedNaming, deleteDesign } =
  await import("@/app/designs/actions");
const { setImageHidden, setImageFeedRank } = await import("@/app/admin/actions");

async function seedDesign(): Promise<{ userId: string; designId: string }> {
  const userId = "owner-1";
  await testDb.insert(schema.user).values({
    id: userId,
    email: "owner@example.com",
    name: "Owner",
  });
  const [design] = await testDb
    .insert(schema.design)
    .values({ userId })
    .returning();
  return { userId, designId: design.id };
}

beforeEach(async () => {
  testDb = await createTestDb();
});

describe("insertDesignImage dual-write", () => {
  it("source generation lands image + output link with the same id", async () => {
    const { designId } = await seedDesign();
    currentUserId = "owner-1";

    const id = await insertDesignImage({
      designId,
      imageUrl: "https://cdn.example.com/designs/d/1.png",
      aspectRatio: "1:1",
      prompt: "a cat",
      generationCost: 0.03,
    });

    const [img] = await testDb
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, id));
    expect(img).toBeTruthy();
    expect(img.ownerId).toBe("owner-1");
    expect(img.sourceDesignId).toBe(designId);
    expect(img.imageUrl).toBe("https://cdn.example.com/designs/d/1.png");
    // r2_key parsed best-effort from the URL path.
    expect(img.r2Key).toBe("designs/d/1.png");

    const links = await testDb
      .select()
      .from(schema.conversationImage)
      .where(eq(schema.conversationImage.imageId, id));
    expect(links).toHaveLength(1);
    expect(links[0].role).toBe("output");
    expect(links[0].designId).toBe(designId);

    // Not a placement render.
    const renders = await testDb
      .select()
      .from(schema.placementRender)
      .where(eq(schema.placementRender.id, id));
    expect(renders).toHaveLength(0);
  });

  it("placement render lands placement_render with the same id, no image row", async () => {
    const { designId } = await seedDesign();
    currentUserId = "owner-1";
    const src = await insertDesignImage({
      designId,
      imageUrl: "https://img/src.png",
      aspectRatio: "1:1",
      generationCost: 0,
    });

    const renderId = await insertDesignImage({
      designId,
      imageUrl: "https://img/back.png",
      aspectRatio: "1:2",
      generationCost: 0.03,
      productId: "bella-canvas-3001",
      placementId: "back",
      parentImageId: src,
    });

    const [render] = await testDb
      .select()
      .from(schema.placementRender)
      .where(eq(schema.placementRender.id, renderId));
    expect(render).toBeTruthy();
    expect(render.blankId).toBe("bella-canvas-3001");
    expect(render.placementId).toBe("back");
    expect(render.sourceImageId).toBe(src);

    // A render is not an artifact — no image row for it.
    const img = await testDb
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, renderId));
    expect(img).toHaveLength(0);
  });
});

describe("publish-family dual-write", () => {
  async function seedSourceImage() {
    const { designId } = await seedDesign();
    currentUserId = "owner-1";
    const imageId = await insertDesignImage({
      designId,
      imageUrl: "https://img/pub.png",
      aspectRatio: "1:1",
      generationCost: 0,
    });
    return { designId, imageId };
  }

  it("publishImage inserts a listing row", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T", description: "D", backgroundColor: "Black" });

    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing).toBeTruthy();
    expect(listing.title).toBe("T");
    expect(listing.backgroundColor).toBe("Black");
    expect(listing.isHidden).toBe(false);
  });

  it("updatePublishedNaming keeps the listing in lockstep", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T", description: "D", backgroundColor: "Black" });
    await updatePublishedNaming(imageId, { title: "New", backgroundColor: "White" });

    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing.title).toBe("New");
    expect(listing.backgroundColor).toBe("White");
    // design_image stays in lockstep.
    const [di] = await testDb
      .select()
      .from(schema.designImage)
      .where(eq(schema.designImage.id, imageId));
    expect(di.title).toBe("New");
    expect(di.backgroundColor).toBe("White");
  });

  it("setImageHidden / setImageFeedRank mirror onto the listing", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T", description: "D" });
    await setImageHidden(imageId, true);
    await setImageFeedRank(imageId, 3);

    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing.isHidden).toBe(true);
    expect(listing.feedRank).toBe(3);
  });

  it("unpublishImage deletes the listing", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T", description: "D" });
    await unpublishImage(imageId);

    const listing = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing).toHaveLength(0);
    // design_image publish flag cleared too.
    const [di] = await testDb
      .select()
      .from(schema.designImage)
      .where(eq(schema.designImage.id, imageId));
    expect(di.publishedAt).toBeNull();
  });

  it("editing an unpublished image conjures no listing", async () => {
    const { imageId } = await seedSourceImage();
    await setImageFeedRank(imageId, 5);
    await setImageHidden(imageId, true);
    const listing = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing).toHaveLength(0);
  });
});

describe("deleteDesign clears Model B rows", () => {
  it("removes image, links, listing, and placement renders", async () => {
    const { designId } = await seedDesign();
    currentUserId = "owner-1";
    const imageId = await insertDesignImage({
      designId,
      imageUrl: "https://img/one.png",
      aspectRatio: "1:1",
      generationCost: 0,
    });
    await insertDesignImage({
      designId,
      imageUrl: "https://img/render.png",
      aspectRatio: "1:2",
      generationCost: 0,
      productId: "bella-canvas-3001",
      placementId: "front",
      parentImageId: imageId,
    });
    await publishImage(imageId, { title: "T", description: "D" });

    await deleteDesign(designId);

    expect(await testDb.select().from(schema.image)).toHaveLength(0);
    expect(await testDb.select().from(schema.conversationImage)).toHaveLength(0);
    expect(await testDb.select().from(schema.placementRender)).toHaveLength(0);
    expect(await testDb.select().from(schema.listing)).toHaveLength(0);
    expect(await testDb.select().from(schema.designImage)).toHaveLength(0);
  });
});
