import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  canArchiveOrder,
  VALID_TRANSITIONS,
} from "../order-state";

describe("canTransition", () => {
  it("allows pending → paid", () => {
    expect(canTransition("pending", "paid")).toBe(true);
  });

  it("allows paid → submitted", () => {
    expect(canTransition("paid", "submitted")).toBe(true);
  });

  it("allows submitted → shipped", () => {
    expect(canTransition("submitted", "shipped")).toBe(true);
  });

  it("allows shipped → delivered", () => {
    expect(canTransition("shipped", "delivered")).toBe(true);
  });

  it("rejects pending → shipped (skipping states)", () => {
    expect(canTransition("pending", "shipped")).toBe(false);
  });

  it("allows submitted → canceled", () => {
    expect(canTransition("submitted", "canceled")).toBe(true);
  });

  it("rejects delivered → anything (terminal state)", () => {
    expect(canTransition("delivered", "pending")).toBe(false);
    expect(canTransition("delivered", "paid")).toBe(false);
  });

  it("rejects canceled → anything (terminal state)", () => {
    expect(canTransition("canceled", "submitted")).toBe(false);
  });

  it("rejects backward transitions", () => {
    expect(canTransition("paid", "pending")).toBe(false);
    expect(canTransition("shipped", "submitted")).toBe(false);
  });

  it("rejects unknown status", () => {
    expect(canTransition("garbage", "paid")).toBe(false);
  });
});

describe("assertTransition", () => {
  it("does not throw for valid transitions", () => {
    expect(() => assertTransition("pending", "paid")).not.toThrow();
  });

  it("throws for invalid transitions with descriptive message", () => {
    expect(() => assertTransition("pending", "shipped")).toThrow(
      "Invalid order transition: pending → shipped"
    );
  });
});

describe("VALID_TRANSITIONS", () => {
  it("covers all statuses", () => {
    const statuses = ["pending", "paid", "submitted", "shipped", "delivered", "canceled"];
    for (const s of statuses) {
      expect(VALID_TRANSITIONS).toHaveProperty(s);
    }
  });
});

describe("canArchiveOrder", () => {
  const base = { trackingNumber: null, printfulOrderId: null };

  it("allows pre-fulfillment statuses with no Printful footprint", () => {
    for (const status of ["pending", "paid", "canceled"]) {
      expect(canArchiveOrder({ ...base, status })).toBe(true);
    }
  });

  it("blocks shipped and delivered orders", () => {
    expect(canArchiveOrder({ ...base, status: "shipped" })).toBe(false);
    expect(canArchiveOrder({ ...base, status: "delivered" })).toBe(false);
  });

  it("blocks any order with a Printful order id, regardless of status", () => {
    expect(
      canArchiveOrder({ ...base, status: "paid", printfulOrderId: "9999" })
    ).toBe(false);
    // A canceled order that WAS submitted keeps its Printful id — still locked.
    expect(
      canArchiveOrder({ ...base, status: "canceled", printfulOrderId: "9999" })
    ).toBe(false);
  });

  it("blocks any order with a tracking number", () => {
    expect(
      canArchiveOrder({ ...base, status: "paid", trackingNumber: "1Z999" })
    ).toBe(false);
  });

  it("treats an empty-string tracking number as absent (matches the old truthiness check)", () => {
    expect(
      canArchiveOrder({ ...base, status: "pending", trackingNumber: "" })
    ).toBe(true);
  });

  it("blocks submitted orders (they always carry a Printful id in practice)", () => {
    expect(
      canArchiveOrder({ status: "submitted", trackingNumber: null, printfulOrderId: "8888" })
    ).toBe(false);
  });
});
