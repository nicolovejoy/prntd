/**
 * publishImage's anonymous-session gate (security fix, see AGENTS.md /
 * task-2-brief.md). The guest funnel mints a real Better-Auth user row for
 * every signed-out visitor, so `if (!session)` alone lets a guest publish to
 * the PUBLIC `/` feed and `/shop`. Runs against a real in-memory libSQL
 * (#28), driving the server action with db/auth mocked so the guard actually
 * executes against a row.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;
let currentUserId: string;
// The neighbouring integration tests fix `isAnonymousUser` to `() => false`;
// this file is the one that needs it switchable per test, so it reads this
// mutable flag instead of the session's own shape.
let isAnonymous: boolean;

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
      getSession: async () => ({ user: { id: currentUserId } }),
    },
  },
  isAnonymousUser: () => isAnonymous,
}));
vi.mock("@/lib/ai", () => ({
  generatePublishedNaming: async () => ({
    title: "Auto Title",
    description: "Auto Description",
  }),
}));

const { publishImage } = await import("@/app/designs/actions");

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = "u1";
  isAnonymous = false;
  await makeUser(testDb, "u1");
});

async function listingRows(imageId: string) {
  return testDb.select().from(schema.listing).where(eq(schema.listing.imageId, imageId));
}

describe("publishImage — anonymous (guest-funnel) sessions are rejected", () => {
  it("throws for an anonymous session and leaves the image unlisted", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/a.png",
    });
    isAnonymous = true;

    await expect(publishImage(imageId, { title: "T" })).rejects.toThrow(
      "Sign in to publish"
    );
    expect(await listingRows(imageId)).toHaveLength(0);
  });

  it("still succeeds for a real (non-anonymous) session", async () => {
    const d = await makeDesign(testDb, "u1");
    const imageId = await makeSourceImage(testDb, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/b.png",
    });
    isAnonymous = false;

    await publishImage(imageId, { title: "T" });

    const rows = await listingRows(imageId);
    expect(rows).toHaveLength(1);
    expect(rows[0].publishedAt).not.toBeNull();
  });
});
