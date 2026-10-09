// @vitest-environment node
/**
 * Real-DB test for the /admin/usage aggregates: two users (an account and a
 * guest) plus an empty guest, with jobs, images, chat, publications, orders
 * and cart lines placed around the Pacific day and 7-day boundaries.
 *
 * Clock: 2026-10-08 20:00Z (1 PM PDT). Pacific today starts 2026-10-08 07:00Z;
 * the 7-day window starts 2026-10-02 07:00Z.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as schema from "@/lib/db/schema";
import { createTestDb } from "@/lib/__tests__/test-db";

const state = vi.hoisted(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  return {
    db: null as unknown,
    sessionEmail: "admin@example.com" as string | null,
  };
});

vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        state.sessionEmail ? { user: { email: state.sessionEmail } } : null,
      ),
    },
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

import { getUsageList, getUsageUser } from "../actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;
const db = () => state.db as Db;

const NOW = new Date("2026-10-08T20:00:00Z");
const t = (iso: string) => new Date(iso);

const ACCOUNT = "acct-0001-aaaa";
const GUEST = "guest-12345678-bbbb";
const EMPTY_GUEST = "guest-empty-cccc";

let jobSeq = 0;
async function job(opts: {
  userId: string;
  designId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  operation: "generate" | "edit";
  at: string;
  cost?: number;
  ip?: string | null;
  cancelledAt?: string;
}) {
  jobSeq += 1;
  await db()
    .insert(schema.imageGeneration)
    .values({
      userId: opts.userId,
      designId: opts.designId,
      status: opts.status,
      operation: opts.operation,
      imageId: `job-img-${jobSeq}`,
      r2Key: `images/job-img-${jobSeq}.png`,
      generationNumber: jobSeq,
      dayKey: "2026-10-08",
      ip: opts.ip ?? null,
      cost: opts.cost ?? 0,
      cancelledAt: opts.cancelledAt ? t(opts.cancelledAt) : null,
      startedAt: t(opts.at),
    });
}

async function img(opts: {
  id: string;
  ownerId: string;
  designId: string;
  at: string;
  prompt?: string | null;
  operation?: "generate" | "edit" | "upload";
  role?: "output" | "seed";
  published?: "visible" | "hidden";
  /** Seeds a mirror product with this pinned backdrop (published only). */
  backdrop?: string;
}) {
  await db()
    .insert(schema.image)
    .values({
      id: opts.id,
      ownerId: opts.ownerId,
      imageUrl: `https://pub.r2.dev/images/${opts.id}.png`,
      aspectRatio: "1:1",
      prompt: opts.prompt ?? null,
      operation: opts.operation ?? "generate",
      sourceDesignId: opts.designId,
      createdAt: t(opts.at),
    });
  await db()
    .insert(schema.conversationImage)
    .values({ designId: opts.designId, imageId: opts.id, role: opts.role ?? "output" });
  if (opts.published) {
    await db()
      .insert(schema.imagePublication)
      .values({
        imageId: opts.id,
        publishedAt: t(opts.at),
        isHidden: opts.published === "hidden",
      });
    if (opts.backdrop) {
      await db()
        .insert(schema.product)
        .values({
          ownerId: opts.ownerId,
          blankId: "bella-canvas-3001",
          placements: { front: opts.id },
          backdropColor: opts.backdrop,
          status: "listed",
          listedAt: t(opts.at),
        });
    }
  }
}

async function chat(designId: string, role: "user" | "assistant", at: string) {
  await db()
    .insert(schema.chatMessage)
    .values({ designId, role, content: "hello", createdAt: t(at) });
}

async function seed() {
  await db().insert(schema.user).values([
    { id: ACCOUNT, email: "acct@example.com", name: "A", isAnonymous: false, createdAt: t("2026-09-01T00:00:00Z") },
    { id: GUEST, email: "g@guest.invalid", name: "G", isAnonymous: true, createdAt: t("2026-10-07T00:00:00Z") },
    { id: EMPTY_GUEST, email: "e@guest.invalid", name: "E", isAnonymous: true, createdAt: t("2026-10-07T01:00:00Z") },
  ]);

  const [d1] = await db().insert(schema.design).values({ userId: ACCOUNT }).returning();
  const [d2] = await db().insert(schema.design).values({ userId: ACCOUNT }).returning();
  const [gd] = await db().insert(schema.design).values({ userId: GUEST }).returning();
  const [ed] = await db().insert(schema.design).values({ userId: EMPTY_GUEST }).returning();

  // Account jobs. The newest-IP row is inserted before the older one so
  // "latest" can't be satisfied by insertion order.
  await job({ userId: ACCOUNT, designId: d1.id, status: "succeeded", operation: "generate", at: "2026-10-08T10:00:00Z", cost: 0.03, ip: "1.1.1.1" });
  await job({ userId: ACCOUNT, designId: d1.id, status: "succeeded", operation: "generate", at: "2026-09-01T10:00:00Z", cost: 0.03, ip: "9.9.9.9" });
  await job({ userId: ACCOUNT, designId: d1.id, status: "succeeded", operation: "edit", at: "2026-10-05T10:00:00Z", cost: 0.2 });
  // 08:00Z is inside the window (Oct 2, 1 AM PDT); 06:00Z is Oct 1, 11 PM PDT.
  await job({ userId: ACCOUNT, designId: d1.id, status: "succeeded", operation: "generate", at: "2026-10-02T08:00:00Z", cost: 0.03 });
  await job({ userId: ACCOUNT, designId: d1.id, status: "succeeded", operation: "generate", at: "2026-10-02T06:00:00Z", cost: 0.03 });
  await job({ userId: ACCOUNT, designId: d1.id, status: "failed", operation: "generate", at: "2026-10-06T10:00:00Z", cost: 0.03 });
  await job({ userId: ACCOUNT, designId: d1.id, status: "cancelled", operation: "generate", at: "2026-10-07T10:00:00Z", cost: 0.03, cancelledAt: "2026-10-07T10:00:05Z" });
  await job({ userId: ACCOUNT, designId: d1.id, status: "failed", operation: "generate", at: "2026-09-02T10:00:00Z", cost: 0.03 });

  // Guest: one success, no job IP (falls back to the session's).
  await job({ userId: GUEST, designId: gd.id, status: "succeeded", operation: "generate", at: "2026-10-07T10:00:00Z", cost: 0.03 });
  // Empty guest: only a failed job.
  await job({ userId: EMPTY_GUEST, designId: ed.id, status: "failed", operation: "generate", at: "2026-10-07T11:00:00Z" });

  await db().insert(schema.session).values([
    { id: "s1", userId: GUEST, token: "tok1", expiresAt: t("2026-11-01T00:00:00Z"), ipAddress: "3.3.3.3", createdAt: t("2026-10-07T09:00:00Z") },
    { id: "s2", userId: GUEST, token: "tok2", expiresAt: t("2026-11-01T00:00:00Z"), ipAddress: "4.4.4.4", createdAt: t("2026-10-07T08:00:00Z") },
  ]);

  // Account images: one published, one published then hidden, one visible, one private.
  await img({ id: "img-pub-1", ownerId: ACCOUNT, designId: d1.id, at: "2026-10-08T10:00:00Z", prompt: "a red fox", published: "visible", backdrop: "Navy" });
  await img({ id: "img-hidden", ownerId: ACCOUNT, designId: d1.id, at: "2026-10-05T10:00:00Z", prompt: "an edit", operation: "edit", published: "hidden" });
  await img({ id: "img-pub-2", ownerId: ACCOUNT, designId: d2.id, at: "2026-10-02T08:00:00Z", prompt: "p".repeat(200), published: "visible" });
  await img({ id: "img-private", ownerId: ACCOUNT, designId: d2.id, at: "2026-09-01T10:00:00Z", prompt: "old private" });
  // Same image carried into d2 as a seed.
  await db().insert(schema.conversationImage).values({ designId: d2.id, imageId: "img-pub-1", role: "seed" });
  await img({ id: "img-guest", ownerId: GUEST, designId: gd.id, at: "2026-10-07T10:00:00Z", prompt: "guest art" });

  // Chat: account has 2 user messages in the window, 1 old, plus a newer
  // assistant reply that must not count.
  await chat(d1.id, "user", "2026-10-08T11:00:00Z");
  await chat(d1.id, "assistant", "2026-10-08T11:00:30Z");
  await chat(d2.id, "user", "2026-10-03T11:00:00Z");
  await chat(d2.id, "user", "2026-09-02T11:00:00Z");
  await chat(gd.id, "user", "2026-10-07T12:00:00Z");

  // Orders: paid, shipped (old), pending, and an abandoned pending (newest).
  const order = (id: string, status: "pending" | "paid" | "shipped" | "canceled", total: number, at: string, abandoned?: string) =>
    db().insert(schema.order).values({
      id,
      userId: ACCOUNT,
      designId: d1.id,
      totalPrice: total,
      status,
      abandonedAt: abandoned ? t(abandoned) : null,
      createdAt: t(at),
    });
  await order("o-paid", "paid", 30, "2026-10-06T10:00:00Z");
  await order("o-shipped", "shipped", 25.5, "2026-09-10T10:00:00Z");
  await order("o-pending", "pending", 99, "2026-10-07T10:00:00Z");
  await order("o-abandoned", "pending", 40, "2026-10-08T15:00:00Z", "2026-10-08T17:00:00Z");
  // Canceled inside the window: not paid, so no paid count or revenue moves.
  await order("o-canceled", "canceled", 77, "2026-10-07T12:00:00Z");

  await db().insert(schema.cartItem).values([
    { userId: ACCOUNT, designId: d1.id, productId: "p", size: "M", color: "black" },
    { userId: ACCOUNT, designId: d2.id, productId: "p", size: "L", color: "black", quantity: 3 },
  ]);

  return { d1: d1.id, d2: d2.id };
}

beforeEach(async () => {
  state.db = await createTestDb();
  state.sessionEmail = "admin@example.com";
  jobSeq = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await seed();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getUsageList", () => {
  it("refuses a non-admin", async () => {
    state.sessionEmail = "someone@example.com";
    await expect(getUsageList(100)).rejects.toThrow("Unauthorized");
    state.sessionEmail = null;
    await expect(getUsageList(100)).rejects.toThrow("Unauthorized");
  });

  it("lists the account first, then the guest, and leaves out the empty guest", async () => {
    const { rows } = await getUsageList(100);
    expect(rows.map((r) => r.id)).toEqual([ACCOUNT, GUEST]);
  });

  it("computes every number on the account card", async () => {
    const { rows } = await getUsageList(100);
    const a = rows.find((r) => r.id === ACCOUNT)!;
    expect(a.label).toBe("acct@example.com");
    expect(a.kind).toBe("ACCOUNT");
    expect(a.createdAt).toEqual(t("2026-09-01T00:00:00Z"));
    // Last active: the abandoned order created 15:00Z beats the 11:00Z chat
    // and the 10:00Z image.
    expect(a.lastActiveAt).toEqual(t("2026-10-08T15:00:00Z"));
    expect(a.generations).toEqual({ today: 1, week: 3, total: 5, generateTotal: 4, editTotal: 1 });
    expect(a.failedWeek).toBe(2);
    // Succeeded 0.03*4 + 0.20, plus the cancelled job's 0.03 (billed). The
    // failed jobs' cost is not counted.
    expect(a.spend).toBeCloseTo(0.35, 6);
    expect(a.conversations).toBe(2);
    expect(a.chatWeek).toBe(2);
    expect(a.published).toBe(2);
    expect(a.hidden).toBe(1);
    expect(a.paidOrders).toBe(2);
    expect(a.revenue).toBeCloseTo(55.5, 6);
    expect(a.cartLines).toBe(2);
    expect(a.ip).toBe("1.1.1.1");
  });

  it("computes every number on the guest card", async () => {
    const { rows } = await getUsageList(100);
    const g = rows.find((r) => r.id === GUEST)!;
    expect(g.label).toBe("guest · guest-12");
    expect(g.kind).toBe("GUEST");
    expect(g.lastActiveAt).toEqual(t("2026-10-07T12:00:00Z"));
    expect(g.generations).toEqual({ today: 0, week: 1, total: 1, generateTotal: 1, editTotal: 0 });
    expect(g.failedWeek).toBe(0);
    expect(g.spend).toBeCloseTo(0.03, 6);
    expect(g.conversations).toBe(1);
    expect(g.chatWeek).toBe(1);
    expect(g.published).toBe(0);
    expect(g.hidden).toBe(0);
    expect(g.paidOrders).toBe(0);
    expect(g.revenue).toBe(0);
    expect(g.cartLines).toBe(0);
    // No job IP; the latest session IP.
    expect(g.ip).toBe("3.3.3.3");
  });

  it("computes the totals row, counting the empty guest's failed job", async () => {
    const { totals } = await getUsageList(100);
    expect(totals.activeUsers7d).toBe(2);
    expect(totals.generations7d).toBe(4);
    expect(totals.failed7d).toBe(3);
    expect(totals.spend7d).toBeCloseTo(0.32, 6);
    expect(totals.paidOrders7d).toBe(1);
  });

  it("limits the rows but not the totals, and reports how many are listed", async () => {
    const out = await getUsageList(1);
    expect(out.rows.map((r) => r.id)).toEqual([ACCOUNT]);
    expect(out.listedCount).toBe(2);
    expect(out.totals.generations7d).toBe(4);
  });
});

describe("getUsageUser", () => {
  it("refuses a non-admin", async () => {
    state.sessionEmail = "someone@example.com";
    await expect(getUsageUser(ACCOUNT, 200)).rejects.toThrow("Unauthorized");
  });

  it("returns null for an unknown user id", async () => {
    expect(await getUsageUser("nope", 200)).toBeNull();
  });

  it("returns the same card as the list", async () => {
    const list = await getUsageList(100);
    const detail = await getUsageUser(ACCOUNT, 200);
    expect(detail!.row).toEqual(list.rows.find((r) => r.id === ACCOUNT));
  });

  it("returns the card for an empty guest instead of hiding it", async () => {
    const detail = await getUsageUser(EMPTY_GUEST, 200);
    expect(detail!.row.kind).toBe("GUEST");
    expect(detail!.row.failedWeek).toBe(1);
    expect(detail!.images).toEqual([]);
  });

  it("lists the user's images newest first with status, conversation and prompt", async () => {
    const { d1, d2 } = await designIds();
    const detail = await getUsageUser(ACCOUNT, 200);
    expect(detail!.imageCount).toBe(4);
    expect(detail!.images.map((i) => i.id)).toEqual([
      "img-pub-1",
      "img-hidden",
      "img-pub-2",
      "img-private",
    ]);
    const [pub1, hidden, pub2, priv] = detail!.images;
    expect(pub1).toMatchObject({
      status: "published",
      operation: "generate",
      prompt: "a red fox",
      conversationId: d1,
      seedIn: [d2],
      imageUrl: "https://pub.r2.dev/images/img-pub-1.png",
      createdAt: t("2026-10-08T10:00:00Z"),
    });
    expect(pub1.backdropColor).toBe("Navy");
    expect(hidden).toMatchObject({ status: "hidden", operation: "edit", conversationId: d1, seedIn: [] });
    expect(hidden.backdropColor).toBeNull();
    expect(pub2.prompt).toHaveLength(200);
    expect(priv).toMatchObject({ status: "private", conversationId: d2, backdropColor: null });
  });

  it("clamps a bad limit inside the actions", async () => {
    expect((await getUsageList(0)).rows).toHaveLength(2);
    expect((await getUsageList(-3)).rows).toHaveLength(2);
    expect((await getUsageList(Number.NaN)).rows).toHaveLength(2);
    expect((await getUsageUser(ACCOUNT, 0))!.images).toHaveLength(4);
    expect((await getUsageUser(ACCOUNT, -1))!.images).toHaveLength(4);
  });

  it("limits the images but reports the full count", async () => {
    const detail = await getUsageUser(ACCOUNT, 2);
    expect(detail!.images.map((i) => i.id)).toEqual(["img-pub-1", "img-hidden"]);
    expect(detail!.imageCount).toBe(4);
  });

  it("does not return another user's images", async () => {
    const detail = await getUsageUser(GUEST, 200);
    expect(detail!.images.map((i) => i.id)).toEqual(["img-guest"]);
  });
});

// The design ids are random; read them back for assertions on conversation ids.
async function designIds() {
  const rows = await db().select().from(schema.design);
  const mine = rows.filter((d) => d.userId === ACCOUNT);
  const conv = await db().select().from(schema.conversationImage);
  const d1 = conv.find((c) => c.imageId === "img-hidden")!.designId;
  const d2 = mine.find((d) => d.id !== d1)!.id;
  return { d1, d2 };
}
