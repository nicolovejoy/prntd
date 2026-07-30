/**
 * Generation-race regressions (#40, WP2) at the server-action level, updated
 * for the slice-4 writer cutover: R2 keys are id-keyed (images/{imageId}.png,
 * minted before upload) so two concurrent generates can't collide; the display
 * counter still increments atomically; a post-upload failure cleans up the
 * orphaned R2 object; a failed generation refunds the consumed quota unit.
 *
 * The DB is real in-memory libSQL (the #28 pattern); the generator adapter,
 * R2 client, AI, auth, and `fetch` are mocked so nothing hits a live API.
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
  // Echo the id-keyed object path so the tests can assert the key came from
  // the pre-minted image id.
  uploadImageObject: vi.fn(
    async (imageId: string) => `https://r2/images/${imageId}.png`
  ),
  deleteImageObject: vi.fn(async () => {}),
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

const uploadMock = r2.uploadImageObject as Mock;
const deleteMock = r2.deleteImageObject as Mock;
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
  return makeSourceImage(testDb, {
    designId,
    ownerId: "u1",
    imageUrl: url,
  });
}

async function sourceImages(designId: string) {
  // Post-cutover shape: artifacts live in `image`, linked via conversation_image.
  const rows = await testDb
    .select({ image: schema.image })
    .from(schema.conversationImage)
    .innerJoin(
      schema.image,
      eq(schema.image.id, schema.conversationImage.imageId)
    )
    .where(eq(schema.conversationImage.designId, designId));
  return rows.map((r) => r.image);
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

describe("generateDesign — id-keyed R2 objects", () => {
  it("uploads under the minted image id and batches the writes", async () => {
    const designId = await seedDesign(5);
    const seedImg = await seedSourceImage(designId, "https://r2/seed.png");

    const res = await generateDesign(designId, "make a cat");
    // A null imageId means the action returned a clarification instead of a
    // generation — fail loudly and narrow the type for the queries below.
    if (res.imageId === null) throw new Error("expected a generated imageId");

    // Key = the pre-minted image id; the counter is display-only but still
    // increments atomically past the seeded value.
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(res.imageId, expect.anything());
    expect(res.generationNumber).toBe(6);
    expect(res.imageUrl).toBe(`https://r2/images/${res.imageId}.png`);

    const design = await getDesignRow(designId);
    expect(design.generationCount).toBe(6);
    expect(design.generationCost).toBeCloseTo(0.03);
    expect(design.primaryImageId).toBe(res.imageId);

    const imgs = await sourceImages(designId);
    const generated = imgs.find((i) => i.id === res.imageId)!;
    expect(generated.imageUrl).toBe(`https://r2/images/${res.imageId}.png`);
    // Provenance threaded to the pre-generation latest image, not re-read.
    expect(generated.parentImageId).toBe(seedImg);
    // Writer cutover: no design_image row for the new generation.
    expect(
      await testDb
        .select()
        .from(schema.designImage)
        .where(eq(schema.designImage.id, res.imageId))
    ).toHaveLength(0);

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

    // Distinct minted ids → distinct object keys and URLs.
    const usedIds = uploadMock.mock.calls.map((c) => c[0]);
    expect(new Set(usedIds).size).toBe(2);
    expect(new Set([a.imageUrl, b.imageUrl]).size).toBe(2);

    const design = await getDesignRow(designId);
    expect(design.generationCount).toBe(2);

    const imgs = await sourceImages(designId);
    expect(imgs.map((i) => i.imageUrl).sort()).toEqual(
      usedIds.map((id) => `https://r2/images/${id}.png`).sort()
    );
  });

  it("deletes the orphaned R2 object when the DB batch fails", async () => {
    const designId = await seedDesign(0);
    vi.spyOn(testDb, "batch").mockRejectedValueOnce(new Error("boom"));

    await expect(generateDesign(designId, "boom")).rejects.toThrow();

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const mintedId = uploadMock.mock.calls[0][0];
    expect(deleteMock).toHaveBeenCalledWith(mintedId);
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
