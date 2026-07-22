// @vitest-environment node
/**
 * Real-DB integration test for getFinancialSummary (WP5): seeds orders +
 * ledger rows across classifications and asserts the grouped-sum →
 * summarizeLedger math the admin dashboard shows. Asserts CURRENT behavior:
 * archival is a display/workflow state, never a financial one, so archived
 * orders count in orderCount just like their ledger rows already count in
 * revenue (#105); unfiltered summaries include test-classified orders'
 * money (only an explicit classification filter excludes it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { createTestDb } from "@/lib/__tests__/test-db";

const state = vi.hoisted(() => {
  // actions.ts throws at module load without ADMIN_EMAIL; set it before the
  // static import below evaluates.
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
        state.sessionEmail ? { user: { email: state.sessionEmail } } : null
      ),
    },
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/printful", () => ({
  createOrder: vi.fn(),
  getOrderByExternalId: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({ generateOrderName: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
}));

import { getFinancialSummary, archiveOrder } from "../actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

function db(): Db {
  return state.db as Db;
}

async function seedOrder(opts: {
  id: string;
  classification: string | null;
  archived?: boolean;
  ledger?: { type: string; amount: number }[];
}) {
  const [design] = await db()
    .insert(schema.design)
    .values({ userId: "u1" })
    .returning();
  await db()
    .insert(schema.order)
    .values({
      id: opts.id,
      userId: "u1",
      designId: design.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      totalPrice: 24.12,
      status: "submitted",
      classification: opts.classification,
      archivedAt: opts.archived ? new Date() : null,
    });
  if (opts.ledger?.length) {
    await db()
      .insert(schema.ledgerEntry)
      .values(
        opts.ledger.map((l) => ({
          orderId: opts.id,
          type: l.type,
          amount: l.amount,
          description: `${l.type} for ${opts.id}`,
        }))
      );
  }
}

beforeEach(async () => {
  state.db = await createTestDb();
  state.sessionEmail = "admin@example.com";
  await db()
    .insert(schema.user)
    .values({ id: "u1", email: "buyer@example.com", name: "Buyer" });
});

describe("getFinancialSummary", () => {
  beforeEach(async () => {
    await seedOrder({
      id: "o-customer",
      classification: "customer",
      ledger: [
        { type: "sale", amount: 24.12 },
        { type: "stripe_fee", amount: -1.0 },
        { type: "cogs", amount: -12.5 },
      ],
    });
    await seedOrder({
      id: "o-test",
      classification: "test",
      ledger: [
        { type: "sale", amount: 10.0 },
        { type: "stripe_fee", amount: -0.59 },
      ],
    });
    await seedOrder({
      id: "o-archived",
      classification: "customer",
      archived: true,
      ledger: [{ type: "sale", amount: 5.0 }],
    });
    await seedOrder({ id: "o-unclassified", classification: null });
  });

  it("unfiltered: sums EVERY ledger row — including test-classified orders — and counts every order, archived or not", async () => {
    const summary = await getFinancialSummary();

    // Current behavior: no default exclusion of `test` orders (the
    // docs/test-orders-and-accounting.md proposal would change this), and
    // archived orders count in orderCount just like their ledger rows
    // already count in revenue — money always counts (#105).
    expect(summary.revenue).toBeCloseTo(24.12 + 10.0 + 5.0, 5);
    expect(summary.stripeFees).toBeCloseTo(-1.59, 5);
    expect(summary.cogs).toBeCloseTo(12.5, 5);
    expect(summary.grossProfit).toBeCloseTo(39.12 - 1.59 - 12.5, 5);
    expect(summary.orderCount).toBe(4); // o-customer, o-test, o-archived, o-unclassified
  });

  it('"all" behaves the same as no filter', async () => {
    const summary = await getFinancialSummary("all");
    expect(summary.revenue).toBeCloseTo(39.12, 5);
    expect(summary.orderCount).toBe(4);
  });

  it("customer filter: joins ledger through order classification; archived customer order counts in both revenue and orderCount", async () => {
    const summary = await getFinancialSummary("customer");

    expect(summary.revenue).toBeCloseTo(24.12 + 5.0, 5); // o-customer + archived o-archived
    expect(summary.stripeFees).toBeCloseTo(-1.0, 5);
    expect(summary.cogs).toBeCloseTo(12.5, 5);
    expect(summary.grossProfit).toBeCloseTo(29.12 - 1.0 - 12.5, 5);
    expect(summary.orderCount).toBe(2); // o-customer + archived o-archived
  });

  it("test filter: isolates test-order money", async () => {
    const summary = await getFinancialSummary("test");
    expect(summary.revenue).toBeCloseTo(10.0, 5);
    expect(summary.stripeFees).toBeCloseTo(-0.59, 5);
    expect(summary.cogs).toBe(0);
    expect(summary.grossProfit).toBeCloseTo(9.41, 5);
    expect(summary.orderCount).toBe(1);
  });

  it("counts a refund_cogs_reversal as a COGS correction in gross profit (WP1)", async () => {
    await seedOrder({
      id: "o-canceled",
      classification: "customer",
      ledger: [
        { type: "sale", amount: 24.12 },
        { type: "stripe_fee", amount: -1.0 },
        { type: "cogs", amount: -12.5 },
        { type: "refund_cogs_reversal", amount: 12.5 },
      ],
    });

    const summary = await getFinancialSummary("customer");
    // The reversal nets the canceled order's COGS to zero: only o-customer's
    // 12.50 remains, and gross profit reflects both orders' sale − fee.
    expect(summary.cogs).toBeCloseTo(12.5, 5);
    expect(summary.grossProfit).toBeCloseTo(
      (24.12 - 1.0 - 12.5) + (5.0) + (24.12 - 1.0),
      5
    );
  });

  it("rejects a non-admin session", async () => {
    state.sessionEmail = "someone-else@example.com";
    await expect(getFinancialSummary()).rejects.toThrow("Unauthorized");
  });
});

describe("archiveOrder (uses canArchiveOrder)", () => {
  it("archives a pre-fulfillment order and refuses a submitted one", async () => {
    await seedOrder({ id: "o-pending", classification: null });
    await db()
      .update(schema.order)
      .set({ status: "pending" })
      .where(eq(schema.order.id, "o-pending"));
    await archiveOrder("o-pending");
    const archived = await db().query.order.findFirst({
      where: eq(schema.order.id, "o-pending"),
    });
    expect(archived?.archivedAt).not.toBeNull();

    await seedOrder({ id: "o-submitted", classification: "customer" });
    await db()
      .update(schema.order)
      .set({ printfulOrderId: "9999" })
      .where(eq(schema.order.id, "o-submitted"));
    await expect(archiveOrder("o-submitted")).rejects.toThrow(
      "Cannot archive orders submitted to Printful"
    );
  });
});
