/**
 * #289 item 1: createStripeCheckoutForOrder inserts the order and its line
 * before it calls Stripe. When Stripe throws, the order is marked abandoned
 * (the same column `checkout.session.expired` sets) and the Stripe error
 * reaches the caller unchanged. The row is kept, not deleted: a Stripe error
 * does not prove no session exists, and a webhook for a session that was paid
 * anyway must still find its order.
 *
 * The database is real (schema-derived, FKs enforced). Only Stripe is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign } from "./factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
  stripeError: null as Error | null,
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
        create: vi.fn(async () => {
          if (h.stripeError) throw h.stripeError;
          return {
            id: "cs_test_ok",
            url: "https://checkout.stripe.example/cs_test_ok",
          };
        }),
      },
    },
  },
}));

import {
  createStripeCheckoutForOrder,
  abandonSessionlessOrder,
} from "@/lib/order-checkout";
import {
  handleStripeCheckoutCompleted,
  handleStripeCheckoutExpired,
  type WebhookDeps,
  type StripeSessionData,
} from "@/lib/webhook-handlers";

type Db = Awaited<ReturnType<typeof createTestDb>>;

/** A db whose `update` throws; every other call goes to the real database. */
function dbWithFailingUpdate(real: Db): Db {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "update") {
        return () => {
          throw new Error("db update boom");
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Db;
}

async function seed(db: Db) {
  await makeUser(db, "buyer");
  const design = await makeDesign(db, "buyer");
  return { designId: design.id };
}

function callParams(designId: string) {
  return {
    userId: "buyer",
    designId,
    productId: "bella-canvas-3001",
    size: "M",
    color: "Black",
    itemPrice: 20,
    placements: { front: "img-1" },
    checkoutImageUrl: null,
    cancelUrl: "http://localhost:3000/cancel",
  };
}

async function onlyOrder(db: Db) {
  const rows = await db.select().from(schema.order);
  expect(rows).toHaveLength(1);
  return rows[0];
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.stripeError = null;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createStripeCheckoutForOrder when Stripe throws", () => {
  it("re-throws the same error and marks the order abandoned, keeping its rows", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db);
    const boom = new Error("stripe boom");
    h.stripeError = boom;

    await expect(
      createStripeCheckoutForOrder(callParams(designId))
    ).rejects.toBe(boom);

    const order = await onlyOrder(db);
    expect(order.status).toBe("pending");
    expect(order.abandonedAt).not.toBeNull();
    expect(order.stripeSessionId).toBeNull();
    expect(await db.select().from(schema.orderItem)).toHaveLength(1);
    expect(await db.select().from(schema.ledgerEntry)).toHaveLength(0);
  });

  it("a later checkout.session.expired for it finds nothing to do", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db);
    h.stripeError = new Error("stripe boom");
    await expect(
      createStripeCheckoutForOrder(callParams(designId))
    ).rejects.toThrow("stripe boom");
    const order = await onlyOrder(db);

    expect(await handleStripeCheckoutExpired(order.id, { db })).toEqual({
      action: "ignored",
    });
  });

  it("still re-throws the Stripe error when marking the order abandoned fails", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("stripe boom");
    h.stripeError = boom;
    h.db = dbWithFailingUpdate(db);

    await expect(
      createStripeCheckoutForOrder(callParams(designId))
    ).rejects.toBe(boom);

    const order = await onlyOrder(db);
    expect(order.abandonedAt).toBeNull();
    // The failure is logged with the order id, so it can be found.
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(order.id),
      expect.anything()
    );
  });

  it("leaves the order claimable: a payment that lands anyway is booked and fulfilled", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db);
    h.stripeError = new Error("stripe timed out");
    await expect(
      createStripeCheckoutForOrder(callParams(designId))
    ).rejects.toThrow("stripe timed out");
    const order = await onlyOrder(db);
    expect(order.abandonedAt).not.toBeNull();

    const session: StripeSessionData = {
      id: "cs_test_late",
      metadata: { orderId: order.id, designId },
      paymentStatus: "paid",
      paymentIntentId: "pi_late",
      amountTotal: Math.round(order.totalPrice * 100),
      amountSubtotal: Math.round((order.itemPrice ?? 0) * 100),
      amountShipping: Math.round((order.shippingPrice ?? 0) * 100),
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
    const deps = {
      db,
      createPrintfulOrder: vi
        .fn()
        .mockResolvedValue({ id: 7001, costs: { total: "12.50" } }),
      generateOrderName: vi.fn().mockResolvedValue("Late Payment"),
      resolveDesignImageUrl: vi.fn().mockResolvedValue("https://img.example/x.png"),
      resolveImageUrlById: vi.fn().mockResolvedValue("https://img.example/img-1.png"),
    } as unknown as WebhookDeps;

    const result = await handleStripeCheckoutCompleted(session, deps);

    expect(result.action).toBe("submitted");
    const claimed = await onlyOrder(db);
    expect(claimed.status).toBe("submitted");
    const types = (await db.select().from(schema.ledgerEntry))
      .map((e) => e.type)
      .sort();
    expect(types).toEqual(["cogs", "sale", "stripe_fee"]);
  });

  it("leaves the order pending and not abandoned when only saving the session id fails", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db);
    h.db = dbWithFailingUpdate(db);

    await expect(
      createStripeCheckoutForOrder(callParams(designId))
    ).rejects.toThrow("db update boom");

    // A real session exists here and its URL was never returned; Stripe's
    // checkout.session.expired owns this order, not the Stripe-error path.
    const order = await onlyOrder(db);
    expect(order.status).toBe("pending");
    expect(order.abandonedAt).toBeNull();
    expect(order.stripeSessionId).toBeNull();
  });

  it("is unchanged when Stripe succeeds: session id saved, not abandoned, URL returned", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db);

    const result = await createStripeCheckoutForOrder(callParams(designId));

    expect(result).toEqual({ url: "https://checkout.stripe.example/cs_test_ok" });
    const order = await onlyOrder(db);
    expect(order.stripeSessionId).toBe("cs_test_ok");
    expect(order.abandonedAt).toBeNull();
  });
});

describe("abandonSessionlessOrder", () => {
  async function insertOrder(
    db: Db,
    overrides: Partial<typeof schema.order.$inferInsert> = {}
  ) {
    const { designId } = await seed(db);
    const [row] = await db
      .insert(schema.order)
      .values({
        userId: "buyer",
        designId,
        totalPrice: 24,
        itemPrice: 19,
        shippingPrice: 5,
        status: "pending",
        ...overrides,
      })
      .returning();
    return row;
  }

  const read = async (db: Db, id: string) =>
    (await db.select().from(schema.order).where(eq(schema.order.id, id)))[0];

  it("marks a pending order with no session", async () => {
    const db = h.db as Db;
    const row = await insertOrder(db);
    await abandonSessionlessOrder(row.id);
    expect((await read(db, row.id)).abandonedAt).not.toBeNull();
  });

  it("leaves an order that has a session id", async () => {
    const db = h.db as Db;
    const row = await insertOrder(db, { stripeSessionId: "cs_test_has_one" });
    await abandonSessionlessOrder(row.id);
    expect((await read(db, row.id)).abandonedAt).toBeNull();
  });

  it("leaves an order that is no longer pending", async () => {
    const db = h.db as Db;
    const row = await insertOrder(db, { status: "paid" });
    await abandonSessionlessOrder(row.id);
    const after = await read(db, row.id);
    expect(after.status).toBe("paid");
    expect(after.abandonedAt).toBeNull();
  });

  it("keeps the first timestamp when called twice", async () => {
    const db = h.db as Db;
    const row = await insertOrder(db);
    await abandonSessionlessOrder(row.id);
    const first = (await read(db, row.id)).abandonedAt;
    await abandonSessionlessOrder(row.id);
    expect((await read(db, row.id)).abandonedAt).toEqual(first);
  });

  it("does not throw for an id that does not exist", async () => {
    await expect(abandonSessionlessOrder("no-such-order")).resolves.toBeUndefined();
  });
});
