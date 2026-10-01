/**
 * deleteDesignsSince (#189) against real in-memory libSQL with FKs enforced
 * (the #28 harness). The ops script is a thin CLI over this module, so this
 * is where its rules are pinned: dry run writes nothing, apply removes an
 * unreferenced conversation whole (rows + R2 keys), an order-referenced
 * conversation is skipped entirely, other users' rows are untouched, and the
 * window is inclusive on both ends.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import {
  applyGuard,
  deleteDesignsSince,
  parseWindowTimestamp,
  r2KeysForPlan,
} from "@/lib/delete-designs-since";
import { planDesignDeletion } from "@/lib/delete-design";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

// design.created_at is an integer seconds column ({ mode: "timestamp" }), so
// every fixture time sits on a whole second.
const T0 = new Date("2026-09-04T00:00:00Z");
const sec = (n: number) => new Date(T0.getTime() + n * 1000);

const keyFromUrl = (url: string) =>
  url.startsWith("https://r2/") ? url.slice("https://r2/".length) : null;

beforeEach(async () => {
  db = await createTestDb();
  await makeUser(db, "u1"); // u1@example.com
  await makeUser(db, "u2");
});

async function makeDesignAt(userId: string, createdAt: Date) {
  const [d] = await db
    .insert(schema.design)
    .values({ userId, createdAt })
    .returning();
  return d;
}

async function designIds(): Promise<string[]> {
  const rows = await db.select({ id: schema.design.id }).from(schema.design);
  return rows.map((r) => r.id).sort();
}

async function makeOrderWithLine(params: {
  userId: string;
  headDesignId: string;
  lineDesignId: string;
  placements?: Record<string, string> | null;
}) {
  const [o] = await db
    .insert(schema.order)
    .values({
      userId: params.userId,
      designId: params.headDesignId,
      totalPrice: 24.12,
      status: "paid",
    })
    .returning();
  await db.insert(schema.orderItem).values({
    orderId: o.id,
    designId: params.lineDesignId,
    productId: "bella-canvas-3001",
    size: "L",
    color: "Black",
    placements: params.placements ?? null,
    itemPrice: 19.43,
  });
  return o;
}

function run(opts: {
  email?: string;
  since?: Date;
  until?: Date;
  apply: boolean;
  deleteObject?: (key: string) => Promise<void>;
}) {
  return deleteDesignsSince(db, {
    email: opts.email ?? "u1@example.com",
    since: opts.since ?? T0,
    until: opts.until ?? sec(3600),
    apply: opts.apply,
    deleteObject: opts.deleteObject ?? (async () => {}),
    keyFromUrl,
  });
}

describe("deleteDesignsSince — dry run", () => {
  it("plans every matching conversation but writes nothing and touches no R2 object", async () => {
    const d = await makeDesignAt("u1", sec(10));
    await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/a.png",
    });
    await db
      .insert(schema.chatMessage)
      .values({ designId: d.id, role: "user", content: "a fox on a bike" });
    const deleteObject = vi.fn(async () => {});

    const result = await run({ apply: false, deleteObject });

    expect(result.matched).toBe(1);
    expect(result.deleted).toEqual([]);
    expect(result.reports[0].action).toBe("delete");
    expect(result.reports[0].label).toBe("a fox on a bike");
    expect(result.reports[0].plan.images[0].outcome).toBe("delete");
    expect(deleteObject).not.toHaveBeenCalled();
    expect(await designIds()).toEqual([d.id]);
    expect(await db.select().from(schema.image)).toHaveLength(1);
    expect(await db.select().from(schema.chatMessage)).toHaveLength(1);
  });
});

describe("deleteDesignsSince — apply", () => {
  it("deletes an unreferenced conversation, its images, links, messages, jobs, and R2 keys", async () => {
    const d = await makeDesignAt("u1", sec(10));
    const a = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/a.png",
    });
    const b = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/b.png",
      publishedAt: new Date(),
    });
    await db
      .insert(schema.chatMessage)
      .values({ designId: d.id, role: "user", content: "hi" });
    await db.insert(schema.imageGeneration).values({
      designId: d.id,
      userId: "u1",
      status: "succeeded",
      operation: "generate",
      imageId: a,
      r2Key: "images/a.png",
      generationNumber: 1,
      dayKey: "2026-09-04",
      cost: 0.03,
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    await db.insert(schema.placementRender).values({
      designId: d.id,
      sourceImageId: a,
      blankId: "bella-canvas-3001",
      placementId: "front",
      imageUrl: "https://r2/designs/x/render.png",
      aspectRatio: "1:1",
    });
    const deleted: string[] = [];
    const deleteObject = vi.fn(async (key: string) => {
      deleted.push(key);
    });

    const result = await run({ apply: true, deleteObject });

    expect(result.deleted).toEqual([d.id]);
    expect(result.skipped).toEqual([]);
    expect(await designIds()).toEqual([]);
    expect(await db.select().from(schema.image)).toHaveLength(0);
    expect(await db.select().from(schema.conversationImage)).toHaveLength(0);
    expect(await db.select().from(schema.chatMessage)).toHaveLength(0);
    expect(await db.select().from(schema.imageGeneration)).toHaveLength(0);
    expect(await db.select().from(schema.placementRender)).toHaveLength(0);
    // The published image's publication row + composition go with it.
    expect(await db.select().from(schema.imagePublication)).toHaveLength(0);
    expect(await db.select().from(schema.product)).toHaveLength(0);
    expect(deleted.sort()).toEqual(
      ["designs/x/render.png", "images/a.png", "images/b.png"].sort()
    );
    expect(result.r2Deleted).toBe(3);
    expect(result.r2Failed).toBe(0);
    expect(b).toBeTruthy();
  });

  it("survives a failed R2 delete: rows are gone, the failure is counted", async () => {
    const d = await makeDesignAt("u1", sec(10));
    await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/a.png",
    });

    const result = await run({
      apply: true,
      deleteObject: async () => {
        throw new Error("boom");
      },
    });

    expect(result.deleted).toEqual([d.id]);
    expect(result.r2Failed).toBe(1);
    expect(await designIds()).toEqual([]);
  });

  it("detaches an image another conversation seed-links instead of deleting it", async () => {
    const d = await makeDesignAt("u1", sec(10));
    const shared = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/shared.png",
    });
    // The fresh-start thread is outside the window, so it is not matched.
    const other = await makeDesignAt("u1", sec(-100));
    await db.insert(schema.conversationImage).values({
      designId: other.id,
      imageId: shared,
      role: "seed",
    });
    const deleteObject = vi.fn(async () => {});

    const result = await run({ apply: true, deleteObject });

    expect(result.deleted).toEqual([d.id]);
    expect(result.reports[0].plan.images[0].outcome).toBe("detach-seed");
    expect(
      await db.select().from(schema.image).where(eq(schema.image.id, shared))
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.conversationImage)
        .where(eq(schema.conversationImage.designId, other.id))
    ).toHaveLength(1);
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

describe("deleteDesignsSince — order references", () => {
  it("skips a conversation whose design heads an order, leaving every row in place", async () => {
    const d = await makeDesignAt("u1", sec(10));
    const img = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/a.png",
    });
    await makeOrderWithLine({ userId: "u1", headDesignId: d.id, lineDesignId: d.id });
    const deleteObject = vi.fn(async () => {});

    const result = await run({ apply: true, deleteObject });

    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([{ designId: d.id, reason: "order" }]);
    expect(await designIds()).toEqual([d.id]);
    expect(
      await db.select().from(schema.image).where(eq(schema.image.id, img))
    ).toHaveLength(1);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("skips the whole conversation when one image is pinned on another design's order line — no partial delete", async () => {
    const d = await makeDesignAt("u1", sec(10));
    const pinned = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/pinned.png",
    });
    const loose = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/loose.png",
    });
    const other = await makeDesignAt("u1", sec(-100));
    const front = await makeSourceImage(db, {
      designId: other.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/front.png",
    });
    await makeOrderWithLine({
      userId: "u1",
      headDesignId: other.id,
      lineDesignId: other.id,
      placements: { front, back: pinned },
    });
    await db
      .insert(schema.chatMessage)
      .values({ designId: d.id, role: "user", content: "keep me" });

    const result = await run({ apply: true });

    expect(result.skipped).toEqual([{ designId: d.id, reason: "order" }]);
    const outcomes = Object.fromEntries(
      result.reports[0].plan.images.map((i) => [i.imageId, i.outcome])
    );
    expect(outcomes[pinned]).toBe("blocked-by-order");
    expect(outcomes[loose]).toBe("delete");
    // Nothing moved — not even the deletable image or the chat.
    expect(await designIds()).toEqual([d.id, other.id].sort());
    expect(await db.select().from(schema.image)).toHaveLength(3);
    expect(await db.select().from(schema.chatMessage)).toHaveLength(1);
  });

  it("detaches an image another composition pins and deletes the rest of the conversation", async () => {
    const d = await makeDesignAt("u1", sec(10));
    const pinnedId = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/pinned.png",
    });
    // Outside the window, so only its image is in play.
    const other = await makeDesignAt("u1", sec(4000));
    const otherFront = await makeSourceImage(db, {
      designId: other.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/other-front.png",
    });
    // A two-sided Shop composition with the in-window image on the back. Since
    // composition slice 5 a product cannot FK a design, so it never skips a
    // conversation — it only keeps the pinned image (and its R2 object) alive.
    await db.insert(schema.product).values({
      ownerId: "u1",
      placements: { front: otherFront, back: pinnedId },
    });
    const removed: string[] = [];

    const result = await run({
      apply: true,
      deleteObject: async (key) => {
        removed.push(key);
      },
    });

    expect(result.skipped).toEqual([]);
    expect(result.deleted).toEqual([d.id]);
    expect(await designIds()).toEqual([other.id]);
    expect(
      await db.select().from(schema.image).where(eq(schema.image.id, pinnedId))
    ).toHaveLength(1);
    expect(removed).toEqual([]);
  });
});

describe("deleteDesignsSince — scope", () => {
  it("leaves other users' conversations in the same window untouched", async () => {
    const mine = await makeDesignAt("u1", sec(10));
    const theirs = await makeDesignAt("u2", sec(10));
    await makeSourceImage(db, {
      designId: theirs.id,
      ownerId: "u2",
      imageUrl: "https://r2/images/theirs.png",
    });

    const result = await run({ apply: true });

    expect(result.matched).toBe(1);
    expect(result.deleted).toEqual([mine.id]);
    expect(await designIds()).toEqual([theirs.id]);
    expect(await db.select().from(schema.image)).toHaveLength(1);
  });

  it("matches the email case-insensitively (Better-Auth stores it lowercased)", async () => {
    const mine = await makeDesignAt("u1", sec(10));

    const result = await run({ apply: false, email: "  U1@Example.COM " });

    expect(result.userId).toBe("u1");
    expect(result.reports.map((r) => r.designId)).toEqual([mine.id]);
  });

  it("refuses an unknown email", async () => {
    await expect(run({ apply: false, email: "nobody@example.com" })).rejects.toThrow(
      /No user with email/
    );
  });

  it("refuses an until earlier than since", async () => {
    await expect(
      run({ apply: false, since: sec(10), until: sec(5) })
    ).rejects.toThrow(/--until/);
  });

  it("matches created_at inclusively at both window ends", async () => {
    const before = await makeDesignAt("u1", sec(-1));
    const atSince = await makeDesignAt("u1", sec(0));
    const inside = await makeDesignAt("u1", sec(30));
    const atUntil = await makeDesignAt("u1", sec(60));
    const after = await makeDesignAt("u1", sec(61));

    const result = await run({ apply: true, since: sec(0), until: sec(60) });

    expect(result.matched).toBe(3);
    expect(result.deleted.sort()).toEqual(
      [atSince.id, inside.id, atUntil.id].sort()
    );
    expect(await designIds()).toEqual([before.id, after.id].sort());
  });

  it("defaults until to now", async () => {
    const past = await makeDesignAt("u1", sec(0));
    const future = await makeDesignAt(
      "u1",
      new Date(Date.now() + 24 * 3600 * 1000)
    );

    const result = await deleteDesignsSince(db, {
      email: "u1@example.com",
      since: T0,
      apply: false,
      deleteObject: async () => {},
      keyFromUrl,
    });

    expect(result.reports.map((r) => r.designId)).toEqual([past.id]);
    expect(future).toBeTruthy();
  });
});

describe("r2KeysForPlan", () => {
  it("prefers the stored r2_key, falls back to the URL, skips detached images, includes renders", async () => {
    const d = await makeDesignAt("u1", sec(10));
    const withKey = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://elsewhere/legacy.png",
    });
    await db
      .update(schema.image)
      .set({ r2Key: "designs/legacy/1.png" })
      .where(eq(schema.image.id, withKey));
    await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/from-url.png",
    });
    const detached = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "u1",
      imageUrl: "https://r2/images/detached.png",
    });
    const other = await makeDesign(db, "u1");
    await db.insert(schema.conversationImage).values({
      designId: other.id,
      imageId: detached,
      role: "seed",
    });
    await db.insert(schema.placementRender).values({
      designId: d.id,
      sourceImageId: withKey,
      blankId: "bella-canvas-3001",
      placementId: "front",
      imageUrl: "https://r2/designs/x/render.png",
      aspectRatio: "1:1",
    });

    const plan = await planDesignDeletion(db, d.id);

    expect(r2KeysForPlan(plan, keyFromUrl).sort()).toEqual(
      ["designs/legacy/1.png", "designs/x/render.png", "images/from-url.png"].sort()
    );
  });
});

describe("applyGuard — --apply against each DB target", () => {
  const none = { confirmProd: false, confirmPreview: false };

  it("passes dev and memory with no flag", () => {
    expect(applyGuard("dev", none)).toEqual({ ok: true });
    expect(applyGuard("memory", none)).toEqual({ ok: true });
  });

  it("prod needs --confirm-prod; --confirm-preview does not count", () => {
    expect(applyGuard("prod", none).ok).toBe(false);
    expect(applyGuard("prod", { ...none, confirmPreview: true }).ok).toBe(false);
    expect(applyGuard("prod", { ...none, confirmProd: true })).toEqual({ ok: true });
  });

  it("preview needs --confirm-preview; --confirm-prod does not count", () => {
    expect(applyGuard("preview", none).ok).toBe(false);
    expect(applyGuard("preview", { ...none, confirmProd: true }).ok).toBe(false);
    expect(applyGuard("preview", { ...none, confirmPreview: true })).toEqual({ ok: true });
  });

  it("refuses an unclassifiable URL even with both flags, pointing at the libsql:// form", () => {
    const r = applyGuard("unknown", { confirmProd: true, confirmPreview: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/libsql:\/\//);
  });
});

describe("parseWindowTimestamp — explicit zone required", () => {
  it("accepts Z and ±HH:MM offsets and resolves them to the same instant", () => {
    expect(parseWindowTimestamp("2026-09-04T00:00:00Z")?.toISOString()).toBe(
      "2026-09-04T00:00:00.000Z"
    );
    expect(parseWindowTimestamp("2026-09-03T17:00:00-07:00")?.toISOString()).toBe(
      "2026-09-04T00:00:00.000Z"
    );
    expect(parseWindowTimestamp("2026-09-04T02:30+02:30")?.toISOString()).toBe(
      "2026-09-04T00:00:00.000Z"
    );
    expect(parseWindowTimestamp(" 2026-09-04T00:00:00.500Z ")?.toISOString()).toBe(
      "2026-09-04T00:00:00.500Z"
    );
  });

  it("rejects naive timestamps and bare dates (both would silently pick a zone)", () => {
    expect(parseWindowTimestamp("2026-09-04T00:00:00")).toBeNull();
    expect(parseWindowTimestamp("2026-09-04")).toBeNull();
    expect(parseWindowTimestamp("2026-09-04 00:00:00Z")).toBeNull();
    expect(parseWindowTimestamp("yesterday")).toBeNull();
    expect(parseWindowTimestamp("")).toBeNull();
  });

  it("rejects a well-formed string that is not a real instant", () => {
    expect(parseWindowTimestamp("2026-13-45T00:00:00Z")).toBeNull();
  });
});
