// @vitest-environment node
/**
 * GET /designs/export against real in-memory libSQL, with auth and R2 mocked.
 * The handler is the only gate on this path (the proxy doesn't cover it).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { unzipSync } from "fflate";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;
let currentUserId: string | null;
let currentIsAnonymous: boolean;
let objects: Map<string, Uint8Array>;
const getObjectByKey = vi.fn(async (key: string) => {
  const bytes = objects.get(key);
  return bytes ? Buffer.from(bytes) : null;
});

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        currentUserId
          ? { user: { id: currentUserId, isAnonymous: currentIsAnonymous } }
          : null,
    },
  },
  isAnonymousUser: (user: { isAnonymous?: boolean }) =>
    user.isAnonymous === true,
}));
vi.mock("@/lib/r2", () => ({
  getObjectByKey: (key: string) => getObjectByKey(key),
  imageKeyFromUrl: (url: string) => url.replace("https://r2/", ""),
}));

const { GET } = await import("../export/route");

let savedFlag: string | undefined;

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = "u1";
  currentIsAnonymous = false;
  objects = new Map();
  getObjectByKey.mockClear();
  savedFlag = process.env.GUEST_FUNNEL_ENABLED;
  delete process.env.GUEST_FUNNEL_ENABLED;
  await makeUser(testDb, "u1");
  await makeUser(testDb, "u2");
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.GUEST_FUNNEL_ENABLED;
  else process.env.GUEST_FUNNEL_ENABLED = savedFlag;
});

async function seedImage(ownerId: string, name: string, present = true) {
  const d = await makeDesign(testDb, ownerId);
  const id = await makeSourceImage(testDb, {
    designId: d.id,
    ownerId,
    imageUrl: `https://r2/images/${name}.png`,
  });
  if (present) {
    objects.set(`images/${name}.png`, new TextEncoder().encode(`bytes-${name}`));
  }
  return id;
}

async function makeGuest(id: string) {
  await makeUser(testDb, id);
  await testDb
    .update(schema.user)
    .set({ isAnonymous: true })
    .where(eq(schema.user.id, id));
  currentUserId = id;
  currentIsAnonymous = true;
}

async function readZip(res: Response) {
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  return { files, manifest };
}

type ManifestImage = { imageId: string; filename: string | null; included: boolean };

const request = () => new Request("http://localhost/designs/export");

describe("GET /designs/export", () => {
  it("answers 401 with no session, without reading the DB or R2", async () => {
    currentUserId = null;
    const selectSpy = vi.spyOn(testDb, "select");
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(selectSpy).not.toHaveBeenCalled();
    expect(getObjectByKey).not.toHaveBeenCalled();
  });

  it("exports only a guest's own images while the guest funnel is on", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    await makeGuest("guest");
    const mine = await seedImage("guest", "guest-a");
    await seedImage("u1", "other");

    const res = await GET(request());
    expect(res.status).toBe(200);
    const { files, manifest } = await readZip(res);
    expect(manifest.images.map((i: ManifestImage) => i.imageId)).toEqual([mine]);
    expect(Object.keys(files).sort()).toEqual(
      [manifest.images[0].filename, "manifest.json"].sort(),
    );
  });

  it("refuses a guest with 403 while the guest funnel is off, without reading the DB", async () => {
    await makeGuest("guest");
    await seedImage("guest", "guest-a");

    const selectSpy = vi.spyOn(testDb, "select");
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(selectSpy).not.toHaveBeenCalled();
    expect(getObjectByKey).not.toHaveBeenCalled();
  });

  it("exports a signed-in user's images and not another user's", async () => {
    const a = await seedImage("u1", "one");
    const b = await seedImage("u1", "two");
    await seedImage("u2", "theirs");

    const selectSpy = vi.spyOn(testDb, "select");
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(selectSpy).toHaveBeenCalled();
    const { files, manifest } = await readZip(res);
    const ids = manifest.images.map((i: ManifestImage) => i.imageId);
    expect(ids.sort()).toEqual([a, b].sort());
    const names = manifest.images
      .filter((i: ManifestImage) => i.included)
      .map((i: ManifestImage) => i.filename);
    expect(Object.keys(files).sort()).toEqual([...names, "manifest.json"].sort());
    expect(getObjectByKey).not.toHaveBeenCalledWith("images/theirs.png");
    for (const n of names) {
      expect(new TextDecoder().decode(files[n])).toMatch(/^bytes-(one|two)$/);
    }
  });

  it("still answers 200 when an object is missing, and lists it as not included", async () => {
    await seedImage("u1", "here");
    const gone = await seedImage("u1", "gone", false);

    const res = await GET(request());
    expect(res.status).toBe(200);
    const { files, manifest } = await readZip(res);
    const entry = manifest.images.find((i: ManifestImage) => i.imageId === gone);
    expect(entry).toMatchObject({ included: false, filename: null });
    expect(manifest.missingCount).toBe(1);
    expect(Object.keys(files)).toHaveLength(2);
  });

  it("sets download headers", async () => {
    await seedImage("u1", "one");
    const res = await GET(request());
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="prntd-designs-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await res.arrayBuffer();
  });
});
