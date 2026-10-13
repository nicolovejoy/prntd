/**
 * expireEarlierCheckoutSessions / expireCheckoutSession (#315) against a real
 * in-memory libSQL. Stripe is mocked: `expire` is the only call. Pins which
 * orders count as "earlier", that an order is marked abandoned only when
 * Stripe confirms the expiry, and that nothing here throws or hangs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign } from "./factories";
import { CHECKOUT_SESSION_TTL_SECONDS } from "@/lib/checkout";
import { STRIPE_SESSION_READ_TIMEOUT_MS } from "@/lib/checkout-session-status";

const h = vi.hoisted(() => ({
  db: null as unknown,
  expire: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        expire: (...args: unknown[]) => h.expire(...args),
      },
    },
  },
}));

import {
  expireCheckoutSession,
  expireEarlierCheckoutSessions,
} from "@/lib/expire-checkout-sessions";
import {
  handleStripeCheckoutCompleted,
  type WebhookDeps,
  type StripeSessionData,
} from "@/lib/webhook-handlers";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const NOW = () => new Date();
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

async function seedOrder(
  db: Db,
  opts: {
    id?: string;
    userId?: string;
    sessionId?: string | null;
    status?: "pending" | "paid";
    abandonedAt?: Date | null;
    createdAt?: Date;
  } = {}
) {
  const userId = opts.userId ?? "buyer";
  const existing = await db.query.user.findFirst({
    where: eq(schema.user.id, userId),
  });
  if (!existing) await makeUser(db, userId);
  const design = await makeDesign(db, userId);
  const id = opts.id ?? crypto.randomUUID();
  await db.insert(schema.order).values({
    id,
    userId,
    designId: design.id,
    stripeSessionId: opts.sessionId === undefined ? `cs_${id}` : opts.sessionId,
    status: opts.status ?? "pending",
    abandonedAt: opts.abandonedAt ?? null,
    createdAt: opts.createdAt ?? ago(60),
    totalPrice: 24.12,
  });
  return { id, designId: design.id };
}

async function load(db: Db, id: string) {
  const row = await db.query.order.findFirst({ where: eq(schema.order.id, id) });
  if (!row) throw new Error(`order ${id} missing`);
  return row;
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.expire.mockReset();
  h.expire.mockImplementation(async (id: string) => ({ id, status: "expired" }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("expireEarlierCheckoutSessions (#315)", () => {
  it("no earlier order: Stripe is not called", async () => {
    const db = h.db as Db;
    const fresh = await seedOrder(db, { createdAt: NOW() });
    const result = await expireEarlierCheckoutSessions({
      userId: "buyer",
      orderId: fresh.id,
    });
    expect(result).toEqual([]);
    expect(h.expire).not.toHaveBeenCalled();
  });

  it("one earlier pending order with a session: it is expired and abandoned, the new order is untouched", async () => {
    const db = h.db as Db;
    const old = await seedOrder(db, { createdAt: ago(120) });
    const fresh = await seedOrder(db, { createdAt: NOW() });

    const result = await expireEarlierCheckoutSessions({
      userId: "buyer",
      orderId: fresh.id,
    });

    expect(h.expire).toHaveBeenCalledTimes(1);
    expect(h.expire).toHaveBeenCalledWith(`cs_${old.id}`);
    expect(result).toEqual([
      { orderId: old.id, sessionId: `cs_${old.id}`, expired: true },
    ]);
    expect((await load(db, old.id)).abandonedAt).not.toBeNull();
    expect((await load(db, old.id)).status).toBe("pending");
    const after = await load(db, fresh.id);
    expect(after.abandonedAt).toBeNull();
    expect(after.status).toBe("pending");
  });

  it.each([
    ["a paid order", { status: "paid" as const }],
    ["an already abandoned order", { abandonedAt: new Date() }],
    ["an order with no session id", { sessionId: null }],
    ["another buyer's pending order", { userId: "other" }],
  ])("%s is not touched", async (_label, overrides) => {
    const db = h.db as Db;
    const other = await seedOrder(db, { createdAt: ago(120), ...overrides });
    const fresh = await seedOrder(db, { createdAt: NOW() });

    const result = await expireEarlierCheckoutSessions({
      userId: "buyer",
      orderId: fresh.id,
    });

    expect(result).toEqual([]);
    expect(h.expire).not.toHaveBeenCalled();
    const after = await load(db, other.id);
    expect(after.status).toBe(overrides.status ?? "pending");
    expect(Boolean(after.abandonedAt)).toBe(Boolean(overrides.abandonedAt));
  });

  it("an order created after the new one is not expired", async () => {
    const db = h.db as Db;
    const current = await seedOrder(db, { createdAt: ago(120) });
    const later = await seedOrder(db, { createdAt: NOW() });

    const result = await expireEarlierCheckoutSessions({
      userId: "buyer",
      orderId: current.id,
    });

    expect(result).toEqual([]);
    expect(h.expire).not.toHaveBeenCalled();
    expect((await load(db, later.id)).abandonedAt).toBeNull();
  });

  it("two orders with the same created time: at most one is expired, never both", async () => {
    const db = h.db as Db;
    const created = ago(30);
    const a = await seedOrder(db, { id: "order-a", createdAt: created });
    const b = await seedOrder(db, { id: "order-b", createdAt: created });

    await expireEarlierCheckoutSessions({ userId: "buyer", orderId: a.id });
    await expireEarlierCheckoutSessions({ userId: "buyer", orderId: b.id });

    expect(h.expire).toHaveBeenCalledTimes(1);
    const abandoned = [await load(db, a.id), await load(db, b.id)].filter(
      (o) => o.abandonedAt !== null
    );
    expect(abandoned).toHaveLength(1);
  });

  it("Stripe refuses (the session is complete): expired false, the order stays pending, nothing thrown", async () => {
    const db = h.db as Db;
    const old = await seedOrder(db, { createdAt: ago(120) });
    const fresh = await seedOrder(db, { createdAt: NOW() });
    h.expire.mockRejectedValue(new Error("session is complete"));

    const result = await expireEarlierCheckoutSessions({
      userId: "buyer",
      orderId: fresh.id,
    });

    expect(result).toEqual([
      { orderId: old.id, sessionId: `cs_${old.id}`, expired: false },
    ]);
    const after = await load(db, old.id);
    expect(after.status).toBe("pending");
    expect(after.abandonedAt).toBeNull();
  });

  it("Stripe answers with a session that is not expired: expired false, the order is unchanged", async () => {
    const db = h.db as Db;
    const old = await seedOrder(db, { createdAt: ago(120) });
    const fresh = await seedOrder(db, { createdAt: NOW() });
    h.expire.mockResolvedValue({ id: "x", status: "open" });

    const result = await expireEarlierCheckoutSessions({
      userId: "buyer",
      orderId: fresh.id,
    });

    expect(result[0].expired).toBe(false);
    expect((await load(db, old.id)).abandonedAt).toBeNull();
  });

  it("Stripe never answers: returns once the timeout has passed, the order is unchanged", async () => {
    const db = h.db as Db;
    const old = await seedOrder(db, { createdAt: ago(120) });
    const fresh = await seedOrder(db, { createdAt: NOW() });
    h.expire.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const pending = expireEarlierCheckoutSessions({
      userId: "buyer",
      orderId: fresh.id,
    });
    await vi.waitFor(() => expect(h.expire).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(STRIPE_SESSION_READ_TIMEOUT_MS + 1);
    const result = await pending;

    expect(result).toEqual([
      { orderId: old.id, sessionId: `cs_${old.id}`, expired: false },
    ]);
    const after = await load(db, old.id);
    expect(after.status).toBe("pending");
    expect(after.abandonedAt).toBeNull();
  });

  it("an order older than the session lifetime plus five minutes is skipped", async () => {
    const db = h.db as Db;
    await seedOrder(db, {
      createdAt: ago(CHECKOUT_SESSION_TTL_SECONDS + 5 * 60 + 60),
    });
    const fresh = await seedOrder(db, { createdAt: NOW() });

    const result = await expireEarlierCheckoutSessions({
      userId: "buyer",
      orderId: fresh.id,
    });

    expect(result).toEqual([]);
    expect(h.expire).not.toHaveBeenCalled();
  });

  it("twelve earlier open orders: ten expire calls, for the ten newest", async () => {
    const db = h.db as Db;
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      // i = 0 is the oldest.
      const o = await seedOrder(db, { createdAt: ago(1200 - i * 10) });
      ids.push(o.id);
    }
    const fresh = await seedOrder(db, { createdAt: NOW() });

    await expireEarlierCheckoutSessions({ userId: "buyer", orderId: fresh.id });

    expect(h.expire).toHaveBeenCalledTimes(10);
    const called = h.expire.mock.calls.map((c) => c[0]).sort();
    expect(called).toEqual(ids.slice(2).map((id) => `cs_${id}`).sort());
  });

  it("the database read throws: nothing is thrown and Stripe is not called", async () => {
    const db = h.db as Db;
    await seedOrder(db, { createdAt: ago(120) });
    const fresh = await seedOrder(db, { createdAt: NOW() });
    vi.spyOn(db, "select").mockImplementation((() => {
      throw new Error("injected read failure");
    }) as unknown as typeof db.select);

    const result = await expireEarlierCheckoutSessions({
      userId: "buyer",
      orderId: fresh.id,
    });

    expect(result).toEqual([]);
    expect(h.expire).not.toHaveBeenCalled();
  });

  it("an order this helper abandoned is still claimed by a paid checkout.session.completed", async () => {
    const db = h.db as Db;
    const old = await seedOrder(db, { createdAt: ago(120) });
    await db.insert(schema.orderItem).values({
      orderId: old.id,
      designId: old.designId,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      quantity: 1,
      itemPrice: 19.43,
    });
    const fresh = await seedOrder(db, { createdAt: NOW() });
    await expireEarlierCheckoutSessions({ userId: "buyer", orderId: fresh.id });
    expect((await load(db, old.id)).abandonedAt).not.toBeNull();

    const deps = {
      db,
      createPrintfulOrder: vi
        .fn()
        .mockResolvedValue({ id: 9999, costs: { total: "12.50" } }),
      generateOrderName: vi.fn().mockResolvedValue("Name"),
      resolveDesignImageUrl: vi.fn().mockResolvedValue("https://img.example/x.png"),
    } as unknown as WebhookDeps;
    const session: StripeSessionData = {
      id: `cs_${old.id}`,
      metadata: { orderId: old.id, designId: old.designId },
      paymentStatus: "paid",
      paymentIntentId: "pi_315",
      amountTotal: 2412,
      amountSubtotal: 1943,
      amountShipping: 469,
      discount: null,
      shipping: {
        name: "Jane Doe",
        address1: "1 Main St",
        address2: "",
        city: "Town",
        state: "CA",
        zip: "90001",
        country: "US",
      },
    };

    await handleStripeCheckoutCompleted(session, deps);

    expect((await load(db, old.id)).status).not.toBe("pending");
  });
});

describe("expireCheckoutSession (#315)", () => {
  it("true when Stripe reports the session expired", async () => {
    expect(await expireCheckoutSession("cs_1")).toBe(true);
    expect(h.expire).toHaveBeenCalledWith("cs_1");
  });

  it("false, with one log line and no throw, when Stripe rejects", async () => {
    h.expire.mockRejectedValue(new Error("nope"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await expireCheckoutSession("cs_1")).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
