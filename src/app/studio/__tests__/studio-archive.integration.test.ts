/**
 * The archive round trip (studio-plan slice 4) end to end against a real
 * in-memory libSQL: an idle conversation leaves the Studio, shows up in the
 * archive list, and Reopen puts the lane back.
 *
 * The reopen half goes through the real `reopenConversation` — the point of
 * the slice is that archiving is a new writer of an EXISTING state, so a test
 * that nulled `closed_at` itself would prove nothing. Auth and the vendor
 * modules `design/actions` pulls in at import time are mocked; the database
 * is real.
 *
 * Since #204 the idle sweep runs via `after()`, off the render path, so
 * `getStudioLanes()` no longer archives inline — the COLLECTOR pattern
 * (generation-races.integration.test.ts) drains the queued sweep explicitly.
 * A no-op `after` would leave the sweep unrun and the archive assertions
 * vacuous.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({ userId: "owner" as string | null }));

const afterQueue = vi.hoisted(() => ({
  callbacks: [] as Array<() => unknown>,
}));

/** Run every queued `after()` continuation, in registration order. */
async function drainAfter() {
  while (afterQueue.callbacks.length) {
    await afterQueue.callbacks.shift()!();
  }
}

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterQueue.callbacks.push(cb);
  },
}));
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

const { getStudioLanes } = await import("@/app/studio/actions");
const { getStudioArchiveData } = await import("@/lib/studio");
const { reopenFromArchive } = await import("@/app/studio/archive/actions");
const { redirect } = await import("next/navigation");

const FOUR_DAYS_AGO = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "owner";
  afterQueue.callbacks.length = 0;
  vi.mocked(redirect).mockClear();
  await makeUser(testDb, "owner");
});

describe("archive round trip", () => {
  it("idle lane leaves the Studio, lands in the archive, and Reopen brings it back", async () => {
    const [design] = await testDb
      .insert(schema.design)
      .values({ userId: "owner", updatedAt: FOUR_DAYS_AGO })
      .returning();

    // The sweep is scheduled via after() (#204), off the render path, so
    // this first load still shows the lane — then the drained sweep
    // archives it.
    expect((await getStudioLanes()).map((l) => l.designId)).toEqual([
      design.id,
    ]);
    await drainAfter();

    const archived = await getStudioArchiveData("owner", { db: testDb });
    expect(archived.map((a) => a.designId)).toEqual([design.id]);

    // The next poll (after the sweep) shows the swept state.
    expect(await getStudioLanes()).toEqual([]);

    await reopenFromArchive(design.id);
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/studio");

    // Back on the bench, and out of the archive. Reopen bumps updatedAt, so
    // the lane is not immediately re-archived by the next sweep.
    const lanes = await getStudioLanes();
    expect(lanes.map((l) => l.designId)).toEqual([design.id]);
    await drainAfter();
    expect(await getStudioArchiveData("owner", { db: testDb })).toEqual([]);
  });

  it("refuses to reopen another user's conversation", async () => {
    await makeUser(testDb, "stranger");
    const [theirs] = await testDb
      .insert(schema.design)
      .values({ userId: "stranger", closedAt: new Date() })
      .returning();

    await expect(reopenFromArchive(theirs.id)).rejects.toThrow();
    expect(vi.mocked(redirect)).not.toHaveBeenCalled();
  });
});
