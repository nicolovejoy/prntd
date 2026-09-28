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

const request = (query = "", init?: RequestInit) =>
  new Request(`http://localhost/designs/export${query}`, init);

/** `n` images for `ownerId`, one second apart from `start`, all present in R2. */
async function seedMany(ownerId: string, prefix: string, n: number, start = Date.UTC(2026, 0, 1)) {
  const d = await makeDesign(testDb, ownerId);
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(3, "0")}`,
    ownerId,
    imageUrl: `https://r2/images/${prefix}-${i + 1}.png`,
    aspectRatio: "1:1",
    sourceDesignId: d.id,
    createdAt: new Date(start + i * 1000),
  }));
  for (let k = 0; k < rows.length; k += 50) {
    await testDb.insert(schema.image).values(rows.slice(k, k + 50));
  }
  for (let i = 0; i < n; i++) {
    objects.set(`images/${prefix}-${i + 1}.png`, new TextEncoder().encode(`bytes-${prefix}-${i + 1}`));
  }
  return rows.map((r) => r.id);
}

const settle = async () => {
  for (let k = 0; k < 5; k++) await new Promise((r) => setTimeout(r, 0));
};

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

  it("answers part 2 of a 150-image library with images 101–150, oldest first", async () => {
    const ids = await seedMany("u1", "img", 150);
    const res = await GET(request("?part=2"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="prntd-designs-\d{4}-\d{2}-\d{2}-part-2-of-2\.zip"$/,
    );
    const { files, manifest } = await readZip(res);
    expect(manifest).toMatchObject({ part: 2, partCount: 2, imageCount: 50, includedCount: 50 });
    expect(manifest.images.map((i: ManifestImage) => i.imageId)).toEqual(ids.slice(100));
    expect(Object.keys(files)).toHaveLength(51);
    expect(getObjectByKey).toHaveBeenCalledTimes(50);
    expect(getObjectByKey).not.toHaveBeenCalledWith("images/img-100.png");
  });

  it("answers part 1 when no part is given", async () => {
    const ids = await seedMany("u1", "img", 150);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/-part-1-of-2\.zip"$/);
    const { manifest } = await readZip(res);
    expect(manifest).toMatchObject({ part: 1, partCount: 2, imageCount: 100 });
    expect(manifest.images.map((i: ManifestImage) => i.imageId)).toEqual(ids.slice(0, 100));
  });

  it("answers 400 for a malformed part and 404 past the last part, without reading R2", async () => {
    await seedMany("u1", "img", 150);
    for (const q of ["?part=0", "?part=abc", "?part=1.5", "?part=", "?part=1&part=2", "?part=-1"]) {
      const res = await GET(request(q));
      expect(res.status, q).toBe(400);
      expect(await res.text()).toBe("Invalid part number.");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
    const res = await GET(request("?part=3"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("No such part.");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getObjectByKey).not.toHaveBeenCalled();
  });

  it("never reaches another user's images with any part value", async () => {
    const mine = await seedMany("u1", "mine", 5);
    await seedMany("u2", "theirs", 150);
    const first = await GET(request("?part=1"));
    const { manifest } = await readZip(first);
    expect(manifest.partCount).toBe(1);
    expect(manifest.images.map((i: ManifestImage) => i.imageId)).toEqual(mine);
    for (const q of ["?part=2", "?part=3"]) {
      expect((await GET(request(q))).status, q).toBe(404);
    }
    for (const call of getObjectByKey.mock.calls) {
      expect(call[0]).toMatch(/^images\/mine-/);
    }
  });

  it("reads no object for a HEAD request or an unread GET body", async () => {
    await seedMany("u1", "img", 3);
    const head = await GET(request("", { method: "HEAD" }));
    expect(head.status).toBe(200);
    const get = await GET(request());
    expect(get.status).toBe(200);
    await settle();
    expect(getObjectByKey).not.toHaveBeenCalled();
    await head.body?.cancel();
    await get.body?.cancel();
    await settle();
    expect(getObjectByKey).not.toHaveBeenCalled();
  });
});
