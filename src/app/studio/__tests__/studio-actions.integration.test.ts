/**
 * getStudioLanes auth gate against a real in-memory libSQL. The action holds
 * the same line as the page (canUseStudio): signed-out callers are refused;
 * an anonymous guest is refused while the guest funnel is off and admitted
 * while it is on (#241) — and then sees only their own lanes, because the
 * read is scoped to the session's user id. The page redirects, but the action
 * is reachable directly, so it is pinned here on its own.
 *
 * Auth is mocked; the database is real. `next/server`'s `after` is mocked
 * (#204: getStudioLanes schedules the Studio sweeps with it) — a collector,
 * not a no-op, though these tests only need it to not throw outside a real
 * request scope; sweep behavior itself is covered in
 * studio.integration.test.ts and studio-archive.integration.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({
  userId: "owner" as string | null,
  anonymous: false,
}));

const afterQueue = vi.hoisted(() => ({
  callbacks: [] as Array<() => unknown>,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterQueue.callbacks.push(cb);
  },
}));
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

let savedFlag: string | undefined;

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "owner";
  h.anonymous = false;
  afterQueue.callbacks.length = 0;
  savedFlag = process.env.GUEST_FUNNEL_ENABLED;
  delete process.env.GUEST_FUNNEL_ENABLED;
  await makeUser(testDb, "owner");
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.GUEST_FUNNEL_ENABLED;
  else process.env.GUEST_FUNNEL_ENABLED = savedFlag;
});

describe("getStudioLanes", () => {
  it("refuses a signed-out caller", async () => {
    h.userId = null;
    await expect(getStudioLanes()).rejects.toThrow(/Unauthorized/);
  });

  it("refuses an anonymous guest while the guest funnel is off", async () => {
    h.anonymous = true;
    await expect(getStudioLanes()).rejects.toThrow(/Unauthorized/);
  });

  it("gives an anonymous guest only their own lanes while the guest funnel is on", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    await makeUser(testDb, "guest");
    const [theirs] = await testDb
      .insert(schema.design)
      .values({ userId: "guest" })
      .returning();
    // The owner's lane must not leak to the guest.
    await testDb.insert(schema.design).values({ userId: "owner" });
    h.userId = "guest";
    h.anonymous = true;

    const lanes = await getStudioLanes();

    expect(lanes.map((l) => l.designId)).toEqual([theirs.id]);
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
