/**
 * Generation races at the server-action level, updated for the durable-job
 * slice: generateDesign now inserts an `image_generation` row, returns
 * `kind:"queued"`, and finishes the render in an `after()` continuation.
 *
 * The `next/server` mock is a COLLECTOR, not a no-op — every test drains it
 * explicitly. A no-op `after` would leave the continuation unrun and every
 * assertion below vacuously green, which is the failure mode this file is
 * most exposed to.
 *
 * Invariants carried forward from #40/slice 4: id-keyed R2 objects
 * (images/{imageId}.png, minted before the provider call), an atomic display
 * counter, orphan cleanup on a failed write, and a refunded quota unit on a
 * failed generation — the refund now riding the job row's transition.
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

// The continuation collector. Nothing runs until a test drains it, so every
// "after the render lands" assertion is explicit about when that happened.
const afterQueue = vi.hoisted(() => ({
  callbacks: [] as Array<() => unknown>,
  // Set to make `after` itself throw — the one place a throw can land after
  // the job row exists, which is what the double-refund boundary test needs.
  throwOnSchedule: null as Error | null,
}));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    if (afterQueue.throwOnSchedule) throw afterQueue.throwOnSchedule;
    afterQueue.callbacks.push(cb);
  },
}));

/** Run the queued continuations in registration order (FIFO). */
async function drainAfter() {
  while (afterQueue.callbacks.length) {
    await afterQueue.callbacks.shift()!();
  }
}

/** Run exactly one queued continuation, by index, and remove it. */
async function drainOne(index: number) {
  const [cb] = afterQueue.callbacks.splice(index, 1);
  if (!cb) throw new Error(`no queued continuation at index ${index}`);
  await cb();
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
  assessReadiness: vi.fn(async () => ({ ready: true, question: "", options: [] })),
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
    costFor: () => 0.03,
    generate: vi.fn(async () => "https://src/ideogram.png"),
  };
  return {
    DEFAULT_GENERATOR_ID: "ideogram",
    GENERATORS: { ideogram },
    getGenerator: () => ideogram,
  };
});

const { generateDesign, cancelGeneration, getDesignJobs } = await import(
  "@/app/design/actions"
);
const { cancelGenerationJob, sweepStaleJobs, STALE_JOB_MS, GENERATION_CONCURRENCY_CAP } =
  await import("@/lib/generation-job");
const ai = await import("@/lib/ai");
const { auth: authMock } = await import("@/lib/auth");
const r2 = await import("@/lib/r2");
const registry = await import("@/lib/generators/registry");

const uploadMock = r2.uploadImageObject as Mock;
const deleteMock = r2.deleteImageObject as Mock;
const ideogramGen = registry.GENERATORS.ideogram.generate as Mock;
const readinessMock = ai.assessReadiness as Mock;

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

async function jobs(designId: string) {
  return testDb
    .select()
    .from(schema.imageGeneration)
    .where(eq(schema.imageGeneration.designId, designId));
}

async function userQuotaCount() {
  const [usage] = await testDb
    .select()
    .from(schema.generationUsage)
    .where(eq(schema.generationUsage.bucket, "user:u1"));
  return usage?.count ?? null;
}

/** Narrow a queued turn, failing loudly on a clarification/limit result. */
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
  afterQueue.throwOnSchedule = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }))
  );
  uploadMock.mockClear();
  deleteMock.mockClear();
  ideogramGen.mockReset().mockResolvedValue("https://src/ideogram.png");
  readinessMock
    .mockReset()
    .mockResolvedValue({ ready: true, question: "", options: [] });
  delete process.env.GUEST_FUNNEL_ENABLED;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateDesign — job insert + continuation", () => {
  it("uploads under the minted image id and batches the writes", async () => {
    const designId = await seedDesign(5);
    const seedImg = await seedSourceImage(designId, "https://r2/seed.png");

    const res = expectQueued(await generateDesign(designId, "make a cat"));

    // Nothing has rendered yet — the action returned as soon as the job row
    // existed. The number is reserved at submit time, though.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(res.generationNumber).toBe(6);
    const [queuedJob] = await jobs(designId);
    expect(queuedJob.status).toBe("running");
    expect(queuedJob.imageId).toBe(res.imageId);
    expect(queuedJob.r2Key).toBe(`images/${res.imageId}.png`);

    await drainAfter();

    // Key = the pre-minted image id; the counter is display-only but still
    // increments atomically past the seeded value.
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(res.imageId, expect.anything());

    const design = await getDesignRow(designId);
    expect(design.generationCount).toBe(6);
    expect(design.generationCost).toBeCloseTo(0.03);
    expect(design.primaryImageId).toBe(res.imageId);

    const imgs = await sourceImages(designId);
    const generated = imgs.find((i) => i.id === res.imageId)!;
    expect(generated.imageUrl).toBe(`https://r2/images/${res.imageId}.png`);
    // Provenance threaded to the pre-generation latest image, not re-read.
    expect(generated.parentImageId).toBe(seedImg);

    const msgs = await chatMessages(designId);
    expect(msgs.map((m) => m.role).sort()).toEqual(["assistant", "user"]);
    const assistant = msgs.find((m) => m.role === "assistant")!;
    expect(assistant.imageId).toBe(res.imageId);
    expect(msgs.find((m) => m.role === "user")!.content).toBe("make a cat");

    const [finished] = await jobs(designId);
    expect(finished.status).toBe("succeeded");
    expect(finished.finishedAt).not.toBeNull();
  });

  it("hands two concurrent generates distinct keys (no overwrite)", async () => {
    const designId = await seedDesign(0);

    const [a, b] = await Promise.all([
      generateDesign(designId, "one"),
      generateDesign(designId, "two"),
    ]);
    const qa = expectQueued(a);
    const qb = expectQueued(b);

    // Two job rows, distinct ids and distinct reserved numbers.
    const rows = await jobs(designId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(new Set(rows.map((r) => r.generationNumber))).toEqual(new Set([1, 2]));
    expect(new Set([qa.imageId, qb.imageId]).size).toBe(2);

    await drainAfter();

    // Distinct minted ids → distinct object keys and URLs.
    const usedIds = uploadMock.mock.calls.map((c) => c[0]);
    expect(new Set(usedIds).size).toBe(2);

    const design = await getDesignRow(designId);
    expect(design.generationCount).toBe(2);

    const imgs = await sourceImages(designId);
    expect(imgs.map((i) => i.imageUrl).sort()).toEqual(
      usedIds.map((id) => `https://r2/images/${id}.png`).sort()
    );
  });

  it("numbers jobs in submit order, not completion order", async () => {
    const designId = await seedDesign(0);

    const first = expectQueued(await generateDesign(designId, "one"));
    const second = expectQueued(await generateDesign(designId, "two"));

    expect(first.generationNumber).toBe(1);
    expect(second.generationNumber).toBe(2);

    // Finish them in the opposite order — the reservation already happened, so
    // the numbers can't shuffle.
    await drainOne(1);
    await drainOne(0);

    const rows = await jobs(designId);
    const byImage = new Map(rows.map((r) => [r.imageId, r.generationNumber]));
    expect(byImage.get(first.imageId)).toBe(1);
    expect(byImage.get(second.imageId)).toBe(2);
  });

  it("gives primary to the later-numbered job even when it finishes first", async () => {
    const designId = await seedDesign(0);

    const first = expectQueued(await generateDesign(designId, "one"));
    const second = expectQueued(await generateDesign(designId, "two"));

    // The LATER-numbered job completes first, then the earlier one lands.
    await drainOne(1);
    expect((await getDesignRow(designId)).primaryImageId).toBe(second.imageId);

    await drainOne(0);

    const design = await getDesignRow(designId);
    // The stale completion appended its image and its cost, but did not
    // clobber the newer hero.
    expect(design.primaryImageId).toBe(second.imageId);
    expect(design.generationCost).toBeCloseTo(0.06);
    expect((await sourceImages(designId)).map((i) => i.id).sort()).toEqual(
      [first.imageId, second.imageId].sort()
    );
    expect((await jobs(designId)).every((j) => j.status === "succeeded")).toBe(true);
  });

  it("lets a cancelled job append its image without claiming primary", async () => {
    const designId = await seedDesign(0);
    const existing = await seedSourceImage(designId, "https://r2/existing.png");
    await testDb
      .update(schema.design)
      .set({ primaryImageId: existing })
      .where(eq(schema.design.id, designId));

    const res = expectQueued(await generateDesign(designId, "one"));
    expect(await cancelGenerationJob({ jobId: res.jobId, userId: "u1", db: testDb })).toBe(
      true
    );

    await drainAfter();

    const design = await getDesignRow(designId);
    // Image + cost land; the hero the user moved on to is untouched.
    expect(design.primaryImageId).toBe(existing);
    expect(design.generationCost).toBeCloseTo(0.03);
    expect((await sourceImages(designId)).map((i) => i.id)).toContain(res.imageId);

    // The slot is released even though the job was cancelled — the transition
    // is what frees it (generation-job.ts, succeedJobStatement).
    const [job] = await jobs(designId);
    expect(job.status).toBe("succeeded");
    expect(job.cancelledAt).not.toBeNull();
  });

  it("deletes the orphaned R2 object and fails the job when the DB batch fails", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const designId = await seedDesign(0);
    const res = expectQueued(await generateDesign(designId, "boom"));
    expect(await userQuotaCount()).toBe(1);

    vi.spyOn(testDb, "batch").mockRejectedValueOnce(new Error("boom"));
    await drainAfter();

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith(res.imageId);
    // No row was committed.
    expect(await sourceImages(designId)).toHaveLength(0);

    const [job] = await jobs(designId);
    expect(job.status).toBe("failed");
    expect(job.error).toContain("boom");
    // The transition carried the refund.
    expect(await userQuotaCount()).toBe(0);
  });

  it("refunds the consumed quota unit when generation throws", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const designId = await seedDesign(0);
    ideogramGen.mockRejectedValue(new Error("model down"));

    const res = expectQueued(await generateDesign(designId, "cat"));
    expect(await userQuotaCount()).toBe(1);

    // The continuation swallows the error — it must never reject past after().
    await expect(drainAfter()).resolves.toBeUndefined();

    // consume bumped user:u1 → 1, the job's failure refunded it back to 0.
    expect(await userQuotaCount()).toBe(0);
    const [job] = await jobs(designId);
    expect(job.status).toBe("failed");
    expect(job.error).toContain("model down");
    expect(job.imageId).toBe(res.imageId);
    // Nothing was uploaded and no image row landed.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(await sourceImages(designId)).toHaveLength(0);
  });

  it("creates no job row for a clarification turn", async () => {
    const designId = await seedDesign(0);
    readinessMock.mockResolvedValueOnce({
      ready: false,
      question: "What style?",
      options: [{ label: "Bold", value: "bold" }],
    });

    const res = await generateDesign(designId, "a thing");

    expect(res.kind).toBe("clarification");
    expect(await jobs(designId)).toHaveLength(0);
    expect(afterQueue.callbacks).toHaveLength(0);
    expect(ideogramGen).not.toHaveBeenCalled();
  });

  it("persists the user's message exactly once on the clarify and queued paths", async () => {
    const designId = await seedDesign(0);

    readinessMock.mockResolvedValueOnce({
      ready: false,
      question: "What style?",
      options: [],
    });
    await generateDesign(designId, "a thing");

    let msgs = await chatMessages(designId);
    expect(msgs.filter((m) => m.role === "user" && m.content === "a thing")).toHaveLength(
      1
    );
    expect(msgs.filter((m) => m.role === "assistant")).toHaveLength(1);

    await generateDesign(designId, "a thing, in bold");
    await drainAfter();

    msgs = await chatMessages(designId);
    expect(
      msgs.filter((m) => m.role === "user" && m.content === "a thing, in bold")
    ).toHaveLength(1);

    // ...and the model is not handed that sentence twice: the persisted copy is
    // trimmed off the history because buildMessages appends userMessage itself.
    const history = readinessMock.mock.calls.at(-1)![0] as Array<{
      role: string;
      content: string;
    }>;
    expect(history.at(-1)?.content).not.toBe("a thing, in bold");
  });
});

describe("refund ownership across the job-row boundary", () => {
  it("refunds a unit only once when the throw lands after the job row exists", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const designId = await seedDesign(0);
    // The only throw site past a successful insert: scheduling the
    // continuation. If generateDesign's direct-refund catch still covered this
    // span, the unit would go back here AND again when the sweeper fails the
    // orphaned running row.
    afterQueue.throwOnSchedule = new Error("after() exploded");

    await expect(generateDesign(designId, "cat")).rejects.toThrow("after() exploded");

    // No inline refund: the row exists, so the row owns the unit.
    expect(await userQuotaCount()).toBe(1);
    const [job] = await jobs(designId);
    expect(job.status).toBe("running");

    // The sweeper is the single refunder for an abandoned row...
    const { swept } = await sweepStaleJobs({
      scope: "design",
      designId,
      now: new Date(Date.now() + STALE_JOB_MS + 1000),
      db: testDb,
    });
    expect(swept).toBe(1);
    expect(await userQuotaCount()).toBe(0);

    // ...and a second sweep is a no-op, so the unit can never go back twice.
    const again = await sweepStaleJobs({
      scope: "design",
      designId,
      now: new Date(Date.now() + STALE_JOB_MS + 2000),
      db: testDb,
    });
    expect(again.swept).toBe(0);
    expect(await userQuotaCount()).toBe(0);
  });

  it("refunds inline when the throw lands before any job row exists", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const designId = await seedDesign(0);
    vi.mocked(ai.constructDesignBrief).mockRejectedValueOnce(new Error("brief down"));

    await expect(generateDesign(designId, "cat")).rejects.toThrow(
      "Failed to construct prompt"
    );

    expect(await jobs(designId)).toHaveLength(0);
    expect(await userQuotaCount()).toBe(0);
  });
});

describe("cancelGeneration + getDesignJobs (the UI's read/write surface)", () => {
  it("cancels the caller's own running job", async () => {
    const designId = await seedDesign(0);
    const res = expectQueued(await generateDesign(designId, "one"));

    expect(await cancelGeneration(res.jobId)).toBe(true);

    const [job] = await jobs(designId);
    expect(job.cancelledAt).not.toBeNull();
    // Cancel does not stop the render: the status stays running until the
    // continuation lands, which is what still holds the concurrency slot.
    expect(job.status).toBe("running");
  });

  it("refuses to cancel another user's job", async () => {
    const designId = await seedDesign(0);
    const res = expectQueued(await generateDesign(designId, "one"));

    (authMock.api.getSession as unknown as Mock).mockResolvedValueOnce({
      user: { id: "someone-else", isAnonymous: false },
    });
    expect(await cancelGeneration(res.jobId)).toBe(false);

    const [job] = await jobs(designId);
    expect(job.cancelledAt).toBeNull();
  });

  it("reports a running job, then its settled outcome once tracked", async () => {
    const designId = await seedDesign(0);
    const res = expectQueued(await generateDesign(designId, "one"));

    const live = await getDesignJobs(designId, [res.jobId]);
    expect(live.running.map((j) => j.jobId)).toEqual([res.jobId]);
    expect(live.settled).toEqual([]);

    await drainAfter();

    const done = await getDesignJobs(designId, [res.jobId]);
    expect(done.running).toEqual([]);
    // The settled report is what makes the assistant turn and the image
    // appear without a reload — the poller refreshes the whole thread on it.
    expect(done.settled).toEqual([
      { jobId: res.jobId, status: "succeeded", imageId: res.imageId, failure: null },
    ]);
  });

  it("reports a swept job as a classified timeout, never the raw string", async () => {
    const designId = await seedDesign(0);
    const res = expectQueued(await generateDesign(designId, "one"));
    afterQueue.callbacks.length = 0; // the render never lands

    await testDb
      .update(schema.imageGeneration)
      .set({ startedAt: new Date(Date.now() - STALE_JOB_MS - 1000) })
      .where(eq(schema.imageGeneration.id, res.jobId));

    // getDesignJobs sweeps on read, so the same call that notices the stale
    // job also reports it.
    const state = await getDesignJobs(designId, [res.jobId]);
    expect(state.settled).toEqual([
      { jobId: res.jobId, status: "failed", imageId: null, failure: "timeout" },
    ]);

    // The raw provider/internal string stays in the row and the logs; it can
    // echo prompt text, and this payload reaches a browser.
    const [row] = await jobs(designId);
    expect(row.error).toBe("Generation timed out");
    expect(JSON.stringify(state)).not.toContain("Generation timed out");
  });

  it("keeps a cancelled-but-running job out of `running`", async () => {
    const designId = await seedDesign(0);
    const res = expectQueued(await generateDesign(designId, "one"));
    await cancelGeneration(res.jobId);

    // Not a live spinner, and not settled either — the render is still going.
    const state = await getDesignJobs(designId, [res.jobId]);
    expect(state.running).toEqual([]);
    expect(state.settled).toEqual([]);
  });
});

describe("over-capacity refusals", () => {
  /** Fill the user's concurrency slots with running jobs on another design. */
  async function fillSlots(count: number) {
    const [other] = await testDb
      .insert(schema.design)
      .values({ userId: "u1" })
      .returning();
    for (let i = 0; i < count; i += 1) {
      await testDb.insert(schema.imageGeneration).values({
        designId: other.id,
        userId: "u1",
        status: "running",
        operation: "generate",
        imageId: crypto.randomUUID(),
        r2Key: "images/x.png",
        generationNumber: i + 1,
        dayKey: "2026-08-29",
        cost: 0.03,
        startedAt: new Date(),
      });
    }
  }

  it("advisory refusal writes nothing to the thread and gives the unit back", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const designId = await seedDesign(0);
    await fillSlots(GENERATION_CONCURRENCY_CAP);

    const res = await generateDesign(designId, "one more");

    expect(res.kind).toBe("at_capacity");
    // Same shape as the quota-denied path: a refusal leaves no trace.
    expect(await chatMessages(designId)).toHaveLength(0);
    expect(await jobs(designId)).toHaveLength(0);
    expect(await userQuotaCount()).toBe(0);
    expect(ideogramGen).not.toHaveBeenCalled();
  });

  it("authoritative refusal answers the user's turn that is already in the thread", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const designId = await seedDesign(0);
    // Advisory check passes (2 < 3), then a second tab takes the last slot
    // before the insert — the real race this path exists for.
    await fillSlots(GENERATION_CONCURRENCY_CAP - 1);
    ideogramGen.mockImplementation(async () => {
      throw new Error("never reached");
    });
    vi.mocked(ai.assessReadiness).mockImplementationOnce(async () => {
      await fillSlots(1);
      return { ready: true, question: "", options: [] };
    });

    const res = await generateDesign(designId, "one more");

    expect(res.kind).toBe("at_capacity");
    const msgs = await chatMessages(designId);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[0].content).toBe("one more");
    expect(msgs[1].content).toContain("generating already");
    expect(await jobs(designId)).toHaveLength(0);
    expect(await userQuotaCount()).toBe(0);
  });
});
