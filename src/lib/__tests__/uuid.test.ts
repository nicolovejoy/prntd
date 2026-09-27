import { describe, it, expect } from "vitest";
import { isUuid } from "@/lib/uuid";

describe("isUuid", () => {
  it("accepts a canonical UUID", () => {
    expect(isUuid(crypto.randomUUID())).toBe(true);
  });

  it("accepts uppercase hex", () => {
    expect(isUuid(crypto.randomUUID().toUpperCase())).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("rejects a short/truncated id", () => {
    expect(isUuid(crypto.randomUUID().slice(0, -1))).toBe(false);
  });

  it("rejects a non-hex character in place of a hex digit", () => {
    const id = crypto.randomUUID();
    expect(isUuid("g" + id.slice(1))).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid({})).toBe(false);
  });
});
