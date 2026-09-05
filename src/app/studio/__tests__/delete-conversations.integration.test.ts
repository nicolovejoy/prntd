/**
 * deleteConversations (#189, the Studio's bulk delete) against real in-memory
 * libSQL with FKs enforced. Auth + R2 are mocked; the database is real, so the
 * per-conversation plan/execute rules and the FK-driven failure paths are the
 * ones prod runs.
 *
 * What this pins: owned unreferenced conversations go (rows and R2 objects);
 * an ordered one is skipped WHOLE and reported — not archived, nothing of it
 * touched; ids that aren't the caller's read as not_found; a failure on one
 * conversation leaves the earlier ones deleted and reports that one; a failed
 * R2 delete never fails the action.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({
  userId: "owner" as string | null,
  anonymous: false,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        h.userId ? { user: { id: h.userId, isAnonymous: h.anonymous } } : null,
    },
  },
  isAnonymousUser: (user: { isAnonymous?: boolean }) =>
    user.isAnonymous === true,
}));
vi.mock("@/lib/r2", () => ({
  deleteObjectByKey: vi.fn(async () => {}),
  imageKeyFromUrl: (url: string) =>
    url.startsWith("https://r2.example/") ? url.slice("https://r2.example/".length) : null,
}));
// Real module, but executeDesignDeletion is spy-able so one test can make a
// single conversation's batch fail without inventing a DB fault.
vi.mock("@/lib/delete-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/delete-design")>();
  return {
    ...actual,
    executeDesignDeletion: vi.fn(actual.executeDesignDeletion),
  };
});

import { deleteObjectByKey } from "@/lib/r2";
import { executeDesignDeletion } from "@/lib/delete-design";

const { deleteConversations } = await import("@/app/studio/actions");

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "owner";
  h.anonymous = false;
  vi.mocked(deleteObjectByKey).mockClear();
  vi.mocked(deleteObjectByKey).mockImplementation(async () => {});
  vi.mocked(executeDesignDeletion).mockClear();
  await makeUser(testDb, "owner");
});

async function designRow(id: string) {
  return testDb.query.design.findFirst({ where: eq(schema.design.id, id) });
}

async function imageRow(id: string) {
  return testDb.query.image.findFirst({ where: eq(schema.image.id, id) });
}

/** A conversation owned by `userId` with one output image at an R2 URL. */
async function conversationWithImage(userId: string, key: string) {
  const d = await makeDesign(testDb, userId);
  const imageId = await makeSourceImage(testDb, {
    designId: d.id,
    ownerId: userId,
    imageUrl: `https://r2.example/${key}`,
  });
  return { designId: d.id, imageId };
}

async function orderFor(userId: string, designId: string) {
  const [o] = await testDb
    .insert(schema.order)
    .values({ userId, designId, totalPrice: 24.12, status: "paid" })
    .returning();
  await testDb.insert(schema.orderItem).values({
    orderId: o.id,
    designId,
    productId: "bella-canvas-3001",
    size: "L",
    color: "Black",
    itemPrice: 19.43,
  });
}

describe("deleteConversations — auth", () => {
  it("refuses a signed-out caller", async () => {
    h.userId = null;
    await expect(deleteConversations(["x"])).rejects.toThrow(/Unauthorized/);
  });

  it("refuses an anonymous guest", async () => {
    h.anonymous = true;
    await expect(deleteConversations(["x"])).rejects.toThrow(/Unauthorized/);
  });

  it("an empty list is a no-op", async () => {
    expect(await deleteConversations([])).toEqual({ deleted: [], skipped: [] });
  });
});

describe("deleteConversations — rules", () => {
  it("deletes owned, unreferenced conversations with their images and R2 objects", async () => {
    const a = await conversationWithImage("owner", "images/a.png");
    const b = await conversationWithImage("owner", "images/b.png");

    const result = await deleteConversations([a.designId, b.designId]);

    expect(result).toEqual({
      deleted: [a.designId, b.designId],
      skipped: [],
    });
    expect(await designRow(a.designId)).toBeUndefined();
    expect(await designRow(b.designId)).toBeUndefined();
    expect(await imageRow(a.imageId)).toBeUndefined();
    expect(await imageRow(b.imageId)).toBeUndefined();
    expect(vi.mocked(deleteObjectByKey).mock.calls.map((c) => c[0]).sort()).toEqual([
      "images/a.png",
      "images/b.png",
    ]);
  });

  it("skips an ordered conversation whole — not archived, image untouched — and reports it", async () => {
    const kept = await conversationWithImage("owner", "images/kept.png");
    const gone = await conversationWithImage("owner", "images/gone.png");
    await orderFor("owner", kept.designId);

    const result = await deleteConversations([kept.designId, gone.designId]);

    expect(result).toEqual({
      deleted: [gone.designId],
      skipped: [{ id: kept.designId, reason: "ordered" }],
    });
    const row = await designRow(kept.designId);
    expect(row).toBeDefined();
    // The single Delete archives an ordered conversation; the bulk one leaves
    // it exactly as it was.
    expect(row!.status).toBe("draft");
    expect(await imageRow(kept.imageId)).toBeDefined();
    expect(vi.mocked(deleteObjectByKey).mock.calls.map((c) => c[0])).toEqual([
      "images/gone.png",
    ]);
  });

  it("reports a conversation an organizer product FKs as product, untouched", async () => {
    const d = await makeDesign(testDb, "owner");
    const [store] = await testDb
      .insert(schema.store)
      .values({ ownerId: "owner", slug: "s", name: "S" })
      .returning();
    await testDb.insert(schema.product).values({
      ownerId: "owner",
      storeId: store.id,
      designId: d.id,
      blankId: "bella-canvas-3001",
      placements: {},
      price: 25,
    });

    const result = await deleteConversations([d.id]);

    expect(result).toEqual({
      deleted: [],
      skipped: [{ id: d.id, reason: "product" }],
    });
    expect(await designRow(d.id)).toBeDefined();
  });

  it("treats someone else's conversation and an unknown id alike: not_found, nothing deleted", async () => {
    await makeUser(testDb, "stranger");
    const theirs = await conversationWithImage("stranger", "images/theirs.png");
    const mine = await conversationWithImage("owner", "images/mine.png");

    const result = await deleteConversations([
      theirs.designId,
      "no-such-design",
      mine.designId,
    ]);

    expect(result).toEqual({
      deleted: [mine.designId],
      skipped: [
        { id: theirs.designId, reason: "not_found" },
        { id: "no-such-design", reason: "not_found" },
      ],
    });
    expect(await designRow(theirs.designId)).toBeDefined();
    expect(await imageRow(theirs.imageId)).toBeDefined();
    expect(executeDesignDeletion).toHaveBeenCalledTimes(1);
  });

  it("dedupes repeated ids", async () => {
    const a = await conversationWithImage("owner", "images/a.png");

    const result = await deleteConversations([a.designId, a.designId]);

    expect(result).toEqual({ deleted: [a.designId], skipped: [] });
    expect(executeDesignDeletion).toHaveBeenCalledTimes(1);
  });

  it("a failure mid-way leaves the earlier ones deleted and reports the failed one", async () => {
    const first = await conversationWithImage("owner", "images/1.png");
    const second = await conversationWithImage("owner", "images/2.png");
    const third = await conversationWithImage("owner", "images/3.png");
    let calls = 0;
    const real = vi.mocked(executeDesignDeletion).getMockImplementation()!;
    vi.mocked(executeDesignDeletion).mockImplementation(async (db, plan) => {
      calls += 1;
      if (calls === 2) throw new Error("batch failed");
      return real(db, plan);
    });

    const result = await deleteConversations([
      first.designId,
      second.designId,
      third.designId,
    ]);

    expect(result).toEqual({
      deleted: [first.designId, third.designId],
      skipped: [{ id: second.designId, reason: "failed" }],
    });
    expect(await designRow(first.designId)).toBeUndefined();
    expect(await designRow(second.designId)).toBeDefined();
    expect(await designRow(third.designId)).toBeUndefined();
    // No R2 cleanup for the one whose rows survived.
    expect(vi.mocked(deleteObjectByKey).mock.calls.map((c) => c[0])).toEqual([
      "images/1.png",
      "images/3.png",
    ]);
  });

  it("a failed R2 delete never fails the action", async () => {
    const a = await conversationWithImage("owner", "images/a.png");
    vi.mocked(deleteObjectByKey).mockRejectedValueOnce(new Error("R2 down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await deleteConversations([a.designId]);

    expect(result).toEqual({ deleted: [a.designId], skipped: [] });
    expect(await designRow(a.designId)).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("R2 delete failed"));
    spy.mockRestore();
  });

  it("deletes a conversation with a running generation (the UI disables it; the action does not refuse)", async () => {
    const d = await makeDesign(testDb, "owner");
    const imageId = crypto.randomUUID();
    await testDb.insert(schema.imageGeneration).values({
      designId: d.id,
      userId: "owner",
      imageId,
      r2Key: `images/${imageId}.png`,
      generationNumber: 1,
      operation: "generate",
      status: "running",
      dayKey: "2026-09-05",
      startedAt: new Date(),
    });

    const result = await deleteConversations([d.id]);

    expect(result).toEqual({ deleted: [d.id], skipped: [] });
    expect(await designRow(d.id)).toBeUndefined();
  });
});
