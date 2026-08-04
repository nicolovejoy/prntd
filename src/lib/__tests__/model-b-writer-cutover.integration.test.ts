/**
 * Model B slice-4 writer cutover (docs/model-b-migration-plan.md). Every write
 * path lands ONLY the new-table shapes — `image` + `conversation_image` for
 * source artifacts, `placement_render` for renders, `listing` for publish
 * state (`design_image` itself was dropped in slice 5). Runs against a real
 * in-memory libSQL (#28), driving the server actions with db + auth mocked so
 * the batches actually run.
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

describe("insertDesignImage writer cutover", () => {
  it("source generation lands image + output link only", async () => {
    const { designId } = await seedDesign();
    currentUserId = "owner-1";

    const id = await insertDesignImage({
      designId,
      imageUrl: "https://cdn.example.com/images/abc.png",
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
    expect(img.imageUrl).toBe("https://cdn.example.com/images/abc.png");
    // r2_key parsed best-effort from the URL path.
    expect(img.r2Key).toBe("images/abc.png");

    const links = await testDb
      .select()
      .from(schema.conversationImage)
      .where(eq(schema.conversationImage.imageId, id));
    expect(links).toHaveLength(1);
    expect(links[0].role).toBe("output");
    expect(links[0].designId).toBe(designId);

    // Not a placement render.
    expect(
      await testDb
        .select()
        .from(schema.placementRender)
        .where(eq(schema.placementRender.id, id))
    ).toHaveLength(0);
  });

  it("honors a pre-minted id (the id-keyed R2 upload path)", async () => {
    const { designId } = await seedDesign();
    currentUserId = "owner-1";
    const minted = crypto.randomUUID();

    const id = await insertDesignImage({
      id: minted,
      designId,
      imageUrl: `https://cdn.example.com/images/${minted}.png`,
      aspectRatio: "1:1",
      generationCost: 0,
    });

    expect(id).toBe(minted);
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, minted))
    ).toHaveLength(1);
  });

  it("placement render lands placement_render only", async () => {
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

    // A render is not an artifact — no image row.
    expect(
      await testDb
        .select()
        .from(schema.image)
        .where(eq(schema.image.id, renderId))
    ).toHaveLength(0);
  });
});

describe("publish-family writer cutover", () => {
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

  it("publishImage inserts a listing row and touches nothing else", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T", backgroundColor: "Black" });

    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing).toBeTruthy();
    expect(listing.title).toBe("T");
    expect(listing.backgroundColor).toBe("Black");
    expect(listing.isHidden).toBe(false);
    expect(listing.feedRank).toBeNull();
  });

  it("publishImage auto-proposes a title when none supplied", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId);

    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing.title).toBe("Auto Title");
    // Descriptions are never auto-generated (2026-07-29).
    expect(listing.description).toBeNull();
  });

  it("publishImage rejects a non-owner", async () => {
    const { imageId } = await seedSourceImage();
    await testDb
      .insert(schema.user)
      .values({ id: "intruder", email: "i@example.com", name: "I" });
    currentUserId = "intruder";
    await expect(publishImage(imageId, { title: "X" })).rejects.toThrow(
      "Unauthorized"
    );
  });

  it("updatePublishedNaming updates the listing only", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T", backgroundColor: "Black" });
    await updatePublishedNaming(imageId, { title: "New", backgroundColor: "White" });

    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing.title).toBe("New");
    expect(listing.backgroundColor).toBe("White");
  });

  it("updatePublishedNaming refuses on an unpublished image", async () => {
    const { imageId } = await seedSourceImage();
    await expect(
      updatePublishedNaming(imageId, { title: "New" })
    ).rejects.toThrow("not published");
  });

  it("setImageHidden / setImageFeedRank write the listing", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T" });
    await setImageHidden(imageId, true);
    await setImageFeedRank(imageId, 3);

    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing.isHidden).toBe(true);
    expect(listing.feedRank).toBe(3);
  });

  it("unpublishImage deletes the listing; re-publish starts a fresh one", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, {
      title: "Original",
      backgroundColor: "Black",
    });
    await setImageFeedRank(imageId, 7);
    await unpublishImage(imageId);

    expect(
      await testDb
        .select()
        .from(schema.listing)
        .where(eq(schema.listing.imageId, imageId))
    ).toHaveLength(0);

    // Re-publish = fresh listing (cutover judgment call: prior title/backdrop/
    // hidden/rank don't carry over — nothing persists them anymore).
    await publishImage(imageId);
    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing.title).toBe("Auto Title");
    expect(listing.feedRank).toBeNull();
    expect(listing.isHidden).toBe(false);
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
    await publishImage(imageId, { title: "T" });

    await deleteDesign(designId);

    expect(await testDb.select().from(schema.image)).toHaveLength(0);
    expect(await testDb.select().from(schema.conversationImage)).toHaveLength(0);
    expect(await testDb.select().from(schema.placementRender)).toHaveLength(0);
    expect(await testDb.select().from(schema.listing)).toHaveLength(0);
  });
});
