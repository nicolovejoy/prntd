/**
 * Fresh-start-from-image (Model B slice 3 §5) against a real in-memory
 * libSQL: startConversationFromImage creates a new design + a
 * conversation_image(role=seed) link — no new image row, no R2 copy — the
 * visibility guard rejects private cross-owner seeds, and the seed lineage
 * (seed_image_id / original_designer_id, parent_image_id = null) lands on the
 * thread's first generated artifact.
 *
 * Auth, AI, R2 and the generator adapter are mocked; the database is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({
  userId: "starter",
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

// generateDesign hands the render to `after()`; collect the continuations so
// each test decides when the background half runs. A no-op mock would make
// every post-generation assertion below vacuous.
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

/** Narrow a queued generate turn, failing loudly on anything else. */
function queuedImageId(result: { kind: string; imageId?: string }): string {
  if (result.kind !== "queued" || !result.imageId) {
    throw new Error(`expected a queued generation, got ${result.kind}`);
  }
  return result.imageId;
}


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

const r2Mocks = vi.hoisted(() => ({
  uploadImageObject: vi.fn(
    async (imageId: string) => `https://r2/images/${imageId}.png`
  ),
  deleteImageObject: vi.fn(async () => {}),
}));
vi.mock("@/lib/r2", () => r2Mocks);

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

const { startConversationFromImage, generateDesign, deleteDesignImage } =
  await import("@/app/design/actions");
const { getDesignImagesForAIContext } = await import("@/lib/design-images");
const { constructDesignBrief } = await import("@/lib/ai");
const { GENERATORS } = await import("@/lib/generators/registry");

/** Seed an origin user with one design and one image; return the image id. */
async function seedOrigin(params?: {
  publishedAt?: Date | null;
  isHidden?: boolean;
  originalDesignerId?: string | null;
}) {
  await makeUser(testDb, "origin");
  const design = await makeDesign(testDb, "origin");
  const imageId = await makeSourceImage(testDb, {
    designId: design.id,
    ownerId: "origin",
    imageUrl: "https://r2/origin/1.png",
    prompt: "the original",
    publishedAt: params?.publishedAt ?? null,
    isHidden: params?.isHidden ?? false,
    originalDesignerId: params?.originalDesignerId ?? null,
  });
  return { originDesignId: design.id, imageId };
}

async function seedLinks(designId: string) {
  return testDb
    .select()
    .from(schema.conversationImage)
    .where(
      and(
        eq(schema.conversationImage.designId, designId),
        eq(schema.conversationImage.role, "seed")
      )
    );
}

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "starter";
  await makeUser(testDb, "starter");
  r2Mocks.uploadImageObject.mockClear();
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

describe("startConversationFromImage", () => {
  it("creates a design + seed link with no new image row and no R2 copy", async () => {
    const { imageId } = await seedOrigin({ publishedAt: new Date() });
    const imagesBefore = await testDb.select().from(schema.image);

    const { designId } = await startConversationFromImage(imageId);

    const [design] = await testDb
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, designId));
    expect(design.userId).toBe("starter");
    // The seed anchors the new thread immediately.
    expect(design.primaryImageId).toBe(imageId);
    // Fresh thread: nothing generated, nothing spent.
    expect(design.generationCount).toBe(0);
    expect(design.generationCost).toBe(0);
    expect(design.closedAt).toBeNull();

    const links = await seedLinks(designId);
    expect(links).toHaveLength(1);
    expect(links[0].imageId).toBe(imageId);

    // Reuse is a link: same image rows as before, same URL, no R2 traffic.
    const imagesAfter = await testDb.select().from(schema.image);
    expect(imagesAfter).toEqual(imagesBefore);
    expect(r2Mocks.uploadImageObject).not.toHaveBeenCalled();
  });

  it("seeds the AI context with the image from turn one", async () => {
    const { imageId } = await seedOrigin({ publishedAt: new Date() });
    const { designId } = await startConversationFromImage(imageId);

    const context = await getDesignImagesForAIContext(designId);
    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({
      id: imageId,
      number: 1,
      url: "https://r2/origin/1.png",
      role: "seed",
    });
  });

  it("propagates the seed's attribution root when it has one", async () => {
    const { imageId } = await seedOrigin({
      publishedAt: new Date(),
      originalDesignerId: "root-designer",
    });

    const { designId } = await startConversationFromImage(imageId);
    // Attribution now lives only on the image graph — the observable effect
    // is what the thread's first generation stamps onto its own image row
    // (getConversationSeedProvenance, replacing the dropped design mirror).
    const genImageId = queuedImageId(await generateDesign(designId, "make it blue"));
    await drainAfter();
    const [row] = await testDb
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, genImageId));
    expect(row.originalDesignerId).toBe("root-designer");
  });

  it("allows seeding from your own private image", async () => {
    h.userId = "origin";
    const { imageId } = await seedOrigin(); // unpublished

    const { designId } = await startConversationFromImage(imageId);
    expect(await seedLinks(designId)).toHaveLength(1);
  });

  it("rejects a private cross-owner image and writes nothing", async () => {
    const { imageId } = await seedOrigin(); // unpublished, owned by origin
    const designsBefore = await testDb.select().from(schema.design);

    await expect(startConversationFromImage(imageId)).rejects.toThrow(
      "Image is not available"
    );
    expect(await testDb.select().from(schema.design)).toEqual(designsBefore);
    expect(await testDb.select().from(schema.conversationImage)).toHaveLength(1); // origin's output link only
  });

  it("rejects a hidden published image for non-owners", async () => {
    const { imageId } = await seedOrigin({
      publishedAt: new Date(),
      isHidden: true,
    });
    await expect(startConversationFromImage(imageId)).rejects.toThrow(
      "Image is not available"
    );
  });

  it("rejects an unknown image id", async () => {
    await expect(startConversationFromImage("nope")).rejects.toThrow(
      "Image not found"
    );
  });
});

describe("first generation in a seeded thread", () => {
  it("records parent null + seed_image_id + original_designer_id; later ones chain parents", async () => {
    const { imageId } = await seedOrigin({ publishedAt: new Date() });
    const { designId } = await startConversationFromImage(imageId);

    const firstImageId = queuedImageId(await generateDesign(designId, "make it blue"));
    await drainAfter();
    const [firstRow] = await testDb
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, firstImageId));
    // Slice 3 §5: seed lineage, not a within-thread parent.
    expect(firstRow.parentImageId).toBeNull();
    expect(firstRow.seedImageId).toBe(imageId);
    expect(firstRow.originalDesignerId).toBe("origin");
    expect(firstRow.ownerId).toBe("starter");

    const secondImageId = queuedImageId(await generateDesign(designId, "now red"));
    await drainAfter();
    const [secondRow] = await testDb
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, secondImageId));
    // The parent chain is between the thread's outputs; lineage sticks.
    expect(secondRow.parentImageId).toBe(firstImageId);
    expect(secondRow.seedImageId).toBe(imageId);
  });
});

describe("editing on a seed-only thread", () => {
  it("anchors the edit on the seed image, not a clarification (fix 2)", async () => {
    const { imageId } = await seedOrigin({ publishedAt: new Date() });
    const { designId } = await startConversationFromImage(imageId);

    vi.mocked(constructDesignBrief).mockResolvedValueOnce({
      operation: "edit",
      message: "Making it bigger.",
      editInstruction: "make it bigger",
      referenceImage: null,
    });

    const result = await generateDesign(designId, "make it bigger");
    await drainAfter();

    // Not a clarification: the seed-only thread still has a design to edit.
    expect(result.kind).toBe("queued");
    const generateSpy = vi.mocked(GENERATORS.ideogram.generate);
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "edit", anchorImageUrl: "https://r2/origin/1.png" }),
      expect.anything()
    );
  });
});

describe("removing a seed from the thread", () => {
  it("detaches the link only — the image row and its home thread survive", async () => {
    const { imageId } = await seedOrigin({ publishedAt: new Date() });
    const { designId } = await startConversationFromImage(imageId);

    await deleteDesignImage(designId, imageId);

    expect(await seedLinks(designId)).toHaveLength(0);
    // Image row intact, origin's output link intact.
    expect(
      await testDb.select().from(schema.image).where(eq(schema.image.id, imageId))
    ).toHaveLength(1);
    expect(
      await testDb
        .select()
        .from(schema.conversationImage)
        .where(eq(schema.conversationImage.imageId, imageId))
    ).toHaveLength(1);
    // The seed was the thread's primary; with no outputs left it clears.
    const [design] = await testDb
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, designId));
    expect(design.primaryImageId).toBeNull();
  });
});
