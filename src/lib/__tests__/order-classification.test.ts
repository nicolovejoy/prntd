import { describe, it, expect } from "vitest";
import {
  ORDER_CLASSIFICATIONS,
  CLASSIFICATION_INFO,
  FUTURE_CLASSIFICATIONS,
} from "../order-classification";

describe("ORDER_CLASSIFICATIONS", () => {
  it("contains only lowercase kebab-case strings", () => {
    for (const c of ORDER_CLASSIFICATIONS) {
      expect(c).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("has no duplicates", () => {
    const unique = new Set(ORDER_CLASSIFICATIONS);
    expect(unique.size).toBe(ORDER_CLASSIFICATIONS.length);
  });
});

describe("CLASSIFICATION_INFO", () => {
  it("has an entry for every classification", () => {
    for (const c of ORDER_CLASSIFICATIONS) {
      expect(CLASSIFICATION_INFO[c]).toBeDefined();
    }
  });

  it("every entry has required fields", () => {
    for (const c of ORDER_CLASSIFICATIONS) {
      const info = CLASSIFICATION_INFO[c];
      expect(info.label).toBeTruthy();
      expect(info.description).toBeTruthy();
      expect(typeof info.countsAsRevenue).toBe("boolean");
      expect(info.accountingNote).toBeTruthy();
    }
  });

  it("only customer counts as revenue", () => {
    expect(CLASSIFICATION_INFO["customer"].countsAsRevenue).toBe(true);
    for (const c of ORDER_CLASSIFICATIONS) {
      if (c !== "customer") {
        expect(CLASSIFICATION_INFO[c].countsAsRevenue).toBe(false);
      }
    }
  });
});

describe("FUTURE_CLASSIFICATIONS", () => {
  it("does not overlap with current classifications", () => {
    const current = new Set<string>(ORDER_CLASSIFICATIONS);
    for (const f of FUTURE_CLASSIFICATIONS) {
      expect(current.has(f)).toBe(false);
    }
  });
});
