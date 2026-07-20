// @vitest-environment node
/**
 * Route-level tests for the Printful webhook (WP5), run against a real
 * in-memory DB (createTestDb) so the route's own joins and the shipping-email
 * hero resolution (resolveHeroImages → design-images → email-images) execute
 * for real. Only the outbound email sender is mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";
import { getColorHex } from "@/lib/blanks";
import { createTestDb } from "@/lib/__tests__/test-db";

const state = vi.hoisted(() => ({
  db: null as unknown,
}));

// The route (and design-images, transitively) import the app db; route every
// access to the per-test in-memory DB.
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/email", () => ({
  sendShippingNotification: vi.fn().mockResolvedValue(undefined),
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
}));

import { POST } from "../route";
import { sendShippingNotification } from "@/lib/email";

type Db = Awaited<ReturnType<typeof createTestDb>>;
const shippingEmailMock = vi.mocked(sendShippingNotification);

function db(): Db {
  return state.db as Db;
}

function request(payload: unknown) {
  return new NextRequest("http://localhost/api/webhooks/printful", {
    method: "POST",
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
}

async function seed(opts: {
  orderOverrides?: Partial<typeof schema.order.$inferInsert>;
  designOverrides?: Partial<typeof schema.design.$inferInsert>;
} = {}) {
  const userId = "pf-user";
  await db()
    .insert(schema.user)
    .values({ id: userId, email: "customer@example.com", name: "Customer" });
  const [design] = await db()
    .insert(schema.design)
    .values({ userId, ...opts.designOverrides })
    .returning();
  const [order] = await db()
    .insert(schema.order)
    .values({
      userId,
      designId: design.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      totalPrice: 24.12,
      status: "submitted",
      printfulOrderId: "9999",
      displayName: "Test Shirt",
      ...opts.orderOverrides,
    })
    .returning();
  return { userId, design, order };
}

beforeEach(async () => {
  vi.clearAllMocks();
  state.db = await createTestDb();
});

describe("Printful webhook route — malformed input", () => {
  it("400s on a non-JSON body", async () => {
    const res = await POST(request("not json {"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
  });

  it("404s when no order matches the Printful id", async () => {
    const res = await POST(
      request({ type: "package_shipped", data: { order: { id: 424242 } } })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/No order found/);
  });

  it("400s on a missing Printful order id", async () => {
    const res = await POST(request({ type: "package_shipped", data: {} }));
    expect(res.status).toBe(400);
  });
});

describe("Printful webhook route — package_shipped", () => {
  it("marks the order shipped and sends the shipping email with the cached mockup hero", async () => {
    const mockupUrl = "https://mock.example/front-mockup.png";
    const { order } = await seed({
      designOverrides: {
        // Same key shape /preview caches: product:placement:color:scale.
        mockupUrls: { "bella-canvas-3001:front:Black:200": mockupUrl },
      },
    });

    const res = await POST(
      request({
        type: "package_shipped",
        data: {
          order: { id: 9999 },
          shipment: {
            tracking_number: "1Z999",
            tracking_url: "https://track.example/1Z999",
          },
        },
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    const updated = await db().query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("shipped");
    expect(updated?.trackingNumber).toBe("1Z999");
    expect(updated?.trackingUrl).toBe("https://track.example/1Z999");

    // Hero resolution preferred the cached Printful mockup (no backdrop).
    expect(shippingEmailMock).toHaveBeenCalledTimes(1);
    expect(shippingEmailMock).toHaveBeenCalledWith({
      to: "customer@example.com",
      orderId: order.id,
      trackingNumber: "1Z999",
      trackingUrl: "https://track.example/1Z999",
      displayName: "Test Shirt",
      images: [{ label: "Front", url: mockupUrl, backdrop: null }],
    });
  });

  it("falls back to the design artwork on a shirt-color backdrop when no mockup is cached", async () => {
    const { design } = await seed();
    const [image] = await db()
      .insert(schema.designImage)
      .values({
        designId: design.id,
        aspectRatio: "1:1",
        imageUrl: "https://img.example/artwork.png",
      })
      .returning();
    await db()
      .update(schema.design)
      .set({ primaryImageId: image.id })
      .where(eq(schema.design.id, design.id));

    const res = await POST(
      request({
        type: "package_shipped",
        data: { order: { id: 9999 }, shipment: { tracking_number: "T2" } },
      })
    );

    expect(res.status).toBe(200);
    expect(shippingEmailMock).toHaveBeenCalledTimes(1);
    const call = shippingEmailMock.mock.calls[0][0];
    expect(call.images).toEqual([
      {
        label: "Front",
        url: "https://img.example/artwork.png",
        backdrop: getColorHex("bella-canvas-3001", "Black"),
      },
    ]);
    expect(call.trackingUrl).toBeNull();
  });

  it("redelivery at shipped returns 200 and does not re-send the email", async () => {
    const { order } = await seed({
      orderOverrides: { status: "shipped", trackingNumber: "1Z999" },
    });

    const res = await POST(
      request({
        type: "package_shipped",
        data: { order: { id: 9999 }, shipment: { tracking_number: "1Z999" } },
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(shippingEmailMock).not.toHaveBeenCalled();
    const updated = await db().query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("shipped");
  });
});

describe("Printful webhook route — order_canceled", () => {
  it("cancels the order, reverses booked COGS, and books no refund", async () => {
    const { order } = await seed({ orderOverrides: { printfulCost: 12.5 } });
    await db().insert(schema.ledgerEntry).values({
      orderId: order.id,
      type: "cogs",
      amount: -12.5,
      description: "Printful fulfillment PF:9999",
    });

    const res = await POST(
      request({ type: "order_canceled", data: { order: { id: 9999 } } })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    const updated = await db().query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("canceled");
    expect(updated?.printfulCost).toBe(0);

    const entries = await db().query.ledgerEntry.findMany({
      where: eq(schema.ledgerEntry.orderId, order.id),
      orderBy: (entry, { asc }) => [asc(entry.createdAt)],
    });
    const types = entries.map((e) => e.type);
    expect(types).toContain("refund_cogs_reversal");
    expect(types).not.toContain("refund");
    expect(shippingEmailMock).not.toHaveBeenCalled();
  });

  it("redelivery at canceled returns 200 without a second reversal row", async () => {
    const { order } = await seed({
      orderOverrides: { status: "canceled", printfulCost: 0 },
    });

    const res = await POST(
      request({ type: "order_canceled", data: { order: { id: 9999 } } })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    const entries = await db().query.ledgerEntry.findMany({
      where: eq(schema.ledgerEntry.orderId, order.id),
    });
    expect(entries).toHaveLength(0);
  });
});

describe("Printful webhook route — other events", () => {
  it("acknowledges order_failed without changing the order", async () => {
    const { order } = await seed();
    const res = await POST(
      request({
        type: "order_failed",
        data: { order: { id: 9999 }, reason: "Out of stock" },
      })
    );
    expect(res.status).toBe(200);
    const updated = await db().query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("submitted");
  });
});
