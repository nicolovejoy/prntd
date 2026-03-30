import { describe, it, expect, vi } from "vitest";
import {
  handleStripeCheckoutCompleted,
  handlePrintfulEvent,
  type StripeSessionData,
  type WebhookDeps,
  type PrintfulWebhookPayload,
} from "../webhook-handlers";

// Mock DB helper — returns a minimal mock that satisfies the deps interface
function createMockDb(overrides: {
  orderFindFirst?: () => any;
  designFindFirst?: () => any;
  orderUpdate?: () => any;
  designUpdate?: () => any;
} = {}) {
  const updateSet = vi.fn().mockReturnThis();
  const updateWhere = vi.fn().mockResolvedValue(undefined);

  return {
    query: {
      order: {
        findFirst: overrides.orderFindFirst ?? vi.fn().mockResolvedValue(null),
      },
      design: {
        findFirst: overrides.designFindFirst ?? vi.fn().mockResolvedValue(null),
      },
    },
    update: vi.fn().mockReturnValue({
      set: updateSet.mockReturnValue({ where: updateWhere }),
    }),
    _mocks: { updateSet, updateWhere },
  } as any;
}

function baseSession(overrides?: Partial<StripeSessionData>): StripeSessionData {
  return {
    id: "cs_test_123",
    metadata: { orderId: "order-1", designId: "design-1" },
    paymentIntentId: "pi_123",
    shipping: {
      name: "Test User",
      address1: "123 Main St",
      address2: "",
      city: "Springfield",
      state: "IL",
      zip: "62701",
      country: "US",
    },
    ...overrides,
  };
}

const pendingOrder = {
  id: "order-1",
  designId: "design-1",
  status: "pending",
  color: "Black",
  size: "M",
};

const designWithImage = {
  id: "design-1",
  currentImageUrl: "https://r2.example.com/designs/1/1.png",
};

describe("handleStripeCheckoutCompleted", () => {
  it("processes a pending order through to submitted", async () => {
    const mockDb = createMockDb({
      orderFindFirst: vi.fn().mockResolvedValue(pendingOrder),
      designFindFirst: vi.fn().mockResolvedValue(designWithImage),
    });
    const mockCreateOrder = vi.fn().mockResolvedValue({ id: "pf_123" });

    const result = await handleStripeCheckoutCompleted(baseSession(), {
      db: mockDb,
      createPrintfulOrder: mockCreateOrder,
    });

    expect(result.action).toBe("submitted");
    expect(mockCreateOrder).toHaveBeenCalledOnce();
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("skips already-processed orders (idempotent)", async () => {
    const mockDb = createMockDb({
      orderFindFirst: vi.fn().mockResolvedValue({ ...pendingOrder, status: "paid" }),
    });

    const result = await handleStripeCheckoutCompleted(baseSession(), {
      db: mockDb,
      createPrintfulOrder: vi.fn(),
    });

    expect(result.action).toBe("skipped");
  });

  it("throws when order not found", async () => {
    const mockDb = createMockDb({
      orderFindFirst: vi.fn().mockResolvedValue(null),
    });

    await expect(
      handleStripeCheckoutCompleted(baseSession(), {
        db: mockDb,
        createPrintfulOrder: vi.fn(),
      })
    ).rejects.toThrow("Order order-1 not found");
  });

  it("returns paid when design has no image", async () => {
    const mockDb = createMockDb({
      orderFindFirst: vi.fn().mockResolvedValue(pendingOrder),
      designFindFirst: vi.fn().mockResolvedValue({ id: "design-1", currentImageUrl: null }),
    });

    const result = await handleStripeCheckoutCompleted(baseSession(), {
      db: mockDb,
      createPrintfulOrder: vi.fn(),
    });

    expect(result.action).toBe("paid");
  });

  it("returns paid_printful_failed when Printful errors", async () => {
    const mockDb = createMockDb({
      orderFindFirst: vi.fn().mockResolvedValue(pendingOrder),
      designFindFirst: vi.fn().mockResolvedValue(designWithImage),
    });
    const mockCreateOrder = vi.fn().mockRejectedValue(new Error("Printful down"));

    const result = await handleStripeCheckoutCompleted(baseSession(), {
      db: mockDb,
      createPrintfulOrder: mockCreateOrder,
    });

    expect(result.action).toBe("paid_printful_failed");
  });
});

describe("handlePrintfulEvent", () => {
  const shippedPayload: PrintfulWebhookPayload = {
    type: "package_shipped",
    data: {
      order: { id: 12345 },
      shipment: {
        tracking_number: "1Z999AA10123456784",
        tracking_url: "https://tracking.example.com/1Z999AA10123456784",
      },
    },
  };

  it("updates order to shipped with tracking info", async () => {
    const mockDb = createMockDb({
      orderFindFirst: vi.fn().mockResolvedValue({
        id: "order-1",
        status: "submitted",
        printfulOrderId: "12345",
      }),
    });

    const result = await handlePrintfulEvent(shippedPayload, { db: mockDb });

    expect(result.action).toBe("shipped");
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("rejects shipped transition from invalid state", async () => {
    const mockDb = createMockDb({
      orderFindFirst: vi.fn().mockResolvedValue({
        id: "order-1",
        status: "pending",
        printfulOrderId: "12345",
      }),
    });

    await expect(
      handlePrintfulEvent(shippedPayload, { db: mockDb })
    ).rejects.toThrow("Invalid order transition: pending → shipped");
  });

  it("throws when order not found", async () => {
    const mockDb = createMockDb({
      orderFindFirst: vi.fn().mockResolvedValue(null),
    });

    await expect(
      handlePrintfulEvent(shippedPayload, { db: mockDb })
    ).rejects.toThrow("No order found for Printful ID 12345");
  });

  it("logs order_failed without changing status", async () => {
    const mockDb = createMockDb({
      orderFindFirst: vi.fn().mockResolvedValue({
        id: "order-1",
        status: "submitted",
        printfulOrderId: "12345",
      }),
    });

    const result = await handlePrintfulEvent(
      { type: "order_failed", data: { order: { id: 12345 }, reason: "out of stock" } },
      { db: mockDb }
    );

    expect(result.action).toBe("failed_logged");
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("ignores unhandled event types", async () => {
    const mockDb = createMockDb({
      orderFindFirst: vi.fn().mockResolvedValue({
        id: "order-1",
        status: "submitted",
        printfulOrderId: "12345",
      }),
    });

    const result = await handlePrintfulEvent(
      { type: "order_updated", data: { order: { id: 12345 } } },
      { db: mockDb }
    );

    expect(result.action).toBe("ignored");
  });

  it("throws on missing order ID in payload", async () => {
    const mockDb = createMockDb();

    await expect(
      handlePrintfulEvent({ type: "package_shipped", data: {} }, { db: mockDb })
    ).rejects.toThrow("Missing Printful order ID");
  });
});
