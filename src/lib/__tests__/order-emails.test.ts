import { describe, it, expect, vi } from "vitest";
import { sendPostOrderEmails, type OrderEmailDeps } from "../order-emails";

const LINES = [
  { productName: "Classic Tee", size: "M", color: "Black", quantity: 1 },
];

function createDeps(overrides: Partial<OrderEmailDeps> = {}): OrderEmailDeps {
  return {
    loadOrderForEmail: vi.fn().mockResolvedValue({
      email: "user@example.com",
      totalPrice: 30.0,
      discountCode: null,
      displayName: null,
      lines: LINES,
      images: [],
    }),
    sendOrderConfirmation: vi.fn().mockResolvedValue(undefined),
    sendOwnerOrderAlert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("sendPostOrderEmails", () => {
  it("sends both customer confirmation and owner alert with correct fields", async () => {
    const deps = createDeps();

    await sendPostOrderEmails("order-1", deps);

    expect(deps.loadOrderForEmail).toHaveBeenCalledWith("order-1");
    expect(deps.sendOrderConfirmation).toHaveBeenCalledWith({
      to: "user@example.com",
      orderId: "order-1",
      total: 30.0,
      lines: LINES,
      displayName: null,
      images: [],
    });
    expect(deps.sendOwnerOrderAlert).toHaveBeenCalledWith({
      orderId: "order-1",
      customerEmail: "user@example.com",
      total: 30.0,
      lines: LINES,
      discountCode: null,
      displayName: null,
      images: [],
    });
  });

  it("forwards every line of a multi-item order", async () => {
    const lines = [
      { productName: "Classic Tee", size: "M", color: "Black", quantity: 1 },
      { productName: "Women's Tee", size: "L", color: "White", quantity: 2 },
    ];
    const deps = createDeps({
      loadOrderForEmail: vi.fn().mockResolvedValue({
        email: "user@example.com",
        totalPrice: 60.0,
        discountCode: null,
        displayName: null,
        lines,
        images: [],
      }),
    });

    await sendPostOrderEmails("order-cart", deps);

    expect(deps.sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ lines })
    );
    expect(deps.sendOwnerOrderAlert).toHaveBeenCalledWith(
      expect.objectContaining({ lines })
    );
  });

  it("forwards discountCode to the owner alert", async () => {
    const deps = createDeps({
      loadOrderForEmail: vi.fn().mockResolvedValue({
        email: "user@example.com",
        totalPrice: 15.0,
        discountCode: "nico-codes",
        displayName: null,
        lines: LINES,
        images: [],
      }),
    });

    await sendPostOrderEmails("order-2", deps);

    expect(deps.sendOwnerOrderAlert).toHaveBeenCalledWith(
      expect.objectContaining({ discountCode: "nico-codes", total: 15.0 })
    );
  });

  it("forwards displayName to both customer and owner emails", async () => {
    const deps = createDeps({
      loadOrderForEmail: vi.fn().mockResolvedValue({
        email: "user@example.com",
        totalPrice: 30.0,
        discountCode: null,
        displayName: "Artificial Idiot",
        lines: LINES,
        images: [],
      }),
    });

    await sendPostOrderEmails("order-3", deps);

    expect(deps.sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Artificial Idiot" })
    );
    expect(deps.sendOwnerOrderAlert).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Artificial Idiot" })
    );
  });

  it("skips silently when order is not found", async () => {
    const deps = createDeps({
      loadOrderForEmail: vi.fn().mockResolvedValue(null),
    });

    await sendPostOrderEmails("missing", deps);

    expect(deps.sendOrderConfirmation).not.toHaveBeenCalled();
    expect(deps.sendOwnerOrderAlert).not.toHaveBeenCalled();
  });

  it("swallows errors from sendOrderConfirmation (fire-and-forget)", async () => {
    const deps = createDeps({
      sendOrderConfirmation: vi.fn().mockRejectedValue(new Error("Resend down")),
    });

    await expect(sendPostOrderEmails("order-1", deps)).resolves.toBeUndefined();
  });

  it("swallows errors from sendOwnerOrderAlert (fire-and-forget)", async () => {
    const deps = createDeps({
      sendOwnerOrderAlert: vi.fn().mockRejectedValue(new Error("Resend down")),
    });

    await expect(sendPostOrderEmails("order-1", deps)).resolves.toBeUndefined();
    // Customer email still sent before owner alert failed
    expect(deps.sendOrderConfirmation).toHaveBeenCalled();
  });

  it("swallows errors from loadOrderForEmail", async () => {
    const deps = createDeps({
      loadOrderForEmail: vi.fn().mockRejectedValue(new Error("DB down")),
    });

    await expect(sendPostOrderEmails("order-1", deps)).resolves.toBeUndefined();
    expect(deps.sendOrderConfirmation).not.toHaveBeenCalled();
  });
});
