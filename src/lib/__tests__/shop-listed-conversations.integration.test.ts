/**
 * shopListedConversationIds against a real in-memory libSQL: a conversation
 * counts as listed exactly when the Shop feed shows a card for it, so the
 * delete confirms name the Shop when, and only when, the delete removes a
 * card (#321).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign, makeSourceImage } from "./factories";
import * as schema from "@/lib/db/schema";
import { shopListedConversationIds } from "@/lib/shop-listed-conversations";
import { getStudioLanesData } from "@/lib/studio";

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

describe("shopListedConversationIds (real DB)", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    await makeUser(testDb, "nico");
  });

  it("lists a conversation only when the feed shows one of its images", async () => {
    const listed = (await makeDesign(testDb, "nico")).id;
    const hidden = (await makeDesign(testDb, "nico")).id;
    const unpublished = (await makeDesign(testDb, "nico")).id;
    const seeded = (await makeDesign(testDb, "nico")).id;

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

    const feedIds = new Set((await getPublishedFeed()).map((r) => r.designId));
    for (const id of ids) expect(got.has(id)).toBe(feedIds.has(id));
  });

  it("returns an empty set for no ids without a query", async () => {
    expect((await shopListedConversationIds([], { db: testDb })).size).toBe(0);
  });

  it("is carried on the Studio lane", async () => {
    const listed = (await makeDesign(testDb, "nico")).id;
    const plain = (await makeDesign(testDb, "nico")).id;
    await image(listed, { published: true });
    await image(plain);

    const lanes = await getStudioLanesData("nico", { db: testDb });
    const flag = Object.fromEntries(lanes.map((l) => [l.designId, l.listedInShop]));
    expect(flag).toEqual({ [listed]: true, [plain]: false });
  });
});
