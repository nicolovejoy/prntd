/**
 * submitOrderFulfillment against a real (in-memory) DB. These scenarios are
 * shaped like the admin Printful retry — a paid order re-run outside the
 * Stripe webhook — because that path historically diverged from the webhook
 * (head-line-only submission, lost back placements, missing COGS). One shared
 * fulfillment tail + these tests lock the divergences out.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import {
  submitOrderFulfillment,
  type FulfillmentDeps,
  type ShippingAddress,
} from "@/lib/order-fulfillment";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const SHIPPING: ShippingAddress = {
  name: "Jane Doe",
  address1: "1 Main St",
  address2: "",
  city: "Town",
  state: "CA",
  zip: "90001",
  country: "US",
};

function makeDeps(db: Db, overrides: Partial<FulfillmentDeps> = {}): FulfillmentDeps {
  return {
    db,
    createPrintfulOrder: vi
      .fn()
      .mockResolvedValue({ id: 9999, costs: { total: "12.50" } }),
    generateOrderName: vi.fn().mockResolvedValue("Named by AI"),
    resolveDesignImageUrl: vi
      .fn()
      .mockResolvedValue("https://img.example/display.png"),
    resolveImageUrlById: vi
      .fn()
      .mockImplementation(async (id: string) => `https://img.example/${id}.png`),
    ...overrides,
  } as unknown as FulfillmentDeps;
}

async function seedPaidOrder(
  db: Db,
  orderOverrides: Partial<typeof schema.order.$inferInsert> = {}
) {
  const userId = "user-1";
  await db
    .insert(schema.user)
    .values({ id: userId, email: "buyer@example.com", name: "Buyer" });
  const [design] = await db.insert(schema.design).values({ userId }).returning();
  const [order] = await db
    .insert(schema.order)
    .values({
      userId,
      designId: design.id,
      productId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      totalPrice: 24.12,
      status: "paid",
      shippingName: SHIPPING.name,
      ...orderOverrides,
    })
    .returning();
  return { userId, design, order };
}

describe("submitOrderFulfillment (admin-retry shape)", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("submits every line of a multi-item order, not just the head line", async () => {
    const { userId, design, order } = await seedPaidOrder(db);
    const [design2] = await db.insert(schema.design).values({ userId }).returning();
    const items = await db
      .insert(schema.orderItem)
      .values([
        {
          orderId: order.id,
          designId: design.id,
          productId: "bella-canvas-3001",
          size: "M",
          color: "Black",
          placements: { front: "img-1" },
          quantity: 1,
          itemPrice: 19.43,
        },
        {
          orderId: order.id,
          designId: design2.id,
          productId: "bella-canvas-3001",
          size: "L",
          color: "White",
          placements: { front: "img-2" },
          quantity: 2,
          itemPrice: 19.43,
        },
      ])
      .returning();

    const deps = makeDeps(db);
    const result = await submitOrderFulfillment(order, items, SHIPPING, deps);

    expect(result.action).toBe("submitted");
    const call = (deps.createPrintfulOrder as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.items).toHaveLength(2);
    expect(call.items[1].quantity).toBe(2);
    expect(call.items.map((i: { files: { url: string }[] }) => i.files[0].url)).toEqual([
      "https://img.example/img-1.png",
      "https://img.example/img-2.png",
    ]);

    // Both designs flipped to ordered.
    for (const id of [design.id, design2.id]) {
      const d = await db.query.design.findFirst({
        where: eq(schema.design.id, id),
      });
      expect(d?.status).toBe("ordered");
    }
  });

  it("keeps the back placement on a front+back order", async () => {
    const { order } = await seedPaidOrder(db, {
      placements: { front: "img-front", back: "img-back" },
    });

    const deps = makeDeps(db);
    const result = await submitOrderFulfillment(order, [], SHIPPING, deps);

    expect(result.action).toBe("submitted");
    const files = (deps.createPrintfulOrder as ReturnType<typeof vi.fn>).mock
      .calls[0][0].items[0].files as { placement: string; url: string }[];
    expect(files.map((f) => f.placement).sort()).toEqual(["back", "front"]);
    expect(files.find((f) => f.placement === "back")?.url).toBe(
      "https://img.example/img-back.png"
    );
  });

  it("records COGS in the ledger (the old retry path never did)", async () => {
    const { order } = await seedPaidOrder(db);
    const result = await submitOrderFulfillment(order, [], SHIPPING, makeDeps(db));

    expect(result.action).toBe("submitted");
    const entries = await db.query.ledgerEntry.findMany({
      where: eq(schema.ledgerEntry.orderId, order.id),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("cogs");
    expect(entries[0].amount).toBe(-12.5);

    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("submitted");
    expect(updated?.printfulOrderId).toBe("9999");
    expect(updated?.printfulCost).toBe(12.5);
  });

  it("does not rename an order that already has a displayName", async () => {
    const { order } = await seedPaidOrder(db, { displayName: "Kept Name" });
    const generateOrderName = vi.fn();
    await submitOrderFulfillment(
      order,
      [],
      SHIPPING,
      makeDeps(db, { generateOrderName })
    );

    expect(generateOrderName).not.toHaveBeenCalled();
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.displayName).toBe("Kept Name");
  });

  it("names an unnamed order from the first print file", async () => {
    const { order } = await seedPaidOrder(db);
    await submitOrderFulfillment(order, [], SHIPPING, makeDeps(db));

    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.displayName).toBe("Named by AI");
  });

  it("returns paid without submitting when no line is fulfillable", async () => {
    const { order } = await seedPaidOrder(db);
    const createPrintfulOrder = vi.fn();
    const result = await submitOrderFulfillment(
      order,
      [],
      SHIPPING,
      makeDeps(db, {
        createPrintfulOrder,
        resolveDesignImageUrl: vi.fn().mockResolvedValue(null),
        resolveImageUrlById: vi.fn().mockResolvedValue(null),
      })
    );

    expect(result.action).toBe("paid");
    expect(createPrintfulOrder).not.toHaveBeenCalled();
  });

  it("drops a line with no variant instead of failing the order", async () => {
    const { userId, design, order } = await seedPaidOrder(db);
    const [design2] = await db.insert(schema.design).values({ userId }).returning();
    const items = await db
      .insert(schema.orderItem)
      .values([
        {
          orderId: order.id,
          designId: design.id,
          productId: "bella-canvas-3001",
          size: "M",
          color: "Black",
          quantity: 1,
          itemPrice: 19.43,
        },
        {
          orderId: order.id,
          designId: design2.id,
          productId: "no-such-blank",
          size: "M",
          color: "Black",
          quantity: 1,
          itemPrice: 19.43,
        },
      ])
      .returning();

    const deps = makeDeps(db);
    const result = await submitOrderFulfillment(order, items, SHIPPING, deps);

    expect(result.action).toBe("submitted");
    const call = (deps.createPrintfulOrder as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.items).toHaveLength(1);
  });

  it("recovers a stranded submission: duplicate external_id → fetch existing → submitted + COGS", async () => {
    // Finding #2: a prior attempt created the Printful order but crashed before
    // persisting its id, so this resubmit is rejected as a duplicate. The getter
    // returns the order Printful already has; we persist it instead of leaving
    // the printed order stuck `paid` forever.
    const { order } = await seedPaidOrder(db);
    const createPrintfulOrder = vi
      .fn()
      .mockRejectedValue(
        new Error("Printful API error: 400 External ID (x) is already used by another order")
      );
    const getPrintfulOrderByExternalId = vi
      .fn()
      .mockResolvedValue({ id: 4242, costs: { total: "13.75" } });

    const result = await submitOrderFulfillment(
      order,
      [],
      SHIPPING,
      makeDeps(db, { createPrintfulOrder, getPrintfulOrderByExternalId })
    );

    expect(result.action).toBe("submitted");
    expect(getPrintfulOrderByExternalId).toHaveBeenCalledWith(order.id);

    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("submitted");
    expect(updated?.printfulOrderId).toBe("4242");
    expect(updated?.printfulCost).toBe(13.75);

    const entries = await db.query.ledgerEntry.findMany({
      where: eq(schema.ledgerEntry.orderId, order.id),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("cogs");
    expect(entries[0].amount).toBe(-13.75);
  });

  it("duplicate external_id but no existing order found → paid_printful_failed", async () => {
    const { order } = await seedPaidOrder(db);
    const result = await submitOrderFulfillment(
      order,
      [],
      SHIPPING,
      makeDeps(db, {
        createPrintfulOrder: vi
          .fn()
          .mockRejectedValue(new Error("400 External ID already used")),
        getPrintfulOrderByExternalId: vi.fn().mockResolvedValue(null),
      })
    );

    expect(result.action).toBe("paid_printful_failed");
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("paid");
  });

  it("returns paid_printful_failed when image resolution throws (finding #3a: reads inside the try)", async () => {
    const { order } = await seedPaidOrder(db);
    const createPrintfulOrder = vi.fn();
    const result = await submitOrderFulfillment(
      order,
      [],
      SHIPPING,
      makeDeps(db, {
        createPrintfulOrder,
        // A transient R2/DB read error while resolving the print image must not
        // throw unhandled (that 400s the Stripe webhook) — it yields a
        // cron-retryable paid_printful_failed instead.
        resolveDesignImageUrl: vi
          .fn()
          .mockRejectedValue(new Error("R2 read timeout")),
      })
    );

    expect(result.action).toBe("paid_printful_failed");
    expect(createPrintfulOrder).not.toHaveBeenCalled();
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("paid");
  });

  it("returns paid_printful_failed with no COGS when Printful errors", async () => {
    const { order } = await seedPaidOrder(db);
    const result = await submitOrderFulfillment(
      order,
      [],
      SHIPPING,
      makeDeps(db, {
        createPrintfulOrder: vi.fn().mockRejectedValue(new Error("Printful 500")),
      })
    );

    expect(result.action).toBe("paid_printful_failed");
    const entries = await db.query.ledgerEntry.findMany({
      where: eq(schema.ledgerEntry.orderId, order.id),
    });
    expect(entries).toHaveLength(0);
    const updated = await db.query.order.findFirst({
      where: eq(schema.order.id, order.id),
    });
    expect(updated?.status).toBe("paid");
  });
});
