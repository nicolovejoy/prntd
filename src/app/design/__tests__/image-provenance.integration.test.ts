/**
 * #169 end to end against a real (in-memory libSQL) DB: what a generation
 * actually writes to `image.operation` / `image.design_spec_json`, and what
 * the publish-naming reader makes of an edit chain.
 *
 * The unit tests cover the rendering rules; this file exists because the
 * columns are only useful if the WRITE side sets them — a stamp that silently
 * never lands would pass every pure test in the suite.
 *
 * Same harness as generation-races.integration.test.ts: real DB, mocked
 * generator/R2/AI/auth, and an `after()` COLLECTOR that each test drains
 * explicitly (a no-op `after` would make every assertion vacuous).
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

const afterQueue = vi.hoisted(() => ({ callbacks: [] as Array<() => unknown> }));
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
      getSession: vi.fn(async () => ({ user: { id: "u1", isAnonymous: false } })),
    },
  },
  isAnonymousUser: () => false,
}));

vi.mock("@/lib/ai", () => ({
  constructDesignBrief: vi.fn(),
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
    costFor: (op: { kind: string }) => (op.kind === "edit" ? 0.2 : 0.03),
    generate: vi.fn(async () => "https://src/ideogram.png"),
  };
  return {
    DEFAULT_GENERATOR_ID: "ideogram",
    GENERATORS: { ideogram },
    getGenerator: () => ideogram,
  };
});

const { generateDesign, uploadReferenceImage } = await import(
  "@/app/design/actions"
);
const { getImageNamingContext } = await import("@/lib/design-images");
const ai = await import("@/lib/ai");
const briefMock = ai.constructDesignBrief as Mock;

const SPEC = {
  subject: "A bear riding a unicycle",
  style: { artStyle: "woodcut illustration" },
  elements: [{ type: "obj" as const, desc: "bear" }],
};

async function seedDesign(): Promise<string> {
  await testDb.insert(schema.user).values({ id: "u1", email: "a@b.c", name: "A" });
  const [design] = await testDb.insert(schema.design).values({ userId: "u1" }).returning();
  return design.id;
}

async function images(designId: string) {
  const rows = await testDb
    .select({ image: schema.image })
    .from(schema.conversationImage)
    .innerJoin(schema.image, eq(schema.image.id, schema.conversationImage.imageId))
    .where(eq(schema.conversationImage.designId, designId));
  return rows.map((r) => r.image);
}

beforeEach(async () => {
  testDb = await createTestDb();
  afterQueue.callbacks.length = 0;
  briefMock.mockReset();
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

describe("image provenance is persisted (#169)", () => {
  it("a generate records operation=generate and the spec it rendered", async () => {
    const designId = await seedDesign();
    briefMock.mockResolvedValue({
      operation: "generate",
      message: "Here it is",
      spec: SPEC,
    });

    await generateDesign(designId, "a bear on a unicycle, woodcut");
    await drainAfter();

    const [row] = await images(designId);
    expect(row.operation).toBe("generate");
    expect(row.designSpecJson).toEqual(SPEC);
    // The prompt column is unchanged by this slice: still the scene summary.
    expect(row.prompt).toContain("A bear riding a unicycle");
  });

  it("an edit records operation=edit, no spec, and the anchor as its parent", async () => {
    const designId = await seedDesign();
    briefMock.mockResolvedValue({
      operation: "generate",
      message: "Here it is",
      spec: SPEC,
    });
    await generateDesign(designId, "a bear on a unicycle, woodcut");
    await drainAfter();
    const [first] = await images(designId);

    briefMock.mockResolvedValue({
      operation: "edit",
      message: "Bigger bear.",
      editInstruction: "make the bear larger",
      referenceImage: 1,
    });
    await generateDesign(designId, "make the bear larger");
    await drainAfter();

    const all = await images(designId);
    const edit = all.find((r) => r.id !== first.id)!;
    expect(edit.operation).toBe("edit");
    expect(edit.designSpecJson).toBeNull();
    expect(edit.parentImageId).toBe(first.id);
    expect(edit.prompt).toBe("make the bear larger");
  });

  it("names an edit from the original brief plus the edits applied since", async () => {
    const designId = await seedDesign();
    briefMock.mockResolvedValue({
      operation: "generate",
      message: "Here it is",
      spec: SPEC,
    });
    await generateDesign(designId, "a bear on a unicycle, woodcut");
    await drainAfter();
    // Captured while it is the only image — the join's row order is not
    // guaranteed once the edit lands.
    const [first] = await images(designId);

    briefMock.mockResolvedValue({
      operation: "edit",
      message: "Bigger bear.",
      editInstruction: "make the bear larger",
      referenceImage: 1,
    });
    await generateDesign(designId, "make the bear larger");
    await drainAfter();

    const edit = (await images(designId)).find((r) => r.id !== first.id)!;

    const context = await getImageNamingContext(edit.id);
    expect(context).toBe(
      "Original design: A bear riding a unicycle — woodcut illustration. " +
        "Later edits applied: make the bear larger"
    );
    // The generate itself is named from its own brief.
    expect(await getImageNamingContext(first.id)).toBe(
      "Prompt used to generate this image:\nA bear riding a unicycle — woodcut illustration"
    );
  });

  it("an upload records operation=upload and no spec", async () => {
    const designId = await seedDesign();
    const { imageId } = await uploadReferenceImage(
      designId,
      Buffer.from("png").toString("base64"),
      "logo.png"
    );

    const [row] = (await images(designId)).filter((r) => r.id === imageId);
    expect(row.operation).toBe("upload");
    expect(row.designSpecJson).toBeNull();
    expect(await getImageNamingContext(imageId)).toBe(
      "Prompt used to generate this image:\n[user upload] logo.png"
    );
  });

  it("a legacy row (no operation) still resolves to its own prompt", async () => {
    const designId = await seedDesign();
    const legacyId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/legacy.png",
      prompt: "an old prompt",
    });
    const [row] = (await images(designId)).filter((r) => r.id === legacyId);
    expect(row.operation).toBeNull();
    expect(await getImageNamingContext(legacyId)).toBe(
      "Prompt used to generate this image:\nan old prompt"
    );
  });
});
