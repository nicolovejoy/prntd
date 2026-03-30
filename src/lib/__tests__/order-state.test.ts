import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
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

  it("rejects delivered → anything (terminal state)", () => {
    expect(canTransition("delivered", "pending")).toBe(false);
    expect(canTransition("delivered", "paid")).toBe(false);
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
    const statuses = ["pending", "paid", "submitted", "shipped", "delivered"];
    for (const s of statuses) {
      expect(VALID_TRANSITIONS).toHaveProperty(s);
    }
  });
});
