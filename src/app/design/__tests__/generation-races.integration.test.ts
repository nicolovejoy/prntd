/**
 * Generation-race regressions (#40, WP2) at the server-action level. Proves the
 * R2 key is derived from the atomically reserved generation number, that two
 * concurrent generates land on distinct keys (no overwrite), that the
 * success-path writes commit as one batch, that a post-upload failure cleans up
 * the orphaned R2 object, and that a failed generation refunds the consumed
 * quota unit.
 *
 * The DB is real in-memory libSQL (the #28 pattern); the generator adapter,
 * R2 client, AI, auth, and `fetch` are mocked so nothing hits a live API.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
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
vi.mock("next/server", () => ({ after: () => {} }));
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
  assessReadiness: vi.fn(async () => ({ ready: true, question: "", options: [] })),
  constructFluxPrompt: vi.fn(async () => ({
    message: "Here it is",
    fluxPrompt: "a happy cat",
    negativePrompt: null,
    referenceImage: null,
  })),
  chatAboutDesign: vi.fn(async () => ({
    message: "",
    readyToGenerate: true,
    options: [],
  })),
}));

vi.mock("@/lib/r2", () => ({
  // Encode the reserved generation number into the returned URL so the tests
  // can assert the key was derived from the reservation, not a stale read.
  uploadDesignImage: vi.fn(
    async (designId: string, gen: number) => `https://r2/${designId}/${gen}.png`
  ),
  deleteDesignImageObject: vi.fn(async () => {}),
}));

vi.mock("@/lib/generators/registry", () => {
  const ideogram = {
    id: "ideogram",
    label: "Ideogram",
    costPerImage: 0.03,
    adaptPrompt: (p: string) => p,
    generate: vi.fn(async () => "https://src/ideogram.png"),
  };
  return {
    DEFAULT_GENERATOR_ID: "ideogram",
    GENERATORS: { ideogram },
    getGenerator: () => ideogram,
  };
});

const { generateDesign } = await import("@/app/design/actions");
const r2 = await import("@/lib/r2");
const registry = await import("@/lib/generators/registry");

const uploadMock = r2.uploadDesignImage as Mock;
const deleteMock = r2.deleteDesignImageObject as Mock;
const ideogramGen = registry.GENERATORS.ideogram.generate as Mock;

async function seedDesign(generationCount = 0): Promise<string> {
  await testDb.insert(schema.user).values({ id: "u1", email: "a@b.c", name: "A" });
  const [design] = await testDb
    .insert(schema.design)
    .values({ userId: "u1", generationCount })
    .returning();
  return design.id;
}

async function seedSourceImage(designId: string, url: string): Promise<string> {
  const [row] = await testDb
    .insert(schema.designImage)
    .values({ designId, aspectRatio: "1:1", imageUrl: url })
    .returning();
  return row.id;
}

async function sourceImages(designId: string) {
  return testDb
    .select()
    .from(schema.designImage)
    .where(eq(schema.designImage.designId, designId));
}

async function chatMessages(designId: string) {
  return testDb
    .select()
    .from(schema.chatMessage)
    .where(eq(schema.chatMessage.designId, designId));
}

async function getDesignRow(designId: string) {
  const [row] = await testDb
    .select()
    .from(schema.design)
    .where(eq(schema.design.id, designId));
  return row;
}

beforeEach(async () => {
  testDb = await createTestDb();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }))
  );
  uploadMock.mockClear();
  deleteMock.mockClear();
  ideogramGen.mockReset().mockResolvedValue("https://src/ideogram.png");
  delete process.env.GUEST_FUNNEL_ENABLED;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateDesign — R2 key derivation", () => {
  it("derives the key from the reserved number and batches the writes", async () => {
    const designId = await seedDesign(5);
    const seedImg = await seedSourceImage(designId, "https://r2/seed.png");

    const res = await generateDesign(designId, "make a cat");

    // Key = reserved number (6), not a re-read of the pre-generation count.
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(designId, 6, expect.anything());
    expect(res.generationNumber).toBe(6);
    expect(res.imageUrl).toBe(`https://r2/${designId}/6.png`);

    const design = await getDesignRow(designId);
    expect(design.generationCount).toBe(6);
    expect(design.generationCost).toBeCloseTo(0.03);
    expect(design.primaryImageId).toBe(res.imageId);

    const imgs = await sourceImages(designId);
    const generated = imgs.find((i) => i.id === res.imageId)!;
    expect(generated.imageUrl).toBe(`https://r2/${designId}/6.png`);
    // Provenance threaded to the pre-generation latest image, not re-read.
    expect(generated.parentImageId).toBe(seedImg);

    const msgs = await chatMessages(designId);
    expect(msgs.map((m) => m.role).sort()).toEqual(["assistant", "user"]);
    const assistant = msgs.find((m) => m.role === "assistant")!;
    expect(assistant.imageId).toBe(res.imageId);
    expect(msgs.find((m) => m.role === "user")!.content).toBe("make a cat");
  });

  it("hands two concurrent generates distinct keys (no overwrite)", async () => {
    const designId = await seedDesign(0);

    const [a, b] = await Promise.all([
      generateDesign(designId, "one"),
      generateDesign(designId, "two"),
    ]);

    const usedNumbers = uploadMock.mock.calls.map((c) => c[1]).sort();
    expect(usedNumbers).toEqual([1, 2]);
    expect(new Set([a.imageUrl, b.imageUrl]).size).toBe(2);

    const design = await getDesignRow(designId);
    expect(design.generationCount).toBe(2);

    const imgs = await sourceImages(designId);
    const urls = imgs.map((i) => i.imageUrl).sort();
    expect(urls).toEqual([
      `https://r2/${designId}/1.png`,
      `https://r2/${designId}/2.png`,
    ]);
  });

  it("deletes the orphaned R2 object when the DB batch fails", async () => {
    const designId = await seedDesign(0);
    vi.spyOn(testDb, "batch").mockRejectedValueOnce(new Error("boom"));

    await expect(generateDesign(designId, "boom")).rejects.toThrow();

    expect(uploadMock).toHaveBeenCalledWith(designId, 1, expect.anything());
    expect(deleteMock).toHaveBeenCalledWith(designId, 1);
    // No row was committed.
    expect(await sourceImages(designId)).toHaveLength(0);
  });

  it("refunds the consumed quota unit when generation throws", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const designId = await seedDesign(0);
    ideogramGen.mockRejectedValue(new Error("model down"));

    await expect(generateDesign(designId, "cat")).rejects.toThrow(
      "Image generation failed"
    );

    // consume bumped user:u1 → 1, the failure refunded it back to 0.
    const [usage] = await testDb
      .select()
      .from(schema.generationUsage)
      .where(eq(schema.generationUsage.bucket, "user:u1"));
    expect(usage.count).toBe(0);
    // Reservation happens after the render, so a pre-upload failure left no gap.
    expect(uploadMock).not.toHaveBeenCalled();
    expect((await getDesignRow(designId)).generationCount).toBe(0);
  });
});
