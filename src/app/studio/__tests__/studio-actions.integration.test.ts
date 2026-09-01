/**
 * getStudioLanes auth gate against a real in-memory libSQL. The Studio is a
 * personal-record surface (like /designs), so the action refuses signed-out
 * AND anonymous-guest callers — the page redirects them, but the action is
 * reachable directly and must hold the same line.
 *
 * Auth is mocked; the database is real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser } from "@/lib/__tests__/factories";
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
        h.userId
          ? { user: { id: h.userId, isAnonymous: h.anonymous } }
          : null,
    },
  },
  isAnonymousUser: (user: { isAnonymous?: boolean }) =>
    user.isAnonymous === true,
}));

const { getStudioLanes } = await import("@/app/studio/actions");

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "owner";
  h.anonymous = false;
  await makeUser(testDb, "owner");
});

describe("getStudioLanes", () => {
  it("refuses a signed-out caller", async () => {
    h.userId = null;
    await expect(getStudioLanes()).rejects.toThrow(/Unauthorized/);
  });

  it("refuses an anonymous guest", async () => {
    h.anonymous = true;
    await expect(getStudioLanes()).rejects.toThrow(/Unauthorized/);
  });

  it("returns only the caller's lanes", async () => {
    const [mine] = await testDb
      .insert(schema.design)
      .values({ userId: "owner" })
      .returning();
    await makeUser(testDb, "stranger");
    await testDb.insert(schema.design).values({ userId: "stranger" });

    const lanes = await getStudioLanes();

    expect(lanes.map((l) => l.designId)).toEqual([mine.id]);
  });
});
