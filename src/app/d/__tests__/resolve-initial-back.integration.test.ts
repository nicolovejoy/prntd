/**
 * resolveInitialBack (#278) against a real in-memory libSQL: the back design
 * an image detail page link carries (`?back=<imageId>`) is honoured only when
 * the viewer could have picked it in the panel, and never throws for one they
 * could not.
 *
 * The db singleton and auth session are mocked; the database is real (FKs
 * enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) =>
    Boolean(u?.isAnonymous),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// actions.ts imports the checkout path, which constructs a Stripe client at
// load; nothing here reaches it.
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/printful", () => ({ estimateOrderCosts: vi.fn(async () => null) }));

import { resolveInitialBack } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  await makeUser(db, "other");

  const sold = await makeDesign(db, "seller");
  const listingId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/listing.png",
    publishedAt: new Date(),
  });
  const sellerPrivateId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/seller-private.png",
  });
  const sellerHiddenId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/seller-hidden.png",
    publishedAt: new Date(),
    isHidden: true,
  });

  const mine = await makeDesign(db, "buyer");
  const myImageId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine.png",
  });

  const theirs = await makeDesign(db, "other");
  const otherShopId = await makeSourceImage(db, {
    designId: theirs.id,
    ownerId: "other",
    imageUrl: "https://img.example/other-shop.png",
    publishedAt: new Date(),
  });

  return { listingId, sellerPrivateId, sellerHiddenId, myImageId, otherShopId };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveInitialBack (#278)", () => {
  it("returns the pick for the buyer's own image", async () => {
    const ids = await seed(h.db as Db);
    expect(await resolveInitialBack(ids.listingId, ids.myImageId)).toEqual({
      id: ids.myImageId,
      imageUrl: "https://img.example/mine.png",
    });
  });

  it("returns the pick for a published image owned by someone else", async () => {
    const ids = await seed(h.db as Db);
    expect(await resolveInitialBack(ids.listingId, ids.otherShopId)).toEqual({
      id: ids.otherShopId,
      imageUrl: "https://img.example/other-shop.png",
    });
  });

  it("returns null for another user's unpublished image", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolveInitialBack(ids.listingId, ids.sellerPrivateId)
    ).toBeNull();
  });

  it("returns null for an admin-hidden image", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolveInitialBack(ids.listingId, ids.sellerHiddenId)
    ).toBeNull();
  });

  it("returns null when the page image is not buyable", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolveInitialBack(ids.sellerPrivateId, ids.myImageId)
    ).toBeNull();
  });

  it("returns null when the session is anonymous", async () => {
    const ids = await seed(h.db as Db);
    h.session = { user: { id: "buyer", isAnonymous: true } };
    expect(await resolveInitialBack(ids.listingId, ids.myImageId)).toBeNull();
  });

  it("returns null with no session", async () => {
    const ids = await seed(h.db as Db);
    h.session = null;
    expect(await resolveInitialBack(ids.listingId, ids.myImageId)).toBeNull();
  });

  it("returns null when MULTI_PLACEMENT_ENABLED is unset", async () => {
    vi.stubEnv("MULTI_PLACEMENT_ENABLED", undefined);
    const ids = await seed(h.db as Db);
    expect(await resolveInitialBack(ids.listingId, ids.myImageId)).toBeNull();
  });

  it("returns null for an id that matches no image", async () => {
    const ids = await seed(h.db as Db);
    expect(await resolveInitialBack(ids.listingId, "no-such-image")).toBeNull();
  });
});

describe("resolveInitialBack for the owner's unpublished image (one buy surface, slice 3)", () => {
  async function seedOwn(db: Db) {
    const ids = await seed(db);
    // The buyer's own conversation holds the page image and a second image.
    const conversation = await makeDesign(db, "buyer");
    const pageId = await makeSourceImage(db, {
      designId: conversation.id,
      ownerId: "buyer",
      imageUrl: "https://img.example/own-page.png",
    });
    const siblingId = await makeSourceImage(db, {
      designId: conversation.id,
      ownerId: "buyer",
      imageUrl: "https://img.example/own-sibling.png",
    });
    return { ...ids, conversationId: conversation.id, pageId, siblingId };
  }

  it("returns the pick when the owner asks about their own unpublished page image", async () => {
    const ids = await seedOwn(h.db as Db);
    expect(await resolveInitialBack(ids.pageId, ids.siblingId)).toEqual({
      id: ids.siblingId,
      imageUrl: "https://img.example/own-sibling.png",
    });
    expect(await resolveInitialBack(ids.pageId, ids.otherShopId)).toEqual({
      id: ids.otherShopId,
      imageUrl: "https://img.example/other-shop.png",
    });
  });

  it("still refuses another person's private image as the back", async () => {
    const ids = await seedOwn(h.db as Db);
    expect(await resolveInitialBack(ids.pageId, ids.sellerPrivateId)).toBeNull();
  });

  it("returns null for a non-owner asking about someone else's unpublished page image", async () => {
    const ids = await seedOwn(h.db as Db);
    h.session = { user: { id: "other", isAnonymous: false } };
    expect(await resolveInitialBack(ids.pageId, ids.otherShopId)).toBeNull();
  });

  it("returns null for an anonymous owner and for a signed-out viewer", async () => {
    const ids = await seedOwn(h.db as Db);
    h.session = { user: { id: "buyer", isAnonymous: true } };
    expect(await resolveInitialBack(ids.pageId, ids.siblingId)).toBeNull();
    h.session = null;
    expect(await resolveInitialBack(ids.pageId, ids.siblingId)).toBeNull();
  });

  it("returns null when the owner's page image has no live conversation", async () => {
    const db = h.db as Db;
    const ids = await seedOwn(db);
    await db
      .update(schema.image)
      .set({ sourceDesignId: "deleted-design" })
      .where(eq(schema.image.id, ids.pageId));
    expect(await resolveInitialBack(ids.pageId, ids.siblingId)).toBeNull();
  });

  it("returns null when the page id is a placement render", async () => {
    const db = h.db as Db;
    const ids = await seedOwn(db);
    const [render] = await db
      .insert(schema.placementRender)
      .values({
        designId: ids.conversationId,
        sourceImageId: ids.pageId,
        blankId: "bella-canvas-3001",
        placementId: "back",
        imageUrl: "https://img.example/render.png",
        aspectRatio: "1:1",
      })
      .returning();
    expect(await resolveInitialBack(render.id, ids.siblingId)).toBeNull();
  });

  it("returns null for the owner's own image once it is published and admin-hidden", async () => {
    const db = h.db as Db;
    const ids = await seedOwn(db);
    const hiddenId = await makeSourceImage(db, {
      designId: ids.conversationId,
      ownerId: "buyer",
      imageUrl: "https://img.example/own-hidden.png",
      publishedAt: new Date(),
      isHidden: true,
    });
    expect(await resolveInitialBack(hiddenId, ids.siblingId)).toBeNull();
  });
});
