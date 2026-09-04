/**
 * "Open conversation" from the image detail page (studio-plan slice 5),
 * against a real in-memory libSQL. My Designs is a grid of images now, so this
 * is the route back to the thread — and it has to work on a conversation that
 * has archived out of the Studio, which is the case the plain link could not
 * handle.
 *
 * The db singleton and the auth session are mocked; the database is real. The
 * generation stack is mocked because the action reaches `design/actions`,
 * which constructs those clients at import time.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign } from "@/lib/__tests__/factories";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({ userId: "owner" as string | null }));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        h.userId ? { user: { id: h.userId, isAnonymous: false } } : null,
    },
  },
  isAnonymousUser: (user: { isAnonymous?: boolean }) =>
    user.isAnonymous === true,
}));
vi.mock("@/lib/ai", () => ({
  constructDesignBrief: vi.fn(),
  chatAboutDesign: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  uploadImageObject: vi.fn(),
  deleteImageObject: vi.fn(),
}));
vi.mock("@/lib/generators/registry", () => ({
  DEFAULT_GENERATOR_ID: "ideogram",
  GENERATORS: {},
  getGenerator: () => ({ id: "ideogram", costFor: () => 0.03, generate: vi.fn() }),
}));

const { openConversation } = await import("@/app/d/conversation-actions");

async function closedAtOf(designId: string) {
  const [row] = await testDb
    .select({ closedAt: schema.design.closedAt })
    .from(schema.design)
    .where(eq(schema.design.id, designId));
  return row.closedAt;
}

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "owner";
  await makeUser(testDb, "owner");
});

describe("openConversation", () => {
  it("reopens an archived conversation", async () => {
    const design = await makeDesign(testDb, "owner");
    await testDb
      .update(schema.design)
      .set({ closedAt: new Date("2026-08-30T00:00:00Z") })
      .where(eq(schema.design.id, design.id));

    await openConversation(design.id);

    expect(await closedAtOf(design.id)).toBeNull();
  });

  it("is a no-op on an open conversation", async () => {
    const design = await makeDesign(testDb, "owner");
    const before = await closedAtOf(design.id);

    await openConversation(design.id);

    expect(before).toBeNull();
    expect(await closedAtOf(design.id)).toBeNull();
  });

  it("refuses someone else's conversation, leaving it archived", async () => {
    await makeUser(testDb, "someone-else");
    const design = await makeDesign(testDb, "someone-else");
    const closedAt = new Date("2026-08-30T00:00:00Z");
    await testDb
      .update(schema.design)
      .set({ closedAt })
      .where(eq(schema.design.id, design.id));

    await expect(openConversation(design.id)).rejects.toThrow(/Unauthorized/);
    expect(await closedAtOf(design.id)).toEqual(closedAt);
  });

  it("refuses a signed-out caller", async () => {
    h.userId = null;
    const design = await makeDesign(testDb, "owner");

    await expect(openConversation(design.id)).rejects.toThrow();
  });
});
