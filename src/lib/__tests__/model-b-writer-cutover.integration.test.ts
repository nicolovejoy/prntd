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
/**
 * Test seam for the double-publish race: a hook that runs INSIDE
 * findMirrorProduct, after its read and before the caller writes anything.
 * Null (pass-through) for every other test. Mocking the module is the only
 * way to hold a call at that exact point without a production hook.
 */
const raceHook = vi.hoisted(() => ({
  afterFindMirror: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/model-b-writes", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/model-b-writes")>();
  return {
    ...actual,
    findMirrorProduct: async (
      ...args: Parameters<typeof actual.findMirrorProduct>
    ) => {
      const result = await actual.findMirrorProduct(...args);
      if (raceHook.afterFindMirror) await raceHook.afterFindMirror();
      return result;
    },
  };
});
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
  raceHook.afterFindMirror = null;
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

  /** The image's mirror product row — since composition slice 4 the only
   * place the sellable fields (title/description/backdrop/rank) are written. */
  async function mirrorOf(imageId: string) {
    const rows = await testDb.select().from(schema.product);
    return rows.find((r) => (r.placements ?? {}).front === imageId);
  }

  /** Composition slice 4: the listing row is the visibility grant only, so
   * its sellable columns must stay null on everything written post-cutover. */
  function expectNoSellableColumns(listing: typeof schema.listing.$inferSelect) {
    expect(listing.title).toBeNull();
    expect(listing.description).toBeNull();
    expect(listing.backgroundColor).toBeNull();
    expect(listing.feedRank).toBeNull();
  }

  it("publishImage inserts a visibility row and lists the mirror product", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T", backgroundColor: "Black" });

    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing).toBeTruthy();
    expect(listing.isHidden).toBe(false);
    expectNoSellableColumns(listing);

    const mirror = await mirrorOf(imageId);
    expect(mirror?.status).toBe("listed");
    expect(mirror?.title).toBe("T");
    expect(mirror?.backdropColor).toBe("Black");
    expect(mirror?.feedRank).toBeNull();
    expect(mirror?.listedAt?.getTime()).toBe(listing.publishedAt.getTime());
  });

  it("publishImage auto-proposes a title when none supplied", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId);

    const mirror = await mirrorOf(imageId);
    expect(mirror?.title).toBe("Auto Title");
    // Descriptions are never auto-generated (2026-07-29).
    expect(mirror?.description).toBeNull();
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

  it("a racing double-publish rolls the loser back — exactly one mirror", async () => {
    const { imageId } = await seedSourceImage();

    // Prove the rollback, not the early return. The hook holds the FIRST call
    // immediately after its findMirrorProduct read — so it has decided "not
    // published, no mirror, insert one" and has written nothing yet — while
    // the SECOND call runs to completion underneath it. On release, the first
    // call's listing insert collides on the imageId primary key, and because
    // its mirror insert rides in the same db.batch it rolls back with it.
    let firstHeld!: () => void;
    const atBarrier = new Promise<void>((r) => (firstHeld = r));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    raceHook.afterFindMirror = async () => {
      raceHook.afterFindMirror = null; // hold the first caller only
      firstHeld();
      await held;
    };

    const first = publishImage(imageId, { title: "A" });
    await atBarrier;
    // The second call reads the same pre-commit world and commits first.
    await publishImage(imageId, { title: "B" });
    release();

    await expect(first).rejects.toThrow(/UNIQUE|constraint/i);

    const mirrors = (await testDb.select().from(schema.product)).filter(
      (r) => (r.placements ?? {}).front === imageId
    );
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0].title).toBe("B");
    expect(
      await testDb
        .select()
        .from(schema.listing)
        .where(eq(schema.listing.imageId, imageId))
    ).toHaveLength(1);
  });

  it("updatePublishedNaming updates the mirror product only", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T", backgroundColor: "Black" });
    await updatePublishedNaming(imageId, { title: "New", backgroundColor: "White" });

    const mirror = await mirrorOf(imageId);
    expect(mirror?.title).toBe("New");
    expect(mirror?.backdropColor).toBe("White");

    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expectNoSellableColumns(listing);
  });

  it("updatePublishedNaming refuses rather than lose the edit when the mirror is missing", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T" });
    // The mirror update is a WHERE-guarded UPDATE, so with no mirror row it
    // matches nothing: without the guard the owner's edit would silently
    // evaporate behind a success return.
    await testDb.delete(schema.product);

    await expect(
      updatePublishedNaming(imageId, { title: "New" })
    ).rejects.toThrow("no composition");
  });

  it("updatePublishedNaming refuses on an unpublished image", async () => {
    const { imageId } = await seedSourceImage();
    await expect(
      updatePublishedNaming(imageId, { title: "New" })
    ).rejects.toThrow("not published");
  });

  it("setImageHidden writes both halves; setImageFeedRank only the product", async () => {
    const { imageId } = await seedSourceImage();
    await publishImage(imageId, { title: "T" });
    await setImageHidden(imageId, true);
    await setImageFeedRank(imageId, 3);

    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    // Hidden is the visibility grant the pure guards read AND the mirror's
    // status; rank is sellable state and lives on the product alone.
    expect(listing.isHidden).toBe(true);
    expectNoSellableColumns(listing);

    const mirror = await mirrorOf(imageId);
    expect(mirror?.status).toBe("hidden");
    expect(mirror?.feedRank).toBe(3);
  });

  it("unpublishImage deletes the listing and drafts the mirror; re-publish is fresh", async () => {
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
    expect((await mirrorOf(imageId))?.status).toBe("draft");

    // Re-publish = fresh listing (cutover judgment call: prior title/backdrop/
    // hidden/rank don't carry over — the revived mirror is overwritten).
    await publishImage(imageId);
    const [listing] = await testDb
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.imageId, imageId));
    expect(listing.isHidden).toBe(false);

    const mirror = await mirrorOf(imageId);
    expect(mirror?.status).toBe("listed");
    expect(mirror?.title).toBe("Auto Title");
    expect(mirror?.feedRank).toBeNull();
    expect(mirror?.listedAt?.getTime()).toBe(listing.publishedAt.getTime());
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
