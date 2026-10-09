/**
 * The generation continuation records image.luminance (#139): the mean
 * luminance of the fetched PNG, or NULL (never a failed job) when the bytes
 * do not decode. Mock boilerplate mirrors explicit-anchor.integration.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import sharp from "sharp";

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

async function whitePng(): Promise<ArrayBuffer> {
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("the continuation writes image.luminance (#139)", () => {
  it("stores the mean luminance of the fetched PNG", async () => {
    const designId = await seedDesign();
    vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: whitePng })));

    const result = expectQueued(await generateDesign(designId, "a white cat"));
    await drainAfter();

    const [row] = await testDb.select().from(schema.image).where(eq(schema.image.id, result.imageId));
    expect(row.luminance).toBeCloseTo(1, 3);
  });

  it("stores NULL and still succeeds when the bytes do not decode", async () => {
    const designId = await seedDesign();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }))
    );

    const result = expectQueued(await generateDesign(designId, "a cat"));
    await drainAfter();

    const [row] = await testDb.select().from(schema.image).where(eq(schema.image.id, result.imageId));
    expect(row).toBeDefined();
    expect(row.luminance).toBeNull();
    const [job] = await jobs(designId);
    expect(job.status).toBe("succeeded");
  });
});
