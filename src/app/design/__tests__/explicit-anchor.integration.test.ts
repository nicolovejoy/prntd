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

vi.mock("@/app/preview/actions", () => ({
  prefetchProductMockups: vi.fn(async () => {}),
}));

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
  chatAboutDesign: vi.fn(async () => ({
    message: "",
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

const { generateDesign } = await import("@/app/design/actions");
const ai = await import("@/lib/ai");
const registry = await import("@/lib/generators/registry");

const briefMock = ai.constructDesignBrief as Mock;
const ideogramGen = registry.GENERATORS.ideogram.generate as Mock;

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
