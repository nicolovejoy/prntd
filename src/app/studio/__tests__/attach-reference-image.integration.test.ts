/**
 * attachReferenceImage (#188 slice 2a) against a real in-memory libSQL. Auth,
 * R2, the model and Ideogram are mocked; the action, the upload helper, the
 * quota and the lanes read are real.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeDesign, makeUser } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import {
  ATTACH_CONVERSATION_CLOSED,
  ATTACH_FAILED,
  ATTACH_LIMIT_REACHED,
  ATTACH_LIMIT_REACHED_IP,
  ATTACH_TOO_LARGE,
  ATTACH_UNSUPPORTED,
} from "@/lib/action-copy";
import { consumeUploadQuota, USER_UPLOAD_DAILY_CAP } from "@/lib/generation-quota";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({
  userId: "owner" as string | null,
  anonymous: false,
  ip: null as string | null,
}));

const afterQueue = vi.hoisted(() => ({ callbacks: [] as Array<() => unknown> }));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => {
    const hd = new Headers();
    if (h.ip) hd.set("x-forwarded-for", h.ip);
    return hd;
  },
}));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterQueue.callbacks.push(cb);
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        h.userId ? { user: { id: h.userId, isAnonymous: h.anonymous } } : null,
    },
  },
  isAnonymousUser: (user: { isAnonymous?: boolean }) => user.isAnonymous === true,
}));
vi.mock("@/lib/ai", () => ({
  constructDesignBrief: vi.fn(async () => ({
    operation: "edit",
    message: "Done",
    spec: { subject: "a cat", elements: [{ type: "obj", desc: "a cat" }] },
  })),
  chatAboutDesign: vi.fn(async () => ({ message: "", readyToGenerate: true, options: [] })),
}));
vi.mock("@/lib/r2", () => ({
  uploadImageObject: vi.fn(async (imageId: string) => `https://r2/images/${imageId}.png`),
  deleteImageObject: vi.fn(async () => {}),
  deleteObjectByKey: vi.fn(async () => {}),
  imageKeyFromUrl: () => null,
}));
vi.mock("@/lib/generators/registry", () => {
  const ideogram = {
    id: "ideogram",
    label: "Ideogram",
    costFor: () => 0.03,
    generate: vi.fn(async () => "https://src/ideogram.png"),
    edit: vi.fn(async () => "https://src/ideogram.png"),
  };
  return {
    DEFAULT_GENERATOR_ID: "ideogram",
    GENERATORS: { ideogram },
    getGenerator: () => ideogram,
  };
});

const { attachReferenceImage, getStudioLanes } = await import("@/app/studio/actions");
const { generateDesign } = await import("@/app/design/actions");
const r2 = await import("@/lib/r2");

let savedFlag: string | undefined;

async function png(): Promise<string> {
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

async function designRows(id: string) {
  return testDb.select().from(schema.design).where(eq(schema.design.id, id));
}

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "owner";
  h.anonymous = false;
  h.ip = null;
  afterQueue.callbacks.length = 0;
  vi.clearAllMocks();
  savedFlag = process.env.GUEST_FUNNEL_ENABLED;
  delete process.env.GUEST_FUNNEL_ENABLED;
  await makeUser(testDb, "owner");
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.GUEST_FUNNEL_ENABLED;
  else process.env.GUEST_FUNNEL_ENABLED = savedFlag;
});

describe("attachReferenceImage", () => {
  it("refuses a signed-out caller", async () => {
    h.userId = null;
    await expect(attachReferenceImage(crypto.randomUUID(), await png(), "a.png")).rejects.toThrow(
      /Unauthorized/
    );
  });

  it("admits an anonymous guest while the guest funnel is on", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    await makeUser(testDb, "guest");
    h.userId = "guest";
    h.anonymous = true;
    const r = await attachReferenceImage(crypto.randomUUID(), await png(), "a.png");
    expect(r.kind).toBe("attached");
  });

  it("refuses an anonymous guest while the guest funnel is off", async () => {
    await makeUser(testDb, "guest");
    h.userId = "guest";
    h.anonymous = true;
    await expect(attachReferenceImage(crypto.randomUUID(), await png(), "a.png")).rejects.toThrow(
      /Unauthorized/
    );
  });

  it("a new design id creates the conversation with one output cell, operation upload, and a user chat turn", async () => {
    const designId = crypto.randomUUID();
    const r = await attachReferenceImage(designId, await png(), "cat.png");
    if (r.kind !== "attached") throw new Error("expected attached");
    expect(r.designId).toBe(designId);
    expect(r.luminance).toBeCloseTo(1, 3);

    const [d] = await designRows(designId);
    expect(d.userId).toBe("owner");
    const links = await testDb
      .select()
      .from(schema.conversationImage)
      .where(eq(schema.conversationImage.designId, designId));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ imageId: r.imageId, role: "output" });
    const [img] = await testDb.select().from(schema.image).where(eq(schema.image.id, r.imageId));
    expect(img.operation).toBe("upload");
    const msgs = await testDb
      .select()
      .from(schema.chatMessage)
      .where(eq(schema.chatMessage.designId, designId));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: "user", content: "Uploaded reference image: cat.png" });
  });

  it("an existing owned open conversation gains the upload as an output cell", async () => {
    const d = await makeDesign(testDb, "owner");
    const r = await attachReferenceImage(d.id, await png(), "cat.png");
    expect(r.kind).toBe("attached");
    const links = await testDb
      .select()
      .from(schema.conversationImage)
      .where(eq(schema.conversationImage.designId, d.id));
    expect(links).toHaveLength(1);
  });

  it("another user's conversation throws Unauthorized and writes nothing", async () => {
    await makeUser(testDb, "stranger");
    const theirs = await makeDesign(testDb, "stranger");
    await expect(attachReferenceImage(theirs.id, await png(), "a.png")).rejects.toThrow(/Unauthorized/);
    expect(r2.uploadImageObject).not.toHaveBeenCalled();
  });

  it("a closed conversation returns refused with the closed message and spends no quota unit", async () => {
    const d = await makeDesign(testDb, "owner");
    await testDb.update(schema.design).set({ closedAt: new Date() }).where(eq(schema.design.id, d.id));
    const r = await attachReferenceImage(d.id, await png(), "a.png");
    expect(r).toEqual({ kind: "refused", message: ATTACH_CONVERSATION_CLOSED });
    const usage = await testDb.select().from(schema.generationUsage);
    expect(usage).toHaveLength(0);
  });

  it("the 41st attach in a UTC day returns refused with the identity message; nothing is written", async () => {
    for (let i = 0; i < USER_UPLOAD_DAILY_CAP; i++) {
      await consumeUploadQuota({ userId: "owner", ip: null, db: testDb });
    }
    const designId = crypto.randomUUID();
    const r = await attachReferenceImage(designId, await png(), "a.png");
    expect(r).toEqual({ kind: "refused", message: ATTACH_LIMIT_REACHED });
    expect(await designRows(designId)).toHaveLength(0);
    expect(r2.uploadImageObject).not.toHaveBeenCalled();
  });

  it("the 101st from one IP returns the network message; nothing is written", async () => {
    for (const [u, n] of [["a", 34], ["b", 33], ["c", 33]] as const) {
      for (let i = 0; i < n; i++) {
        await consumeUploadQuota({ userId: u, ip: "5.5.5.5", db: testDb });
      }
    }
    h.ip = "5.5.5.5";
    const designId = crypto.randomUUID();
    const r = await attachReferenceImage(designId, await png(), "a.png");
    expect(r).toEqual({ kind: "refused", message: ATTACH_LIMIT_REACHED_IP });
    expect(await designRows(designId)).toHaveLength(0);
    expect(r2.uploadImageObject).not.toHaveBeenCalled();
  });

  it("an oversize file returns refused with the too-large message and leaves no design row for a new id", async () => {
    const designId = crypto.randomUUID();
    const big = Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64");
    const r = await attachReferenceImage(designId, big, "big.png");
    expect(r).toEqual({ kind: "refused", message: ATTACH_TOO_LARGE });
    expect(await designRows(designId)).toHaveLength(0);
  });

  it("an undecodable file returns refused with the unsupported message and leaves no design row", async () => {
    const designId = crypto.randomUUID();
    const r = await attachReferenceImage(designId, Buffer.from("not an image").toString("base64"), "x.png");
    expect(r).toEqual({ kind: "refused", message: ATTACH_UNSUPPORTED });
    expect(await designRows(designId)).toHaveLength(0);
  });

  it("any other throw returns refused with ATTACH_FAILED and the thrown text is not in the message", async () => {
    (r2.uploadImageObject as Mock).mockRejectedValueOnce(new Error("R2 exploded: secret-detail"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await attachReferenceImage(crypto.randomUUID(), await png(), "a.png");
    expect(r).toEqual({ kind: "refused", message: ATTACH_FAILED });
    expect(JSON.stringify(r)).not.toContain("secret-detail");
    spy.mockRestore();
  });

  it("the returned image can be used as generateDesign's anchor", async () => {
    const designId = crypto.randomUUID();
    const r = await attachReferenceImage(designId, await png(), "cat.png");
    if (r.kind !== "attached") throw new Error("expected attached");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }))
    );
    const out = await generateDesign(designId, "make it blue", { anchorImageId: r.imageId });
    vi.unstubAllGlobals();
    expect(out.kind).toBe("queued");
  });

  it("getStudioLanes lists an upload-only conversation as a lane with one cell", async () => {
    const designId = crypto.randomUUID();
    const r = await attachReferenceImage(designId, await png(), "cat.png");
    if (r.kind !== "attached") throw new Error("expected attached");
    const lanes = await getStudioLanes();
    expect(lanes.map((l) => l.designId)).toEqual([designId]);
    expect(lanes[0].cells).toHaveLength(1);
    expect(lanes[0].cells[0].imageId).toBe(r.imageId);
    expect(lanes[0].title).toBe("Uploaded reference image: cat.png");
  });
});
