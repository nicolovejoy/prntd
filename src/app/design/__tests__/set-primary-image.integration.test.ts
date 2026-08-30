/**
 * setPrimaryImage + getConversationImages (#136 slice 3) against a real
 * in-memory libSQL with FKs enforced. The action lets an owner pin an earlier
 * variant as the design's current artwork, so the guards that matter are
 * ownership and "this image actually belongs to this conversation" — without
 * the latter an owner could point their design at any image id they can name.
 *
 * Auth is mocked; the database is real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({ userId: "owner" as string | null }));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        h.userId ? { user: { id: h.userId, isAnonymous: false } } : null,
    },
  },
  isAnonymousUser: () => false,
}));
// design/actions.ts constructs the Anthropic client at import time; the
// generation path isn't exercised here.
vi.mock("@/lib/ai", () => ({
  assessReadiness: vi.fn(),
  constructDesignBrief: vi.fn(),
  chatAboutDesign: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  uploadImageObject: vi.fn(),
  deleteImageObject: vi.fn(),
}));
// d/actions.ts pulls in the checkout path, which constructs Stripe at import.
vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { create: vi.fn() } } },
}));

const { setPrimaryImage } = await import("@/app/design/actions");
const { getConversationImages } = await import("@/app/d/actions");

async function seedThread() {
  await makeUser(testDb, "owner");
  const design = await makeDesign(testDb, "owner");
  const first = await makeSourceImage(testDb, {
    designId: design.id,
    ownerId: "owner",
    imageUrl: "https://r2/1.png",
    createdAt: new Date("2026-01-01"),
  });
  const second = await makeSourceImage(testDb, {
    designId: design.id,
    ownerId: "owner",
    imageUrl: "https://r2/2.png",
    createdAt: new Date("2026-01-02"),
  });
  // Newest generation is primary, as the generation path leaves it.
  await testDb
    .update(schema.design)
    .set({ primaryImageId: second })
    .where(eq(schema.design.id, design.id));
  return { designId: design.id, first, second };
}

async function primaryOf(designId: string) {
  const [row] = await testDb
    .select({ primaryImageId: schema.design.primaryImageId })
    .from(schema.design)
    .where(eq(schema.design.id, designId));
  return row.primaryImageId;
}

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "owner";
});

describe("setPrimaryImage", () => {
  it("pins an earlier variant as the design's primary", async () => {
    const { designId, first, second } = await seedThread();
    expect(await primaryOf(designId)).toBe(second);

    await setPrimaryImage(designId, first);

    expect(await primaryOf(designId)).toBe(first);
  });

  it("refuses an image that belongs to another conversation", async () => {
    const { designId, first } = await seedThread();
    const other = await makeDesign(testDb, "owner");
    const foreign = await makeSourceImage(testDb, {
      designId: other.id,
      ownerId: "owner",
      imageUrl: "https://r2/other.png",
    });

    await expect(setPrimaryImage(designId, foreign)).rejects.toThrow(
      /not part of this design/
    );
    expect(await primaryOf(designId)).not.toBe(foreign);
    expect(await primaryOf(designId)).not.toBe(first);
  });

  it("refuses a design the viewer doesn't own", async () => {
    const { designId, first, second } = await seedThread();
    await makeUser(testDb, "stranger");
    h.userId = "stranger";

    await expect(setPrimaryImage(designId, first)).rejects.toThrow(
      /Unauthorized/
    );
    expect(await primaryOf(designId)).toBe(second);
  });

  it("refuses a signed-out caller", async () => {
    const { designId, first, second } = await seedThread();
    h.userId = null;

    await expect(setPrimaryImage(designId, first)).rejects.toThrow(
      /Unauthorized/
    );
    expect(await primaryOf(designId)).toBe(second);
  });

  it("works on a closed conversation — curating the record isn't a thread write", async () => {
    const { designId, first } = await seedThread();
    await testDb
      .update(schema.design)
      .set({ closedAt: new Date() })
      .where(eq(schema.design.id, designId));

    await setPrimaryImage(designId, first);

    expect(await primaryOf(designId)).toBe(first);
  });
});

describe("getConversationImages", () => {
  it("returns the thread's images oldest-first with the primary flagged", async () => {
    const { designId, first, second } = await seedThread();

    const result = await getConversationImages(designId);

    expect(result.primaryImageId).toBe(second);
    expect(result.images.map((i) => i.imageId)).toEqual([first, second]);
    expect(result.images.map((i) => i.isPrimary)).toEqual([false, true]);
  });

  it("returns nothing to a non-owner", async () => {
    const { designId } = await seedThread();
    await makeUser(testDb, "stranger");
    h.userId = "stranger";

    expect(await getConversationImages(designId)).toEqual({
      images: [],
      primaryImageId: null,
    });
  });

  it("returns nothing to a signed-out viewer", async () => {
    const { designId } = await seedThread();
    h.userId = null;

    expect(await getConversationImages(designId)).toEqual({
      images: [],
      primaryImageId: null,
    });
  });
});
