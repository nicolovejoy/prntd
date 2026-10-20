/**
 * Explicit anchors (studio slice 3) at the server-action level, against real
 * in-memory libSQL: `generateDesign(..., { anchorImageId })` must produce an
 * edit of EXACTLY the tapped image — whatever the brief classified — refuse
 * an anchor that isn't one of the conversation's images, and record the
 * anchored output as the new image's parent (fan-out lineage, not a chain
 * through "latest output").
 *
 * Mock boilerplate mirrors generation-races.integration.test.ts: the DB is
 * real; generator, R2, AI, auth and `after()` are mocked, and the `after`
 * collector is drained explicitly so continuation assertions are real.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const afterQueue = vi.hoisted(() => ({
  callbacks: [] as Array<() => unknown>,
}));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterQueue.callbacks.push(cb);
  },
}));

async function drainAfter() {
  while (afterQueue.callbacks.length) {
    await afterQueue.callbacks.shift()!();
  }
}

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: "u1", isAnonymous: false },
      })),
    },
  },
  isAnonymousUser: () => false,
}));

vi.mock("@/lib/ai", () => ({
  constructDesignBrief: vi.fn(async () => ({
    operation: "generate",
    message: "Here it is",
    spec: { subject: "a happy cat", elements: [{ type: "obj", desc: "a happy cat" }] },
  })),
}));

vi.mock("@/lib/brief-photo", () => ({
  loadBriefPhoto: vi.fn(),
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
    costFor: vi.fn(() => 0.03),
    generate: vi.fn(async () => "https://src/ideogram.png"),
  };
  return {
    DEFAULT_GENERATOR_ID: "ideogram",
    GENERATORS: { ideogram },
    getGenerator: () => ideogram,
  };
});

const { generateDesign } = await import("@/app/design/actions");
const ai = await import("@/lib/ai");
const registry = await import("@/lib/generators/registry");

const briefMock = ai.constructDesignBrief as Mock;
const briefPhoto = await import("@/lib/brief-photo");
const loadBriefPhotoMock = briefPhoto.loadBriefPhoto as Mock;
const PHOTO = { mediaType: "image/jpeg" as const, data: "AAAA" };
const ideogramGen = registry.GENERATORS.ideogram.generate as Mock;
const ideogramCost = registry.GENERATORS.ideogram.costFor as Mock;

const GENERATE_BRIEF = {
  operation: "generate" as const,
  message: "Here it is",
  spec: {
    subject: "a happy cat",
    elements: [{ type: "obj" as const, desc: "a happy cat" }],
  },
};

async function seedDesign(): Promise<string> {
  await testDb.insert(schema.user).values({ id: "u1", email: "a@b.c", name: "A" });
  const [design] = await testDb
    .insert(schema.design)
    .values({ userId: "u1" })
    .returning();
  return design.id;
}

async function jobs(designId: string) {
  return testDb
    .select()
    .from(schema.imageGeneration)
    .where(eq(schema.imageGeneration.designId, designId));
}

function expectQueued(
  result: Awaited<ReturnType<typeof generateDesign>>
): { kind: "queued"; jobId: string; generationNumber: number; imageId: string } {
  if (result.kind !== "queued") {
    throw new Error(`expected a queued generation, got ${result.kind}`);
  }
  return result;
}

beforeEach(async () => {
  testDb = await createTestDb();
  afterQueue.callbacks.length = 0;
  vi.clearAllMocks();
  briefMock.mockResolvedValue(GENERATE_BRIEF);
  loadBriefPhotoMock.mockResolvedValue(PHOTO);
  ideogramGen.mockResolvedValue("https://src/ideogram.png");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateDesign with an explicit anchor", () => {
  it("edits exactly the tapped image even when the brief says generate", async () => {
    const designId = await seedDesign();
    const anchorId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/a.png",
      createdAt: new Date(Date.now() - 60_000),
    });
    // A LATER output — without the override this would be both the edit's
    // anchor fallback and the parent, so the assertions below only pass if
    // the explicit anchor won on both counts.
    await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/b.png",
    });

    const result = expectQueued(
      await generateDesign(designId, "make it blue", { anchorImageId: anchorId })
    );

    const [job] = await jobs(designId);
    expect(job.operation).toBe("edit");
    expect(job.anchorImageId).toBe(anchorId);

    await drainAfter();

    expect(ideogramGen).toHaveBeenCalledWith(
      { kind: "edit", instruction: "make it blue", anchorImageUrl: "https://r2/a.png" },
      { aspect: "1:1" }
    );
    // Lineage records the anchor, not the latest output: fan-out ("try it
    // three ways") must not chain into a line through b.png.
    const [row] = await testDb
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, result.imageId));
    expect(row.parentImageId).toBe(anchorId);
  });

  it("keeps the brief's edit instruction but never its anchor pick", async () => {
    const designId = await seedDesign();
    const anchorId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/a.png",
      createdAt: new Date(Date.now() - 60_000),
    });
    await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/b.png",
    });
    // The brief points at image #2 (b.png); the user tapped a.png.
    briefMock.mockResolvedValue({
      operation: "edit",
      message: "Made it bigger",
      editInstruction: "increase the size of the subject",
      referenceImage: 2,
    });

    expectQueued(
      await generateDesign(designId, "bigger", { anchorImageId: anchorId })
    );
    const [job] = await jobs(designId);
    expect(job.anchorImageId).toBe(anchorId);

    await drainAfter();
    expect(ideogramGen).toHaveBeenCalledWith(
      {
        kind: "edit",
        instruction: "increase the size of the subject",
        anchorImageUrl: "https://r2/a.png",
      },
      { aspect: "1:1" }
    );
  });

  it("refuses an anchor that is not one of the conversation's images", async () => {
    const designId = await seedDesign();
    await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/a.png",
    });

    await expect(
      generateDesign(designId, "make it blue", {
        anchorImageId: crypto.randomUUID(),
      })
    ).rejects.toThrow(/not part of this conversation/);

    // Refused before any row exists — nothing for a sweeper to find.
    expect(await jobs(designId)).toEqual([]);
  });

  it("refuses an anchor an admin has hidden, before any row exists", async () => {
    const designId = await seedDesign();
    await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/visible.png",
      createdAt: new Date(Date.now() - 60_000),
    });
    const hiddenId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/hidden.png",
      publishedAt: new Date(Date.now() - 30_000),
      isHidden: true,
    });

    await expect(
      generateDesign(designId, "make it blue", { anchorImageId: hiddenId })
    ).rejects.toThrow(/not part of this conversation/);

    expect(await jobs(designId)).toEqual([]);
  });

  it("an edit with no explicit anchor skips a hidden latest output", async () => {
    const designId = await seedDesign();
    const visibleId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/visible.png",
      createdAt: new Date(Date.now() - 60_000),
    });
    await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/hidden.png",
      publishedAt: new Date(Date.now() - 30_000),
      isHidden: true,
    });
    briefMock.mockResolvedValue({
      operation: "edit",
      message: "Made it bigger",
      editInstruction: "increase the size of the subject",
      referenceImage: null,
    });

    expectQueued(await generateDesign(designId, "bigger"));
    const [job] = await jobs(designId);
    expect(job.anchorImageId).toBe(visibleId);
  });

  it("a fresh design id creates the conversation and generates into it", async () => {
    await testDb.insert(schema.user).values({ id: "u1", email: "a@b.c", name: "A" });
    const designId = crypto.randomUUID();

    const result = expectQueued(await generateDesign(designId, "a red dragon"));
    await drainAfter();

    const [design] = await testDb
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, designId));
    expect(design.userId).toBe("u1");
    expect(design.primaryImageId).toBe(result.imageId);
  });
});

describe("upload anchors (#356)", () => {
  async function seedUpload(designId: string, createdAt?: Date) {
    return makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/photo.png",
      operation: "upload",
      prompt: "IMG_0238.jpeg",
      ...(createdAt ? { createdAt } : {}),
    });
  }

  it("an explicit upload anchor becomes a generate from the brief's spec, anchor kept", async () => {
    const designId = await seedDesign();
    const uploadId = await seedUpload(designId, new Date("2026-01-01T00:00:00Z"));
    // A newer generated output, so the latest output is not the upload.
    const newerId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/newer.png",
      operation: "generate",
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });

    const result = expectQueued(
      await generateDesign(designId, "stylize that design", {
        anchorImageId: uploadId,
      })
    );
    const [job] = await jobs(designId);
    expect(job.operation).toBe("generate");
    expect(job.anchorImageId).toBe(uploadId);

    await drainAfter();
    expect(ideogramGen).toHaveBeenCalledWith(
      { kind: "generate", spec: GENERATE_BRIEF.spec },
      { aspect: "1:1" }
    );
    expect(ideogramGen).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "edit" }),
      expect.anything()
    );
    // The upload is an output of this conversation, so it is the parent,
    // not the newer generated output.
    expect(newerId).not.toBe(uploadId);
    const [row] = await testDb
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, result.imageId));
    expect(row.parentImageId).toBe(uploadId);
  });

  it("passes the loaded photo to the brief, 4th argument", async () => {
    const designId = await seedDesign();
    const uploadId = await seedUpload(designId);

    expectQueued(
      await generateDesign(designId, "stylize that design", {
        anchorImageId: uploadId,
      })
    );
    expect(loadBriefPhotoMock).toHaveBeenCalledWith("https://r2/photo.png");
    expect(briefMock.mock.calls[0][3]).toEqual(PHOTO);
  });

  it("a photo that cannot be loaded still generates, from a brief without it", async () => {
    const designId = await seedDesign();
    const uploadId = await seedUpload(designId);
    loadBriefPhotoMock.mockResolvedValue(null);

    expectQueued(
      await generateDesign(designId, "stylize that design", {
        anchorImageId: uploadId,
      })
    );
    expect(briefMock.mock.calls[0][3]).toBeNull();
    const [job] = await jobs(designId);
    expect(job.operation).toBe("generate");
    expect(job.anchorImageId).toBe(uploadId);
  });

  it("does not load a photo for a generated anchor or for no anchor", async () => {
    const designId = await seedDesign();
    const genId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/gen.png",
      operation: "generate",
    });
    expectQueued(
      await generateDesign(designId, "make it blue", { anchorImageId: genId })
    );
    expectQueued(await generateDesign(designId, "make it red"));
    expect(loadBriefPhotoMock).not.toHaveBeenCalled();
    expect(briefMock.mock.calls[0][3]).toBeNull();
  });

  it("a brief that says edit for an upload anchor still generates, from the user's words", async () => {
    const designId = await seedDesign();
    const uploadId = await seedUpload(designId);
    briefMock.mockResolvedValue({
      operation: "edit",
      message: "Stylized",
      editInstruction: "stylize",
      referenceImage: 1,
    });

    expectQueued(
      await generateDesign(designId, "stylize that design", {
        anchorImageId: uploadId,
      })
    );
    const [job] = await jobs(designId);
    expect(job.operation).toBe("generate");
    expect(job.anchorImageId).toBe(uploadId);

    await drainAfter();
    // fallbackSpec puts a short user message in `subject` (as lettering).
    expect(ideogramGen).toHaveBeenCalledWith(
      {
        kind: "generate",
        spec: expect.objectContaining({
          subject: 'Bold lettering reading "stylize that design"',
        }),
      },
      { aspect: "1:1" }
    );
  });

  it("an anchorless edit whose latest output is an upload also generates", async () => {
    const designId = await seedDesign();
    const uploadId = await seedUpload(designId);
    briefMock.mockResolvedValue({
      operation: "edit",
      message: "Stylized",
      editInstruction: "stylize",
      referenceImage: null,
    });

    expectQueued(await generateDesign(designId, "stylize that design"));
    const [job] = await jobs(designId);
    expect(job.operation).toBe("generate");
    expect(job.anchorImageId).toBe(uploadId);

    await drainAfter();
    expect(ideogramGen).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "edit" }),
      expect.anything()
    );
  });

  describe("an anchorless turn whose latest output is an upload", () => {
    it("is shown the photo and generates from the brief's spec, anchored on the upload", async () => {
      const designId = await seedDesign();
      const uploadId = await seedUpload(designId);

      const result = expectQueued(
        await generateDesign(designId, "a happy cat in this style")
      );
      expect(loadBriefPhotoMock).toHaveBeenCalledWith("https://r2/photo.png");
      expect(briefMock.mock.calls[0][3]).toEqual(PHOTO);

      const [job] = await jobs(designId);
      expect(job.operation).toBe("generate");
      expect(job.anchorImageId).toBe(uploadId);

      await drainAfter();
      expect(ideogramCost).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "generate" })
      );
      expect(ideogramGen).toHaveBeenCalledWith(
        { kind: "generate", spec: GENERATE_BRIEF.spec },
        { aspect: "1:1" }
      );
      const [row] = await testDb
        .select()
        .from(schema.image)
        .where(eq(schema.image.id, result.imageId));
      expect(row.parentImageId).toBe(uploadId);
    });

    it("edits the image the brief names when it is not the upload; the photo was still shown", async () => {
      const designId = await seedDesign();
      await seedUpload(designId, new Date("2026-01-02T00:00:00Z"));
      // An older generated image the brief points at; the upload is the latest.
      const olderId = await makeSourceImage(testDb, {
        designId,
        ownerId: "u1",
        imageUrl: "https://r2/older.png",
        operation: "generate",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      briefMock.mockResolvedValue({
        operation: "edit",
        message: "Stylized",
        editInstruction: "stylize",
        referenceImage: 1,
      });

      expectQueued(await generateDesign(designId, "stylize that design"));
      expect(briefMock.mock.calls[0][3]).toEqual(PHOTO);
      const [job] = await jobs(designId);
      expect(job.operation).toBe("edit");
      expect(job.anchorImageId).toBe(olderId);

      await drainAfter();
      expect(ideogramGen).toHaveBeenCalledTimes(1);
      expect(ideogramGen).toHaveBeenCalledWith(
        {
          kind: "edit",
          instruction: "stylize",
          anchorImageUrl: "https://r2/older.png",
        },
        expect.anything()
      );
    });

    it.each([
      ["names no reference", null],
      ["names a number that matches no image", 99],
      ["names the upload itself", 1],
    ])(
      "renders the user's words as a generate anchored on the upload when the brief's edit %s",
      async (_label, referenceImage) => {
        const designId = await seedDesign();
        const uploadId = await seedUpload(designId);
        briefMock.mockResolvedValue({
          operation: "edit",
          message: "Stylized",
          editInstruction: "stylize",
          referenceImage,
        });

        expectQueued(await generateDesign(designId, "stylize that design"));
        expect(briefMock.mock.calls[0][3]).toEqual(PHOTO);
        const [job] = await jobs(designId);
        expect(job.operation).toBe("generate");
        expect(job.anchorImageId).toBe(uploadId);

        await drainAfter();
        expect(ideogramGen).toHaveBeenCalledWith(
          {
            kind: "generate",
            spec: expect.objectContaining({
              subject: 'Bold lettering reading "stylize that design"',
            }),
          },
          { aspect: "1:1" }
        );
        expect(ideogramGen).not.toHaveBeenCalledWith(
          expect.objectContaining({ kind: "edit" }),
          expect.anything()
        );
      }
    );

    it("a conversation whose only image is a seed upload generates anchored on the seed, with no parent", async () => {
      const designId = await seedDesign();
      const [other] = await testDb
        .insert(schema.design)
        .values({ userId: "u1" })
        .returning();
      const seedId = await makeSourceImage(testDb, {
        designId: other.id,
        ownerId: "u1",
        imageUrl: "https://r2/seed-photo.png",
        operation: "upload",
      });
      await testDb
        .insert(schema.conversationImage)
        .values({ designId, imageId: seedId, role: "seed" });

      const result = expectQueued(
        await generateDesign(designId, "a happy cat in this style")
      );
      expect(loadBriefPhotoMock).toHaveBeenCalledWith("https://r2/seed-photo.png");
      expect(briefMock.mock.calls[0][3]).toEqual(PHOTO);
      const [job] = await jobs(designId);
      expect(job.operation).toBe("generate");
      expect(job.anchorImageId).toBe(seedId);

      await drainAfter();
      const [row] = await testDb
        .select()
        .from(schema.image)
        .where(eq(schema.image.id, result.imageId));
      expect(row.parentImageId).toBeNull();
    });

    it("renders the words, anchored on the upload, when the brief asks a question", async () => {
      const designId = await seedDesign();
      const uploadId = await seedUpload(designId);
      briefMock.mockResolvedValue({
        operation: "clarify",
        message: "Which part of the photo?",
      });

      expectQueued(await generateDesign(designId, "make it cool"));
      const [job] = await jobs(designId);
      expect(job.operation).toBe("generate");
      expect(job.anchorImageId).toBe(uploadId);

      await drainAfter();
      const messages = await testDb.select().from(schema.chatMessage);
      expect(messages.map((m) => m.content)).toContain("Which part of the photo?");
    });

    it("still generates, anchored on the upload, when the photo cannot be loaded", async () => {
      const designId = await seedDesign();
      const uploadId = await seedUpload(designId);
      loadBriefPhotoMock.mockResolvedValue(null);

      expectQueued(await generateDesign(designId, "a happy cat in this style"));
      expect(briefMock.mock.calls[0][3]).toBeNull();
      const [job] = await jobs(designId);
      expect(job.operation).toBe("generate");
      expect(job.anchorImageId).toBe(uploadId);
    });
  });

  it("an anchorless turn whose latest output is generated edits it and loads no photo, even with an older upload", async () => {
    const designId = await seedDesign();
    await seedUpload(designId, new Date("2026-01-01T00:00:00Z"));
    const genId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/gen.png",
      operation: "generate",
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    briefMock.mockResolvedValue({
      operation: "edit",
      message: "Bluer",
      editInstruction: "make it blue",
      referenceImage: null,
    });

    expectQueued(await generateDesign(designId, "make it blue"));
    expect(loadBriefPhotoMock).not.toHaveBeenCalled();
    expect(briefMock.mock.calls[0][3]).toBeNull();
    const [job] = await jobs(designId);
    expect(job.operation).toBe("edit");
    expect(job.anchorImageId).toBe(genId);

    await drainAfter();
    expect(ideogramGen).toHaveBeenCalledWith(
      {
        kind: "edit",
        instruction: "make it blue",
        anchorImageUrl: "https://r2/gen.png",
      },
      expect.anything()
    );
  });

  it("a seed-role upload generates, anchored on the seed; the parent is the latest output, never the seed", async () => {
    const designId = await seedDesign();
    const outputId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/own-output.png",
      operation: "generate",
    });
    const [other] = await testDb
      .insert(schema.design)
      .values({ userId: "u1" })
      .returning();
    const seedId = await makeSourceImage(testDb, {
      designId: other.id,
      ownerId: "u1",
      imageUrl: "https://r2/seed-photo.png",
      operation: "upload",
    });
    await testDb
      .insert(schema.conversationImage)
      .values({ designId, imageId: seedId, role: "seed" });

    const result = expectQueued(
      await generateDesign(designId, "stylize that design", {
        anchorImageId: seedId,
      })
    );
    const [job] = await jobs(designId);
    expect(job.operation).toBe("generate");
    expect(job.anchorImageId).toBe(seedId);

    await drainAfter();
    const [row] = await testDb
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, result.imageId));
    // Provenance excludes seeds from the within-thread parent chain; a seed
    // anchor keeps the latest-output fallback.
    expect(row.parentImageId).toBe(outputId);
    expect(row.parentImageId).not.toBe(seedId);
  });

  it("books a generate's cost for a photo turn", async () => {
    const designId = await seedDesign();
    const uploadId = await seedUpload(designId);
    briefMock.mockResolvedValue({
      operation: "edit",
      message: "Stylized",
      editInstruction: "stylize",
      referenceImage: 1,
    });

    expectQueued(
      await generateDesign(designId, "stylize that design", {
        anchorImageId: uploadId,
      })
    );
    expect(ideogramCost).toHaveBeenCalledTimes(1);
    expect(ideogramCost).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "generate" })
    );
  });

  it("a generated-image anchor still edits", async () => {
    const designId = await seedDesign();
    const anchorId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/gen.png",
      operation: "generate",
    });

    expectQueued(
      await generateDesign(designId, "make it blue", { anchorImageId: anchorId })
    );
    const [job] = await jobs(designId);
    expect(job.operation).toBe("edit");
    expect(job.anchorImageId).toBe(anchorId);
  });
});
