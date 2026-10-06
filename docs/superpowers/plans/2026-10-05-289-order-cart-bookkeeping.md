# Order and cart bookkeeping (#289 items 1 and 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a Stripe error during checkout no longer leaves an orphan `pending` order behind, and a paid order's cart cleanup removes only the cart lines that match the order line's placements.

**Branch:** `claude/289-order-cart-bookkeeping`, one PR, off main `09ebc1d`. No schema change, so the PR is not HOLD and needs no migration step.

**Scope (Nico, 2026-10-05):** items 1 and 3 of #289. Items 2 (cart orders never record `store_product_id`) and 4 ("published" read from two places) wait for #249 and are not touched here.

**Money path.** Both changes sit next to order creation and the paid claim. Real-DB integration tests through the real actions and handlers, and a dedicated adversarial review before the PR, in addition to the whole-branch review.

**Architecture:** item 1 adds one small exported helper to `src/lib/order-checkout.ts` that sets `abandoned_at` on a session-less pending order, and calls it from the Stripe-failure paths of `createStripeCheckoutForOrder` and `checkoutCart`. Item 3 adds a pure SQL-condition builder in `src/lib/` that matches a cart line to an order line including the front and back image ids, and swaps the webhook's sequential per-line deletes for one `db.batch` of those conditional deletes.

**Tech Stack:** Next.js 16 server actions, Drizzle on libSQL (in-memory in tests), Stripe Checkout, Vitest.

**Spec:** GitHub issue #289 (items 1 and 3) and Nico's ruling on it, 2026-10-05. Related code: `src/lib/order-checkout.ts`, `src/app/cart/actions.ts` (`checkoutCart`), `src/lib/webhook-handlers.ts` (`handleStripeCheckoutCompleted`, `handleStripeCheckoutExpired`), `src/lib/user-orders.ts`.

## What exists today (traced 2026-10-05, main at `09ebc1d`)

Item 1:

- `createStripeCheckoutForOrder` commits `order` + `order_item` in one `db.batch`, then calls `stripe.checkout.sessions.create`, then sets `order.stripe_session_id`. There is no `try`. A throw from Stripe leaves a `pending` order with null `stripe_session_id` and null `abandoned_at`.
- `checkoutCart` (`src/app/cart/actions.ts`) has the same shape: batch insert of `order` + N `order_item`, then Stripe, then the session id update. Same orphan on a Stripe throw. The issue names only the first helper; this is the same defect.
- Callers of `createStripeCheckoutForOrder`: `createCheckoutSession` (`src/app/order/actions.ts`), `buyPublishedDesign` (`src/app/d/actions.ts`), `buyStoreProduct` (`src/app/shop/actions.ts`, retired, flag off). None catches the error; it reaches the client (production masks the message).
- How `abandoned_at` is used today:
  - `handleStripeCheckoutExpired` sets it with `UPDATE … WHERE id=? AND status='pending' AND abandoned_at IS NULL` on `checkout.session.expired` and `async_payment_failed`.
  - `/orders` (`src/lib/user-orders.ts`) shows a pending row only when it has a `stripe_session_id`, is not abandoned and is older than 135 minutes. A session-less row is already hidden there, and the comment in that file names this exact case.
  - `/admin` list and order detail show "Abandoned" for `pending && abandoned_at`, a Recover button for `pending && stripe_session_id`, and nothing for a session-less row that is not abandoned.
  - `loadEmbeddedCheckout` and `/order/confirm` read `abandoned_at` to say the checkout expired or failed.
  - `scripts/mark-legacy-pending-abandoned.ts` marks session-less legacy rows abandoned on purpose "so they carry a consistent, honest timestamp instead of a null that reads as in flight".
  - The retry cron (`retryStuckFulfillments`) only looks at `paid` orders. It never reads pending ones.
- `src/lib/delete-design.ts` blocks deleting a conversation or image that any order references (header, line or pinned placement), whatever the order's status. That is already true for every abandoned expired checkout.

Item 3:

- `handleStripeCheckoutCompleted` deletes cart lines after the paid claim commits, in a `try` that only logs: a `for` loop of one `await deps.db.delete(cartItem).where(userId, designId, productId, size, color)` per `order_item`. It is not a `db.batch` (the issue's "same `db.batch` as today" does not match the code: the only batch there is the claim, and the cleanup is deliberately outside it so a cart error cannot roll back a paid claim).
- `cart_item.placements` and `order_item.placements` are both JSON text, `{ front: <imageId>, back?: <imageId> }` or null. Writers: `addToCart` (`{ front, ...(back ? { back } : {}) }`), `buyPublishedDesign` (same shape), `createCheckoutSession` (`{ front, ...back }` or null when the design has no primary image), `checkoutCart` (copies the cart row's `placements` verbatim into `order_item`). So the cart line for "the same shirt" and the order line for it hold equal JSON, though key order is not guaranteed to be the same, so the match must compare values, not text.
- Existing tests that depend on the old match and seed cart rows with no `placements` against order items that have `{ front: "img-1" }`: `src/lib/__tests__/money-path.integration.test.ts` ("cart order (#26)", "returns submitted even when clearing the cart throws", "single-item order … clears its matching cart line"). They must seed matching placements after this change (Task 3).
- Callers of `handleStripeCheckoutCompleted`: the Stripe webhook route, admin Recover (`recoverPendingOrderCore`) and `retryStuckFulfillments`. All reach the same cleanup.

## Decisions

1. **Abandon, do not delete.** In the `catch` around the Stripe call, mark the order `abandoned_at`; keep the `order` and `order_item` rows.
   - Consistency: `abandoned_at` is how the app already says "this checkout is dead" (`checkout.session.expired`, the legacy script, `/admin`, `/order/confirm`). A session-less abandoned order is also what the legacy script produces on purpose.
   - Safety: a Stripe SDK error does not prove no session exists (a timeout or a reset connection after Stripe created the session looks the same). If that session were paid, `handleStripeCheckoutCompleted` throws `Order … not found` against a deleted row, Stripe retries it forever and the charge has no order. With an abandoned row, the claim (`WHERE status='pending'`, which does not look at `abandoned_at`) still succeeds and the order is booked and fulfilled. Task 1 pins that.
   - Cost: the abandoned row still blocks `delete-design` for that conversation, as every abandoned expired checkout already does. Not changed here; a follow-up if Nico wants it.
2. **The abandon update is conditional and cannot throw.** `WHERE id=? AND status='pending' AND abandoned_at IS NULL AND stripe_session_id IS NULL`, wrapped so a failure is logged and swallowed. The caller then re-throws the original Stripe error unchanged. The `stripe_session_id IS NULL` condition means the helper can never mark an order that has a session.
3. **Only the Stripe call is covered, not the session-id write after it.** If `stripe.checkout.sessions.create` succeeded and the following `UPDATE … SET stripe_session_id` fails, a real session exists and the buyer never receives its URL. The order is left as it is, and Stripe's `checkout.session.expired` (2 hours) abandons it. Marking it abandoned there would make `/checkout` say "expired" for a session that is still open.
4. **`checkoutCart` gets the same fix**, through the same helper, as its own task so it can be reviewed or struck separately. Same defect, five lines, and fixing one path of two would leave the cart creating orphans.
5. **Cart match compares `front` and `back` by value with `json_extract`**, not the JSON text and not a JS-side read. `json_extract(placements, '$.front') IS ?` is null-safe, so a null-placements line matches a null-placements order line and nothing else. A pinned purchase never clears a line with null placements (an old line from before pins): leaving an unpaid line is the safe direction, and `addToCart` has pinned the front since #138.
6. **The cleanup becomes one `db.batch` of conditional deletes after the claim**, still inside its own `try` that logs and carries on. One round trip instead of N, and no half-cleaned cart if one statement fails. It is not folded into the claim batch: a cart error must not roll back a paid claim.
7. **Identical duplicate lines are unchanged.** Two cart lines identical in every field (the cart inserts a new row per add) are both cleared by one matching purchase, as today.

## Global Constraints

- No schema change, no migration. `npm run db:generate` must print "No schema changes". Do not touch `src/lib/db/schema.ts`.
- No change to ledger booking, the paid claim, fulfillment or emails: leave `saleLedgerRows`, the claim `db.batch` in `handleStripeCheckoutCompleted`, `submitOrderFulfillment`, `sendPostOrderEmails` and `src/lib/ledger.ts` exactly as they are. The only edit inside `handleStripeCheckoutCompleted` is the cart-cleanup block.
- `abandon` writes only `abandoned_at` and `updated_at`. It never changes `status`, never deletes an `order` or `order_item` row, never writes a ledger row.
- The Stripe error is re-thrown unchanged (same object) on every path; a cleanup failure never replaces or hides it.
- `createStripeCheckoutForOrder`'s signature and return type do not change. `checkoutCart`'s return shape does not change.
- Helpers live in `src/lib/` and carry no `"use server"` directive. Do not export them from any `"use server"` file (`src/app/__tests__/server-action-exports.test.ts` pins this).
- `catch (err)` with `unknown`, narrowed with `err instanceof Error ? err.message : String(err)` where a message is read. No `any` in product code.
- No new env var, no flag, no user-facing copy, no price string anywhere (`no-preselection-price.test.ts`).
- Tests are real-DB (`createTestDb`, `factories.ts`); mock only Stripe, Printful, auth, `next/headers` and the email transport. Tests do not assert catalog prices.
- Writing style in comments and test names: plain statements of what and why.

## Review Focus (name these to the reviewers as things to probe)

1. Stripe throws after actually creating the session (timeout, reset connection), and the buyer pays anyway: the abandoned order must still be claimed, booked and fulfilled by the webhook. Pinned in Task 1.
2. The abandon update fails (database error) while handling a Stripe error: the caller must see the Stripe error, not the database error. Pinned in Task 1.
3. The abandon helper run on an order it must not touch: one with a `stripe_session_id`, a `paid` order, an already abandoned one (first timestamp kept). Pinned in Task 1.
4. Cart cleanup over-deleting: a sibling image in the same conversation, a line with a different back, a line with the same front and no back, the swapped line. Under-deleting: the purchased line when the stored JSON has its keys in a different order, a cart-originated order's lines with and without a back. Pinned in Task 3.
5. Cart cleanup on null placements: an order line with null placements clears a null cart line and not a pinned one; a pinned order line does not clear a null cart line. Pinned in Task 3.
6. A cleanup failure must still not fail the webhook (the existing test, kept and extended) and the cart left as it was.
7. A line the buyer adds after `checkoutCart` created the order, with the same design, garment, size and colour as a purchased line but different placements, survives payment. Pinned in Task 3.

## File structure

- Modify `src/lib/order-checkout.ts`: add `abandonSessionlessOrder(orderId)`; wrap the Stripe call in `createStripeCheckoutForOrder`.
- Modify `src/app/cart/actions.ts`: wrap the Stripe call in `checkoutCart` with the same helper.
- Modify `src/lib/user-orders.ts`: comment only (stale file name and "leaves this null forever").
- Create `src/lib/cart-line-match.ts`: `cartLineMatch(userId, line)`, the SQL condition that matches a cart line to an order line.
- Modify `src/lib/webhook-handlers.ts`: the cart-cleanup block only.
- Modify `src/lib/__tests__/money-path.integration.test.ts`: seed matching `placements` on the three tests named above.
- Create tests:
  - `src/lib/__tests__/order-checkout-stripe-failure.integration.test.ts`
  - `src/app/d/__tests__/buy-stripe-failure.integration.test.ts`
  - `src/app/cart/__tests__/checkout-stripe-failure.integration.test.ts`
  - `src/lib/__tests__/cart-line-match.integration.test.ts`
  - `src/app/cart/__tests__/webhook-cart-cleanup-placements.integration.test.ts`

Setup: the worktree has no `node_modules`; run `npm ci` once first. Run a single file with `npx vitest run <path>`.

---

### Task 1: a Stripe error abandons the order (`createStripeCheckoutForOrder`)

**Files:**
- Modify: `src/lib/order-checkout.ts`
- Modify: `src/lib/user-orders.ts` (comment only, lines 47-55)
- Test: `src/lib/__tests__/order-checkout-stripe-failure.integration.test.ts` (create)
- Test: `src/app/d/__tests__/buy-stripe-failure.integration.test.ts` (create)

**Interfaces:**
- Produces: `abandonSessionlessOrder(orderId: string): Promise<void>` exported from `src/lib/order-checkout.ts`. Never throws. Marks a still-pending, not-abandoned, session-less order abandoned. Task 2 consumes it.
- Consumes: `db` from `@/lib/db`, `orderTable` from the schema, `and`, `eq`, `isNull` from drizzle-orm.

- [ ] **Step 1: Write the failing tests for the helper and `createStripeCheckoutForOrder`**

Create `src/lib/__tests__/order-checkout-stripe-failure.integration.test.ts`:

```ts
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
```

Create `src/app/d/__tests__/buy-stripe-failure.integration.test.ts`, the same fact through the real action, with the same mocks as `buy-own-unpublished.integration.test.ts` (copy its `vi.hoisted`, `@/lib/db`, `@/lib/auth`, `next/headers` blocks) and a Stripe mock that throws while `h.stripeError` is set:

```ts
/**
 * #289 item 1 through the real buy action: a published image bought from its
 * image detail page, Stripe throws. The order is abandoned (rows kept, Shop
 * attribution intact), the buyer sees the Stripe error, and a retry makes a
 * second, live order.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  stripeError: null as Error | null,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) =>
    Boolean(u?.isAnonymous),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async () => {
          if (h.stripeError) throw h.stripeError;
          return {
            id: "cs_test_retry",
            url: "https://checkout.stripe.example/cs_test_retry",
          };
        }),
      },
    },
  },
}));

import { buyPublishedDesign } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;
const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  const conversation = await makeDesign(db, "seller");
  const publishedId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "seller",
    imageUrl: "https://img.example/published.png",
    publishedAt: new Date(),
  });
  return { publishedId };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  h.stripeError = null;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("STRIPE_SECRET_KEY", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("buyPublishedDesign when Stripe throws", () => {
  it("abandons the order, keeps its rows and Shop attribution, and re-throws", async () => {
    const db = h.db as Db;
    const { publishedId } = await seed(db);
    const boom = new Error("stripe boom");
    h.stripeError = boom;

    await expect(
      buyPublishedDesign({ imageId: publishedId, ...OPTS })
    ).rejects.toBe(boom);

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(1);
    expect(orders[0].abandonedAt).not.toBeNull();
    expect(orders[0].stripeSessionId).toBeNull();
    expect(orders[0].storeProductId).not.toBeNull();
    expect(await db.select().from(schema.orderItem)).toHaveLength(1);
  });

  it("a retry once Stripe recovers makes a second, live order", async () => {
    const db = h.db as Db;
    const { publishedId } = await seed(db);
    h.stripeError = new Error("stripe boom");
    await expect(
      buyPublishedDesign({ imageId: publishedId, ...OPTS })
    ).rejects.toThrow("stripe boom");

    h.stripeError = null;
    const result = await buyPublishedDesign({ imageId: publishedId, ...OPTS });
    expect(result.url).toBe("https://checkout.stripe.example/cs_test_retry");

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(2);
    expect(orders.filter((o) => o.abandonedAt !== null)).toHaveLength(1);
    const live = orders.filter((o) => o.abandonedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].stripeSessionId).toBe("cs_test_retry");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/order-checkout-stripe-failure.integration.test.ts src/app/d/__tests__/buy-stripe-failure.integration.test.ts`
Expected: FAIL. `abandonSessionlessOrder` is not exported (import error / "is not a function"), and the two action-level cases see `abandonedAt` null.

- [ ] **Step 3: Implement**

In `src/lib/order-checkout.ts`:

- Import `and`, `isNull` alongside `eq` from `drizzle-orm`.
- Add the helper above `createStripeCheckoutForOrder`:

```ts
/**
 * Marks a checkout that never got a Stripe session as abandoned (#289). The
 * order and its lines are inserted before Stripe is called, so a Stripe error
 * would otherwise leave a `pending` order with no session id behind. This sets
 * the same `abandoned_at` that `checkout.session.expired` sets; the rows stay,
 * so a webhook for a session that was paid anyway can still claim the order.
 *
 * Conditional like `handleStripeCheckoutExpired`: only a still-pending,
 * not-yet-abandoned order with no session id is touched. Never throws — it
 * runs inside a catch block, and a failure here must not replace the Stripe
 * error the caller is about to re-throw.
 */
export async function abandonSessionlessOrder(orderId: string): Promise<void> {
  try {
    await db
      .update(orderTable)
      .set({ abandonedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(orderTable.id, orderId),
          eq(orderTable.status, "pending"),
          isNull(orderTable.abandonedAt),
          isNull(orderTable.stripeSessionId)
        )
      );
  } catch (err) {
    console.error(
      `Order ${orderId}: could not mark abandoned after a Stripe error (non-fatal):`,
      err instanceof Error ? err.message : String(err)
    );
  }
}
```

- In `createStripeCheckoutForOrder`, replace `const checkoutSession = await stripe.checkout.sessions.create(buildCheckoutSessionParams({...}))` with the same call inside a `try`, keeping every argument as it is:

```ts
  let checkoutSession: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    checkoutSession = await stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
        /* arguments unchanged */
      })
    );
  } catch (err) {
    await abandonSessionlessOrder(orderId);
    throw err;
  }
```

  Leave the `db.update(...).set({ stripeSessionId })` after it outside the `try` (Decision 3). Update the function's doc comment with one sentence: on a Stripe error the order is marked abandoned and the error is re-thrown.

In `src/lib/user-orders.ts`, comment only: in the block at lines 47-55 change "checkout.ts inserts the order row before creating the Stripe session, so a session-create failure, or any pre-#231 legacy row … leaves this null forever" to say that `order-checkout.ts` inserts the order before creating the session, that a session-create failure now marks the row abandoned (`abandonSessionlessOrder`), and that a session-less row could never have been paid, so it is hidden regardless. Do not change the query.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/order-checkout-stripe-failure.integration.test.ts src/app/d/__tests__/buy-stripe-failure.integration.test.ts src/app/__tests__/server-action-exports.test.ts src/lib/__tests__/user-orders.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/order-checkout.ts src/lib/user-orders.ts src/lib/__tests__/order-checkout-stripe-failure.integration.test.ts src/app/d/__tests__/buy-stripe-failure.integration.test.ts
git commit -m "fix: a Stripe error during checkout marks the order abandoned instead of leaving it pending (#289)"
```

---

### Task 2: the cart checkout abandons its order on a Stripe error

**Files:**
- Modify: `src/app/cart/actions.ts` (`checkoutCart`, around the `stripe.checkout.sessions.create` call)
- Test: `src/app/cart/__tests__/checkout-stripe-failure.integration.test.ts` (create)

**Interfaces:**
- Consumes: `abandonSessionlessOrder(orderId: string): Promise<void>` from `@/lib/order-checkout` (Task 1).
- Produces: nothing new. `checkoutCart`'s return shape is unchanged; a Stripe error still propagates.

- [ ] **Step 1: Write the failing test**

Create `src/app/cart/__tests__/checkout-stripe-failure.integration.test.ts`. Copy the mock block of `checkout-revalidates-lines.integration.test.ts` (`@/lib/db`, `@/lib/auth`, `next/headers`, `next/cache`, `@/lib/ai`, `@/lib/email`, `@/lib/printful` with `estimateOrderCosts` returning null), and use this Stripe mock and cases:

```ts
/**
 * #289 item 1 on the cart path: checkoutCart inserts the order and its lines
 * before it calls Stripe. A Stripe error abandons the order (rows kept), the
 * error reaches the caller, and the cart is left as it was so the buyer can
 * try again.
 */
const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  stripeError: null as Error | null,
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async () => {
          if (h.stripeError) throw h.stripeError;
          return { id: "cs_test_cart_retry", url: "https://checkout.stripe.example/cs_test_cart_retry" };
        }),
      },
    },
  },
}));

import { addToCart, checkoutCart } from "@/app/cart/actions";

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seedCart(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  const conversation = await makeDesign(db, "seller");
  const first = await makeSourceImage(db, {
    designId: conversation.id, ownerId: "seller",
    imageUrl: "https://img.example/first.png", publishedAt: new Date(),
  });
  const second = await makeSourceImage(db, {
    designId: conversation.id, ownerId: "seller",
    imageUrl: "https://img.example/second.png", publishedAt: new Date(),
  });
  await addToCart({ frontImageId: first, ...OPTS });
  await addToCart({ frontImageId: second, ...OPTS });
}

describe("checkoutCart when Stripe throws", () => {
  it("abandons the order, keeps its lines, re-throws, and leaves the cart intact", async () => {
    const db = h.db as Db;
    await seedCart(db);
    const boom = new Error("stripe boom");
    h.stripeError = boom;

    await expect(checkoutCart()).rejects.toBe(boom);

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("pending");
    expect(orders[0].abandonedAt).not.toBeNull();
    expect(orders[0].stripeSessionId).toBeNull();
    expect(await db.select().from(schema.orderItem)).toHaveLength(2);
    expect(await db.select().from(schema.cartItem)).toHaveLength(2);
  });

  it("a retry once Stripe recovers makes a live order from the same cart", async () => {
    const db = h.db as Db;
    await seedCart(db);
    h.stripeError = new Error("stripe boom");
    await expect(checkoutCart()).rejects.toThrow("stripe boom");

    h.stripeError = null;
    const result = await checkoutCart();
    expect(result.url).toBe("https://checkout.stripe.example/cs_test_cart_retry");

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(2);
    const live = orders.filter((o) => o.abandonedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].stripeSessionId).toBe("cs_test_cart_retry");
  });
});
```

The `beforeEach` sets `h.db = await createTestDb()`, `h.session = { user: { id: "buyer", email: "buyer@example.com", isAnonymous: false } }`, `h.stripeError = null`, and stubs `MULTI_PLACEMENT_ENABLED=true` and `NEXT_PUBLIC_APP_URL=http://localhost:3000`; `afterEach` unstubs.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/cart/__tests__/checkout-stripe-failure.integration.test.ts`
Expected: FAIL: the first case sees `abandonedAt` null.

- [ ] **Step 3: Implement**

In `src/app/cart/actions.ts`, import `abandonSessionlessOrder` from `@/lib/order-checkout` (a new import of a function; nothing is exported from this file). Wrap the Stripe call:

```ts
  let checkoutSession: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    checkoutSession = await stripe.checkout.sessions.create(
      buildCartCheckoutSessionParams({
        /* arguments unchanged */
      })
    );
  } catch (err) {
    await abandonSessionlessOrder(orderId);
    throw err;
  }
```

Leave the session-id `update` after it outside the `try`, and leave the cart-not-cleared comment as it is. Add to the function's doc comment one sentence on the Stripe error path.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/cart/__tests__ src/app/__tests__/server-action-exports.test.ts`
Expected: PASS (the whole cart test directory, to catch a mock that now sees an extra import).

- [ ] **Step 5: Commit**

```bash
git add src/app/cart/actions.ts src/app/cart/__tests__/checkout-stripe-failure.integration.test.ts
git commit -m "fix: a Stripe error during cart checkout marks the order abandoned (#289)"
```

---

### Task 3: the webhook's cart cleanup matches placements

**Files:**
- Create: `src/lib/cart-line-match.ts`
- Modify: `src/lib/webhook-handlers.ts` (the cart-cleanup block after the claim, and its imports)
- Modify: `src/lib/__tests__/money-path.integration.test.ts` (seed placements on three tests)
- Test: `src/lib/__tests__/cart-line-match.integration.test.ts` (create)
- Test: `src/app/cart/__tests__/webhook-cart-cleanup-placements.integration.test.ts` (create)

**Interfaces:**
- Produces: `cartLineMatch(userId: string, line: { designId: string; productId: string; size: string; color: string; placements: Record<string, string> | null }): SQL` in `src/lib/cart-line-match.ts`. The condition is true for a `cart_item` row of that user with the same design, product, size and colour whose `placements.front` and `placements.back` equal the line's (null equals absent, null placements equal null placements).
- Consumes: `cartItem` from the schema, `and`, `eq`, `sql`, `type SQL` from drizzle-orm.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/cart-line-match.integration.test.ts` (node env, real DB, no mocks). It inserts cart rows directly and deletes with `cartLineMatch`:

```ts
/**
 * #289 item 3: the condition the webhook deletes cart lines with. Real
 * libSQL; the JSON is compared by value, not by text.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign } from "./factories";
import { cartLineMatch } from "@/lib/cart-line-match";

type Db = Awaited<ReturnType<typeof createTestDb>>;
type Placements = Record<string, string> | null;

let db: Db;
let designId: string;

const BASE = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function addLine(
  placements: Placements,
  overrides: Partial<typeof schema.cartItem.$inferInsert> = {}
) {
  const [row] = await db
    .insert(schema.cartItem)
    .values({ userId: "buyer", designId, ...BASE, placements, ...overrides })
    .returning();
  return row.id;
}

async function deleteMatching(placements: Placements) {
  await db
    .delete(schema.cartItem)
    .where(cartLineMatch("buyer", { designId, ...BASE, placements }));
}

async function remainingIds() {
  return (await db.select().from(schema.cartItem)).map((r) => r.id);
}

beforeEach(async () => {
  db = await createTestDb();
  await makeUser(db, "buyer");
  await makeUser(db, "other");
  designId = (await makeDesign(db, "buyer")).id;
});

describe("cartLineMatch", () => {
  it("removes the line with the same front", async () => {
    const mine = await addLine({ front: "A" });
    await deleteMatching({ front: "A" });
    expect(await remainingIds()).not.toContain(mine);
  });

  it("keeps a line for a different front image of the same design", async () => {
    const sibling = await addLine({ front: "B" });
    await deleteMatching({ front: "A" });
    expect(await remainingIds()).toEqual([sibling]);
  });

  it("keeps a line with a back when the purchase has none, and the reverse", async () => {
    const withBack = await addLine({ front: "A", back: "C" });
    const noBack = await addLine({ front: "A" });
    await deleteMatching({ front: "A" });
    expect(await remainingIds()).toEqual([withBack]);
    await deleteMatching({ front: "A", back: "C" });
    expect(await remainingIds()).toEqual([]);
    expect(noBack).toBeTruthy();
  });

  it("keeps a line with a different back", async () => {
    const otherBack = await addLine({ front: "A", back: "D" });
    await deleteMatching({ front: "A", back: "C" });
    expect(await remainingIds()).toEqual([otherBack]);
  });

  it("matches when the stored JSON has its keys in the other order", async () => {
    await db.run(
      sql`insert into cart_item (id, user_id, design_id, product_id, size, color, placements, quantity, created_at)
          values ('reordered', 'buyer', ${designId}, ${BASE.productId}, ${BASE.size}, ${BASE.color}, '{"back":"C","front":"A"}', 1, 0)`
    );
    await deleteMatching({ front: "A", back: "C" });
    expect(await remainingIds()).toEqual([]);
  });

  it("matches null placements to null placements only", async () => {
    const legacy = await addLine(null);
    const pinned = await addLine({ front: "A" });
    await deleteMatching(null);
    expect(await remainingIds()).toEqual([pinned]);
    await deleteMatching({ front: "A" });
    expect(await remainingIds()).toEqual([]);
    expect(legacy).toBeTruthy();
  });

  it("a pinned purchase does not clear a line with null placements", async () => {
    const legacy = await addLine(null);
    await deleteMatching({ front: "A" });
    expect(await remainingIds()).toEqual([legacy]);
  });

  it("still scopes by user, design, product, size and colour", async () => {
    const otherUser = await addLine({ front: "A" }, { userId: "other" });
    const otherSize = await addLine({ front: "A" }, { size: "L" });
    const otherColor = await addLine({ front: "A" }, { color: "White" });
    const otherProduct = await addLine({ front: "A" }, { productId: "other-blank" });
    const otherDesign = await addLine(
      { front: "A" },
      { designId: (await makeDesign(db, "buyer")).id }
    );
    await deleteMatching({ front: "A" });
    expect((await remainingIds()).sort()).toEqual(
      [otherUser, otherSize, otherColor, otherProduct, otherDesign].sort()
    );
  });
});
```

(Add `import { sql } from "drizzle-orm";` for the raw insert, and drop the `eq` import if unused. The `other-blank` product id is only a text column in `cart_item`, so no catalog entry is needed.)

Create `src/app/cart/__tests__/webhook-cart-cleanup-placements.integration.test.ts`. Same mock block as `checkout-revalidates-lines.integration.test.ts` (db, auth, headers, `next/cache`, `@/lib/ai`, `@/lib/email`, `@/lib/printful`), plus a Stripe mock that records every session's params, so the test can read `metadata.orderId` of the order just created:

```ts
/**
 * #289 item 3 through the real actions and the real webhook handler: a paid
 * order clears the cart lines it bought, matched on the order line's front and
 * back images, and nothing else. Lines are created by `addToCart`, orders by
 * `buyPublishedDesign` or `checkoutCart`, payment by
 * `handleStripeCheckoutCompleted`.
 */
const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  sessionParams: [] as Stripe.Checkout.SessionCreateParams[],
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
          h.sessionParams.push(params);
          return {
            id: `cs_test_cleanup_${h.sessionParams.length}`,
            url: "https://checkout.stripe.example/cleanup",
          };
        }),
      },
    },
  },
}));

import { addToCart, checkoutCart } from "@/app/cart/actions";
import { buyPublishedDesign } from "@/app/d/actions";
import {
  handleStripeCheckoutCompleted,
  type WebhookDeps,
  type StripeSessionData,
} from "@/lib/webhook-handlers";

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

/** Pays the order the last Stripe session was created for. */
async function payLastOrder(db: Db) {
  const params = h.sessionParams[h.sessionParams.length - 1];
  const orderId = params.metadata!.orderId;
  const order = await db.query.order.findFirst({ where: eq(schema.order.id, orderId) });
  const total = Math.round(order!.totalPrice * 100);
  const shipping = Math.round((order!.shippingPrice ?? 0) * 100);
  const session: StripeSessionData = {
    id: `cs_paid_${orderId}`,
    metadata: { orderId, designId: order!.designId },
    paymentStatus: "paid",
    paymentIntentId: "pi_cleanup",
    amountTotal: total,
    amountSubtotal: total - shipping,
    amountShipping: shipping,
    discount: null,
    shipping: {
      name: "Jane Doe", address1: "1 Main St", address2: "",
      city: "Town", state: "CA", zip: "90001", country: "US",
    },
  };
  const deps = {
    db,
    createPrintfulOrder: vi.fn().mockResolvedValue({ id: 5001, costs: { total: "12.00" } }),
    generateOrderName: vi.fn().mockResolvedValue("Cleanup"),
    resolveDesignImageUrl: vi.fn().mockResolvedValue("https://img.example/x.png"),
    resolveImageUrlById: async (id: string) => `https://img.example/${id}.png`,
  } as unknown as WebhookDeps;
  const result = await handleStripeCheckoutCompleted(session, deps);
  expect(result.action).toBe("submitted");
}

async function cartPlacements(db: Db) {
  return (await db.select().from(schema.cartItem)).map((r) => r.placements);
}
```

Seed: users `seller` and `buyer`; one conversation owned by the seller with three published images `A`, `B`, `C` (`makeSourceImage` with `publishedAt: new Date()`); `h.session` is the buyer. `beforeEach` stubs `MULTI_PLACEMENT_ENABLED=true`, `NEXT_PUBLIC_APP_URL`, and clears `EMBEDDED_CHECKOUT_ENABLED`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` as in `buy-own-unpublished.integration.test.ts`.

Cases (each asserts on `cart_item` rows after `payLastOrder`):

1. **"paying for one image keeps the cart line for a sibling image from the same conversation"** (the issue's case; fails before the fix): `addToCart({ frontImageId: A, ...OPTS })`, `addToCart({ frontImageId: B, ...OPTS })`, `buyPublishedDesign({ imageId: A, ...OPTS })`, `payLastOrder`. Expect `cartPlacements` equal `[{ front: B }]`.
2. **"the exact-match line is removed, and a line differing only in size survives"**: lines A/M, A/L; buy A/M; remaining is the A/L line (check `size`).
3. **"a line with a back: only the line with the same back is removed"**: lines `{front: A, back: C}`, `{front: A}`, `{front: A, back: B}`; buy `A` with `backImageId: C`; remaining placements are `{front: A}` and `{front: A, back: B}`. Then a second purchase of `A` with no back clears `{front: A}` and leaves `{front: A, back: B}`.
4. **"a swapped purchase clears its own line, not the line for the page image"**: lines `{front: A}` and `{front: B, back: A}`; `buyPublishedDesign({ imageId: A, frontImageId: B, backImageId: A, ...OPTS })`; remaining is `{front: A}`.
5. **"a cart purchase clears exactly its own lines, with and without a back"**: lines `{front: A}`, `{front: B, back: C}` and `{front: A, back: B}` with size L; `checkoutCart()`; then, before paying, `addToCart({ frontImageId: B, ...OPTS })` (same design, garment, size and colour as the purchased `{front: B, back: C}` line, no back); `payLastOrder`. Remaining is exactly `[{ front: B }]`, the line added after checkout.
6. **"a line for another buyer's cart is untouched"**: a second user's cart line for the same image, garment, size and colour survives (the `userId` scope).

Add, in the same file, the two null-placements cases against a directly seeded order (money-path style: insert `order` + `order_item` with `placements: null`, cart lines inserted with `db.insert`, `handleStripeCheckoutCompleted` from `payLastOrder`'s session shape; no Stripe action involved, so build the session from the order row):

7. **"an order line with null placements clears a null cart line and keeps a pinned one"**.
8. **"a pinned order line keeps a cart line with null placements"**.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/cart-line-match.integration.test.ts src/app/cart/__tests__/webhook-cart-cleanup-placements.integration.test.ts`
Expected: FAIL. `@/lib/cart-line-match` does not exist; in the webhook file cases 1, 3, 4 and 5 fail on current behaviour (the sibling line is deleted).

- [ ] **Step 3: Implement**

Create `src/lib/cart-line-match.ts`:

```ts
import { and, eq, sql, type SQL } from "drizzle-orm";
import { cartItem as cartItemTable } from "@/lib/db/schema";

type OrderLine = {
  designId: string;
  productId: string;
  size: string;
  color: string;
  placements: Record<string, string> | null;
};

/** `json_extract(placements, '$.<key>')` equals the image id, or is null when
 * there is none: an absent key (or null placements) equals a missing image id. Compares values, so the
 * key order of the stored JSON does not matter. `key` is a literal, never user
 * input. */
function placementIs(key: "front" | "back", value: string | null): SQL {
  const extracted = sql`json_extract(${cartItemTable.placements}, ${sql.raw(`'$.${key}'`)})`;
  return value === null ? sql`${extracted} is null` : sql`${extracted} = ${value}`;
}

/**
 * The cart lines a paid order line bought (#289): same buyer, design, garment,
 * size and colour, and the same front and back images. Matching the images as
 * well keeps the cleanup from removing an unpaid line for a different image of
 * the same conversation. A line with null placements (from before the front
 * was pinned) matches only an order line with null placements; leaving an
 * unpaid line behind is the safe direction.
 */
export function cartLineMatch(userId: string, line: OrderLine): SQL {
  return and(
    eq(cartItemTable.userId, userId),
    eq(cartItemTable.designId, line.designId),
    eq(cartItemTable.productId, line.productId),
    eq(cartItemTable.size, line.size),
    eq(cartItemTable.color, line.color),
    placementIs("front", line.placements?.front ?? null),
    placementIs("back", line.placements?.back ?? null)
  )!;
}
```

In `src/lib/webhook-handlers.ts` import `cartLineMatch`, drop the now-unused `cartItemTable` import only if nothing else uses it (the delete still needs `cartItemTable`, keep it), and replace the loop inside the existing `try`:

```ts
  try {
    const deletes = orderItems.map((item) =>
      deps.db
        .delete(cartItemTable)
        .where(cartLineMatch(foundOrder.userId, item))
    );
    if (deletes.length > 0) {
      await deps.db.batch([deletes[0], ...deletes.slice(1)]);
    }
  } catch (err) {
    console.error(`Order ${orderId}: cart cleanup failed (non-fatal):`, err);
  }
```

Keep the existing comment above it and add: the lines are matched on the order line's front and back images as well (#289), and the deletes are one batch so a failure leaves the cart as it was.

In `src/lib/__tests__/money-path.integration.test.ts` seed matching placements so the cleanup runs against what it should:

- "cart order (#26)": the three `cartItem` rows get `placements: { front: "img-1" }`, `{ front: "img-2" }` and, for the line added mid-checkout, `{ front: "img-3" }`.
- "returns submitted even when clearing the cart throws": the cart row gets `placements: { front: "img-1" }` (it must match, so the proxy's throwing `delete` is reached).
- "single-item order … clears its matching cart line": the matching row gets `placements: { front: "img-1" }`, and the unrelated row `placements: { front: "img-9" }`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/__tests__/cart-line-match.integration.test.ts src/app/cart/__tests__/webhook-cart-cleanup-placements.integration.test.ts src/lib/__tests__/money-path.integration.test.ts src/lib/__tests__/payment-status.integration.test.ts src/app/api/webhooks/stripe`
Expected: PASS, including the unchanged "clearing the cart throws" case (the throwing `delete` is hit while building the statements, inside the `try`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cart-line-match.ts src/lib/webhook-handlers.ts src/lib/__tests__/cart-line-match.integration.test.ts src/lib/__tests__/money-path.integration.test.ts src/app/cart/__tests__/webhook-cart-cleanup-placements.integration.test.ts
git commit -m "fix: the webhook's cart cleanup matches front and back images, not only the design (#289)"
```

---

### Close

- [ ] Gate: `npm run lint && npm run typecheck && npm test && npm run db:generate && npm run build` (build env: the dummy block in `ci.yml`'s `check` job). `db:generate` must print "No schema changes".
- [ ] Confirm by reading the diff that nothing under `src/lib/ledger.ts`, `src/lib/order-fulfillment.ts`, `src/lib/order-emails*`, `src/lib/db/schema.ts` or `drizzle/` changed, and that the only edit inside `handleStripeCheckoutCompleted` is the cart-cleanup block.
- [ ] Whole-branch review, with the Review Focus list given as things to probe.
- [ ] Dedicated adversarial review of the money path: a second reviewer whose only brief is to make the branch lose an order a customer paid for, delete a cart line that was not paid for, leave one that was, or let a cleanup failure change what the buyer or Stripe sees.
- [ ] Fix round, re-gate, PR (not HOLD: no migration). CI's `check` and PR e2e green before it is called ready. The e2e and nightly Stripe cart purchase (`e2e/stripe-money-path.spec.ts`) add cart lines from `/preview` and buy them through the cart; they are the end-to-end witness that cart-originated lines still clear, so read the nightly's result after merge.
- [ ] After merge: merge main into the held #249 branch and re-gate (it also touches `src/app/d/actions.ts` and `src/lib/webhook-handlers.ts`). Items 2 and 4 of #289 stay open on that PR.

No live smoke is owed. The Stripe-error path cannot be reached from the UI. The cart cleanup could only be checked on prntd.org with a real payment, on a conversation that publishes at least two images, and the integration tests above drive the same real actions and handler. If Nico wants a live check anyway, it is a real purchase of one of two carted images from the same conversation, and the PASS is that the other image's line is still in the cart afterwards.

## Not in this plan

- Item 2 (cart orders never record `store_product_id`) and item 4 (published read from two places). Both wait for #249.
- Letting a buyer delete a conversation that has only abandoned, never-paid orders (`delete-design.ts` blocks on any order row). Not changed; worth its own issue if wanted.
- Making `checkoutCart` return a masked-proof `{ error }` instead of throwing on a Stripe error. Its current behaviour (throw) is unchanged.
- De-duplicating identical cart lines.
