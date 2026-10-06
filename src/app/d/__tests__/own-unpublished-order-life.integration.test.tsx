/**
 * The whole life of an order the owner placed for their own UNPUBLISHED image
 * from the image detail page (one buy surface, slice 3), against a real
 * in-memory libSQL. The order is created by the real `buyPublishedDesign`, and
 * then goes through the real handlers a /preview order goes through, with
 * `store_product_id` null:
 *
 *  - `handleStripeCheckoutCompleted` claims it and books `sale` + `stripe_fee`;
 *  - `submitOrderFulfillment` (inside it) submits the pinned image, not the
 *    conversation's current primary, and books `cogs`;
 *  - `sendPostOrderEmails` builds both emails from the real loader;
 *  - `/orders` (`getUserOrdersData` + `OrdersList`) and the admin order detail
 *    (`getOrderDetail` + the page) show it.
 *
 * No product code reads `order.store_product_id`, which is why the null needs
 * no special case; this test is the proof that nothing downstream assumed it.
 * Only Stripe, Printful, order naming and the email transport are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  return {
    db: null as unknown,
    session: null as unknown,
    orderId: "unset",
    sessionParams: [] as Stripe.Checkout.SessionCreateParams[],
  };
});

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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
          h.sessionParams.push(params);
          return {
            id: "cs_test_life",
            url: "https://checkout.stripe.example/cs_test_life",
          };
        }),
      },
    },
  },
}));
vi.mock("@/lib/printful", () => ({
  createOrder: vi.fn(),
  getOrderByExternalId: vi.fn(),
  estimateOrderCosts: vi.fn(async () => null),
}));
vi.mock("@/lib/ai", () => ({ generateOrderName: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: h.orderId }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => `/admin/orders/${h.orderId}`,
}));
// The admin detail PAGE gets the real action's output; its other actions are
// not exercised here.
vi.mock("@/app/admin/actions", async (importActual) => {
  const actual = await importActual<typeof import("@/app/admin/actions")>();
  return {
    ...actual,
    retryPrintfulSubmission: vi.fn(),
    recoverPendingOrder: vi.fn(),
    refundOrder: vi.fn(),
    archiveOrder: vi.fn(),
    unarchiveOrder: vi.fn(),
    setOrderClassification: vi.fn(),
    setOrderTags: vi.fn(),
  };
});

import { buyPublishedDesign } from "@/app/d/actions";
import { handleStripeCheckoutCompleted } from "@/lib/webhook-handlers";
import type { WebhookDeps, StripeSessionData } from "@/lib/webhook-handlers";
import { sendPostOrderEmails, createDefaultOrderEmailDeps } from "@/lib/order-emails";
import { getDesignDisplayImageUrl, getDesignImageById } from "@/lib/design-images";
import { getUserOrdersData } from "@/lib/user-orders";
import { getOrderDetail } from "@/app/admin/actions";
import { OrdersList } from "@/app/orders/orders-list";
import OrderDetailPage from "@/app/admin/orders/[id]/page";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };
const OWNER_SESSION = {
  user: {
    id: "owner",
    email: "admin@example.com",
    isAnonymous: false,
  },
};

async function seedAndOrder(db: Db, withBack: boolean) {
  await makeUser(db, "owner");
  // The admin check matches on email; the owner is the admin here only so
  // getOrderDetail can be called with the same session.
  await db
    .update(schema.user)
    .set({ email: "admin@example.com" })
    .where(eq(schema.user.id, "owner"));

  const conversation = await makeDesign(db, "owner");
  const privateId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "owner",
    imageUrl: "https://img.example/ordered.png",
  });
  const primaryId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "owner",
    imageUrl: "https://img.example/current-primary.png",
  });
  const backId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "owner",
    imageUrl: "https://img.example/back.png",
  });
  // The conversation's display image is a DIFFERENT image from the one
  // ordered, so a fulfillment that fell back to it would print the wrong art.
  await db
    .update(schema.design)
    .set({ primaryImageId: primaryId })
    .where(eq(schema.design.id, conversation.id));

  await buyPublishedDesign({
    imageId: privateId,
    ...(withBack ? { backImageId: backId } : {}),
    ...OPTS,
  });
  const [order] = await db.select().from(schema.order);
  h.orderId = order.id;
  return { order, conversationId: conversation.id, privateId, backId };
}

function makeDeps(db: Db) {
  const createPrintfulOrder = vi
    .fn()
    .mockResolvedValue({ id: 4242, costs: { total: "11.00" } });
  const deps = {
    db,
    createPrintfulOrder,
    generateOrderName: vi.fn().mockResolvedValue("Ordered Own Image"),
    resolveDesignImageUrl: getDesignDisplayImageUrl,
    resolveImageUrlById: async (imageId: string) =>
      (await getDesignImageById(imageId))?.imageUrl ?? null,
  } as unknown as WebhookDeps;
  return { deps, createPrintfulOrder };
}

/** The session Stripe would report for the order as created: the amounts are
 * the order's own, so nothing here names a catalog price. */
function paidSession(
  order: typeof schema.order.$inferSelect,
  designId: string
): StripeSessionData {
  const shipping = Math.round((order.shippingPrice ?? 0) * 100);
  const total = Math.round(order.totalPrice * 100);
  return {
    id: "cs_test_life",
    metadata: { orderId: order.id, designId },
    paymentStatus: "paid",
    paymentIntentId: "pi_life",
    amountTotal: total,
    amountSubtotal: total - shipping,
    amountShipping: shipping,
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
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = OWNER_SESSION;
  h.sessionParams = [];
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});

describe("an owner's unpublished-image order after checkout", () => {
  it("is claimed, booked, fulfilled with the pinned image, and emailed", async () => {
    const db = h.db as Db;
    const { order, conversationId, privateId } = await seedAndOrder(db, false);
    expect(order.storeProductId).toBeNull();
    expect(order.status).toBe("pending");

    const { deps, createPrintfulOrder } = makeDeps(db);
    const result = await handleStripeCheckoutCompleted(
      paidSession(order, conversationId),
      deps
    );
    expect(result.action).toBe("submitted");

    const claimed = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(claimed?.status).toBe("submitted");
    expect(claimed?.storeProductId).toBeNull();
    expect(claimed?.printfulOrderId).toBe("4242");
    expect(claimed?.shippingCity).toBe("Town");

    // sale + stripe_fee at the claim, cogs at the submission: one each.
    const ledger = await db.query.ledgerEntry.findMany({
      where: eq(schema.ledgerEntry.orderId, order.id),
    });
    expect(ledger.map((e) => e.type).sort()).toEqual(
      ["cogs", "sale", "stripe_fee"].sort()
    );
    // Money in is positive, money out negative.
    expect(ledger.find((e) => e.type === "cogs")!.amount).toBeLessThan(0);
    expect(ledger.find((e) => e.type === "sale")!.amount).toBeGreaterThan(0);

    // The pinned image is what is submitted, not the conversation's primary.
    expect(createPrintfulOrder).toHaveBeenCalledTimes(1);
    const submitted = createPrintfulOrder.mock.calls[0][0];
    expect(submitted.externalId).toBe(order.id);
    expect(submitted.items).toHaveLength(1);
    expect(submitted.items[0].files).toEqual([
      { placement: "front", url: "https://img.example/ordered.png" },
    ]);
    expect(privateId).toBeTruthy();

    // Both emails are built from the real loader and sent once.
    const senders = {
      sendOrderConfirmation: vi.fn(),
      sendOwnerOrderAlert: vi.fn(),
    };
    await sendPostOrderEmails(
      order.id,
      createDefaultOrderEmailDeps(db, senders)
    );
    expect(senders.sendOrderConfirmation).toHaveBeenCalledTimes(1);
    expect(senders.sendOwnerOrderAlert).toHaveBeenCalledTimes(1);
    const confirmation = senders.sendOrderConfirmation.mock.calls[0][0];
    expect(confirmation.to).toBe("admin@example.com");
    expect(confirmation.orderId).toBe(order.id);
    expect(confirmation.lines).toHaveLength(1);
    expect(confirmation.lines[0]).toMatchObject({
      productName: "Classic Tee",
      size: OPTS.size,
      color: OPTS.color,
      quantity: 1,
      imageUrl: "https://img.example/ordered.png",
    });
    expect(senders.sendOwnerOrderAlert.mock.calls[0][0]).toMatchObject({
      orderId: order.id,
      customerEmail: "admin@example.com",
    });
  });

  it("submits the pinned back too when one was ordered", async () => {
    const db = h.db as Db;
    const { order, conversationId } = await seedAndOrder(db, true);

    const { deps, createPrintfulOrder } = makeDeps(db);
    expect(
      (await handleStripeCheckoutCompleted(paidSession(order, conversationId), deps))
        .action
    ).toBe("submitted");

    const files = createPrintfulOrder.mock.calls[0][0].items[0].files;
    expect(files).toEqual([
      { placement: "front", url: "https://img.example/ordered.png" },
      { placement: "back", url: "https://img.example/back.png" },
    ]);
  });

  it("a redelivery of the same event is skipped and books nothing twice", async () => {
    const db = h.db as Db;
    const { order, conversationId } = await seedAndOrder(db, false);
    const { deps, createPrintfulOrder } = makeDeps(db);
    const session = paidSession(order, conversationId);

    await handleStripeCheckoutCompleted(session, deps);
    expect((await handleStripeCheckoutCompleted(session, deps)).action).toBe(
      "skipped"
    );
    expect(createPrintfulOrder).toHaveBeenCalledTimes(1);
    expect(await db.select().from(schema.ledgerEntry)).toHaveLength(3);
  });

  it("shows on /orders with the pinned artwork", async () => {
    const db = h.db as Db;
    const { order, conversationId } = await seedAndOrder(db, false);
    const { deps } = makeDeps(db);
    await handleStripeCheckoutCompleted(paidSession(order, conversationId), deps);

    const orders = await getUserOrdersData("owner");
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(order.id);
    expect(orders[0].lines).toHaveLength(1);
    expect(orders[0].lines[0].imageUrl).toBe("https://img.example/ordered.png");

    render(<OrdersList orders={orders} />);
    expect(screen.getAllByText(/M \/ Black/).length).toBeGreaterThan(0);
    // next/image rewrites the src, so match on the artwork's file name.
    const srcs = [...document.querySelectorAll("img")].map(
      (img) => img.getAttribute("src") ?? ""
    );
    expect(srcs.some((src) => src.includes("ordered.png"))).toBe(true);
  });

  it("shows in the admin order detail, ledger included", async () => {
    const db = h.db as Db;
    const { order, conversationId } = await seedAndOrder(db, false);
    const { deps } = makeDeps(db);
    await handleStripeCheckoutCompleted(paidSession(order, conversationId), deps);

    const detail = await getOrderDetail(order.id);
    expect(detail.id).toBe(order.id);
    expect(detail.status).toBe("submitted");
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0].imageUrl).toBe("https://img.example/ordered.png");
    expect(detail.designImageUrl).toBe("https://img.example/ordered.png");
    expect(detail.ledger.map((e) => e.type).sort()).toEqual(
      ["cogs", "sale", "stripe_fee"].sort()
    );

    render(<OrderDetailPage />);
    expect(await screen.findAllByText(/Classic Tee — M \/ Black/)).not.toHaveLength(0);
  });

  it("a Stripe checkout that expires marks the unclaimed order abandoned, like any other", async () => {
    const db = h.db as Db;
    const { order } = await seedAndOrder(db, false);
    const { handleStripeCheckoutExpired } = await import("@/lib/webhook-handlers");

    const { action } = await handleStripeCheckoutExpired(order.id, { db });
    expect(action).not.toBe("ignored");
    const after = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(after?.abandonedAt).not.toBeNull();
    expect(after?.status).toBe("pending");
    expect(await db.select().from(schema.ledgerEntry)).toHaveLength(0);
  });
});
