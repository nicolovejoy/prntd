/**
 * Conversation lifecycle (Model B slice 3) at the server-action level: a
 * closed design (design.closed_at set) is read-only — chat, generation and
 * uploads are refused before any model call or quota spend — while its
 * history stays readable and its images stay usable elsewhere (back picker).
 * Close/Reopen are owner-only and reversible.
 *
 * Real in-memory libSQL (the #28 pattern); auth, AI, R2 and the generator
 * adapter are mocked so nothing hits a live API.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { CONVERSATION_CLOSED_MESSAGE } from "@/lib/design-view";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({
  userId: "u1",
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: h.userId, isAnonymous: false },
      })),
    },
  },
  isAnonymousUser: () => false,
}));

vi.mock("@/lib/ai", () => ({
  assessReadiness: vi.fn(async () => ({ ready: true, question: "", options: [] })),
  constructDesignBrief: vi.fn(async () => ({
    operation: "generate",
    message: "Here it is",
    spec: { subject: "a happy cat", elements: [{ type: "obj", desc: "a happy cat" }] },
  })),
  chatAboutDesign: vi.fn(async () => ({
    message: "Sure",
    readyToGenerate: true,
    options: [],
  })),
}));

vi.mock("@/lib/r2", () => ({
  uploadImageObject: vi.fn(
    async (imageId: string) => `https://r2/images/${imageId}.png`
  ),
  deleteImageObject: vi.fn(async () => {}),
}));

vi.mock("@/lib/generators/registry", () => {
  const ideogram = {
    id: "ideogram",
    label: "Ideogram",
    costFor: () => 0.03,
    generate: vi.fn(async () => "https://src/ideogram.png"),
  };
  return {
    DEFAULT_GENERATOR_ID: "ideogram",
    GENERATORS: { ideogram },
    getGenerator: () => ideogram,
  };
});

const {
  sendChatMessage,
  generateDesign,
  uploadReferenceImage,
  closeConversation,
  reopenConversation,
  getDesignChat,
} = await import("@/app/design/actions");
const { assertUsablePlacementImage } = await import("@/lib/back-sources");
const ai = await import("@/lib/ai");
const registry = await import("@/lib/generators/registry");
const ideogramGen = registry.GENERATORS.ideogram.generate as Mock;

async function seedClosedDesign() {
  await makeUser(testDb, "u1");
  const design = await makeDesign(testDb, "u1");
  const imageId = await makeSourceImage(testDb, {
    designId: design.id,
    ownerId: "u1",
    imageUrl: "https://r2/existing.png",
  });
  await closeConversation(design.id);
  return { designId: design.id, imageId };
}

async function designRow(designId: string) {
  const [row] = await testDb
    .select()
    .from(schema.design)
    .where(eq(schema.design.id, designId));
  return row;
}

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "u1";
  ideogramGen.mockClear();
  (ai.chatAboutDesign as Mock).mockClear();
  vi.stubEnv("GUEST_FUNNEL_ENABLED", "true");
  // The reopen test drives a full generation, which fetches the render.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }))
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("closed conversation blocks the write actions", () => {
  it("refuses a chat turn and writes no chat rows", async () => {
    const { designId } = await seedClosedDesign();

    await expect(sendChatMessage(designId, "hello")).rejects.toThrow(
      CONVERSATION_CLOSED_MESSAGE
    );
    expect(ai.chatAboutDesign).not.toHaveBeenCalled();
    expect(
      await testDb
        .select()
        .from(schema.chatMessage)
        .where(eq(schema.chatMessage.designId, designId))
    ).toHaveLength(0);
  });

  it("refuses generation before spending quota or calling the model", async () => {
    const { designId } = await seedClosedDesign();

    await expect(generateDesign(designId, "a cat")).rejects.toThrow(
      CONVERSATION_CLOSED_MESSAGE
    );
    expect(ideogramGen).not.toHaveBeenCalled();
    // The guard runs before consumeGenerationQuota — no usage row appears.
    expect(await testDb.select().from(schema.generationUsage)).toHaveLength(0);
    expect((await designRow(designId)).generationCount).toBe(0);
  });

  it("refuses an upload", async () => {
    const { designId } = await seedClosedDesign();

    await expect(
      uploadReferenceImage(designId, Buffer.from("x").toString("base64"), "ref.png")
    ).rejects.toThrow(CONVERSATION_CLOSED_MESSAGE);
  });

  it("keeps the history readable and the images usable as a back source", async () => {
    const { designId, imageId } = await seedClosedDesign();

    // Read path unaffected.
    expect(await getDesignChat(designId)).toEqual([]);
    // The closed thread's image still passes the placement-source guard
    // (owner path) — closed constrains the thread, never the images.
    await expect(
      assertUsablePlacementImage(imageId, designId, "u1")
    ).resolves.toBeUndefined();
  });
});

describe("close / reopen", () => {
  it("close sets the timestamp, reopen clears it and generation works again", async () => {
    const { designId } = await seedClosedDesign();
    expect((await designRow(designId)).closedAt).not.toBeNull();

    await reopenConversation(designId);
    expect((await designRow(designId)).closedAt).toBeNull();

    const res = await generateDesign(designId, "a cat");
    expect(res.imageUrl).toBe(`https://r2/images/${res.imageId}.png`);
  });

  it("is idempotent: closing twice keeps the first timestamp shape, reopening an open thread no-ops", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");

    await reopenConversation(design.id); // open → no-op
    expect((await designRow(design.id)).closedAt).toBeNull();

    await closeConversation(design.id);
    await closeConversation(design.id); // closed → no-op
    expect((await designRow(design.id)).closedAt).not.toBeNull();
  });

  it("rejects a non-owner for both close and reopen", async () => {
    const { designId } = await seedClosedDesign();
    await makeUser(testDb, "intruder");
    h.userId = "intruder";

    await expect(reopenConversation(designId)).rejects.toThrow("Unauthorized");
    await expect(closeConversation(designId)).rejects.toThrow("Unauthorized");
    expect((await designRow(designId)).closedAt).not.toBeNull();
  });
});
