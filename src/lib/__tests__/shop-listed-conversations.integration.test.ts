/**
 * shopListedConversationIds and shopListingsRemovedByDelete against a real
 * in-memory libSQL. A conversation counts as listed exactly when the Shop
 * feed shows a card for it, and its delete removes a card only when the
 * delete removes the design row, which an order prevents (#321).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign, makeSourceImage } from "./factories";
import * as schema from "@/lib/db/schema";
import {
  shopListedConversationIds,
  shopListingsRemovedByDelete,
} from "@/lib/shop-listed-conversations";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { getPublishedFeed } = await import("@/lib/discover-feed");

const PUBLISHED = new Date(Date.UTC(2026, 9, 18, 12, 0));

async function image(
  designId: string,
  opts: { published?: boolean; hidden?: boolean } = {}
) {
  return makeSourceImage(testDb, {
    designId,
    ownerId: "nico",
    imageUrl: `https://img.example/${crypto.randomUUID()}.png`,
    publishedAt: opts.published ? PUBLISHED : null,
    isHidden: opts.hidden ?? false,
  });
}

async function conversation() {
  return (await makeDesign(testDb, "nico")).id;
}

async function feedConversations() {
  return new Set((await getPublishedFeed()).map((r) => r.designId));
}

describe("shopListedConversationIds (real DB)", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    await makeUser(testDb, "nico");
  });

  it("lists a conversation only when the feed shows one of its images", async () => {
    const listed = await conversation();
    const hidden = await conversation();
    const unpublished = await conversation();
    const seeded = await conversation();

    await image(listed);
    const listedImage = await image(listed, { published: true });
    await image(hidden, { published: true, hidden: true });
    await image(unpublished);
    // A seed of another conversation's listing: the card belongs to the
    // image's own conversation, so deleting this one leaves it in the Shop.
    await testDb.insert(schema.conversationImage).values({
      designId: seeded,
      imageId: listedImage,
      role: "seed",
    });

    const ids = [listed, hidden, unpublished, seeded];
    const got = await shopListedConversationIds(ids, { db: testDb });
    expect([...got]).toEqual([listed]);

    const feed = await feedConversations();
    for (const id of ids) expect(got.has(id)).toBe(feed.has(id));
  });

  it("falls back to the output link when the image names no conversation", async () => {
    const owner = await conversation();
    const seeded = await conversation();
    const img = await image(owner, { published: true });
    await testDb
      .update(schema.image)
      .set({ sourceDesignId: null })
      .where(eq(schema.image.id, img));
    await testDb.insert(schema.conversationImage).values({
      designId: seeded,
      imageId: img,
      role: "seed",
    });

    const got = await shopListedConversationIds([owner, seeded], {
      db: testDb,
    });
    expect([...got]).toEqual([owner]);
    expect(await feedConversations()).toEqual(new Set([owner]));
  });

  it("returns an empty set for no ids", async () => {
    expect((await shopListedConversationIds([], { db: testDb })).size).toBe(0);
  });
});

describe("shopListingsRemovedByDelete (real DB)", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    await makeUser(testDb, "nico");
  });

  it("leaves out a listed conversation with an order, whose card survives the delete", async () => {
    const plain = await conversation();
    const sold = await conversation();
    const unlisted = await conversation();
    await image(plain, { published: true });
    await image(sold, { published: true });
    await image(unlisted);
    await testDb.insert(schema.order).values({
      userId: "nico",
      designId: sold,
      totalPrice: 24.12,
      status: "paid",
    });

    const got = await shopListingsRemovedByDelete([plain, sold, unlisted], {
      db: testDb,
    });
    expect([...got]).toEqual([plain]);

    // What deleteDesign does to an ordered conversation: archive it. The
    // design row stays, and so does its card.
    await testDb
      .update(schema.design)
      .set({ status: "archived" })
      .where(eq(schema.design.id, sold));
    expect((await feedConversations()).has(sold)).toBe(true);
  });
});
