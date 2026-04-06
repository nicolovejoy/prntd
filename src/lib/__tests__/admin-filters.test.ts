import { describe, it, expect } from "vitest";
import {
  filterReducer,
  initialFilterState,
  applyFilters,
  applySort,
  computeSummary,
  type FilterableOrder,
  type FilterableLedgerEntry,
  type FilterState,
} from "../admin-filters";

// --- Test data factories ---

function makeOrder(overrides: Partial<FilterableOrder> = {}): FilterableOrder {
  return {
    id: "order-1",
    status: "shipped",
    classification: "customer",
    archivedAt: null,
    totalPrice: 27.11,
    printfulCost: 18.17,
    createdAt: new Date("2026-04-01"),
    userEmail: "customer@example.com",
    ...overrides,
  };
}

function makeLedger(overrides: Partial<FilterableLedgerEntry> = {}): FilterableLedgerEntry {
  return {
    orderId: "order-1",
    type: "sale",
    amount: 27.11,
    ...overrides,
  };
}

// --- filterReducer ---

describe("filterReducer", () => {
  it("toggles a classification off", () => {
    const state = filterReducer(initialFilterState, {
      type: "TOGGLE_CLASSIFICATION",
      classification: "test",
    });
    expect(state.classifications.has("test")).toBe(false);
    expect(state.classifications.has("customer")).toBe(true);
  });

  it("toggles a classification back on", () => {
    const off = filterReducer(initialFilterState, {
      type: "TOGGLE_CLASSIFICATION",
      classification: "test",
    });
    const on = filterReducer(off, {
      type: "TOGGLE_CLASSIFICATION",
      classification: "test",
    });
    expect(on.classifications.has("test")).toBe(true);
  });

  it("prevents deselecting the last classification", () => {
    let state = initialFilterState;
    // Deselect all but one
    for (const c of ["test", "sample", "owner-use"] as const) {
      state = filterReducer(state, { type: "TOGGLE_CLASSIFICATION", classification: c });
    }
    expect(state.classifications.size).toBe(1);
    expect(state.classifications.has("customer")).toBe(true);

    // Try to deselect the last one — should be a no-op
    const result = filterReducer(state, {
      type: "TOGGLE_CLASSIFICATION",
      classification: "customer",
    });
    expect(result.classifications.size).toBe(1);
  });

  it("SET_ALL_CLASSIFICATIONS resets to all", () => {
    let state = filterReducer(initialFilterState, {
      type: "TOGGLE_CLASSIFICATION",
      classification: "test",
    });
    state = filterReducer(state, { type: "SET_ALL_CLASSIFICATIONS" });
    expect(state.classifications.size).toBe(4);
  });

  it("TOGGLE_ARCHIVED flips showArchived", () => {
    const state = filterReducer(initialFilterState, { type: "TOGGLE_ARCHIVED" });
    expect(state.showArchived).toBe(true);
    const state2 = filterReducer(state, { type: "TOGGLE_ARCHIVED" });
    expect(state2.showArchived).toBe(false);
  });

  it("SET_SORT sets new field with desc direction", () => {
    const state = filterReducer(initialFilterState, {
      type: "SET_SORT",
      field: "totalPrice",
    });
    expect(state.sortField).toBe("totalPrice");
    expect(state.sortDirection).toBe("desc");
  });

  it("SET_SORT toggles direction on same field", () => {
    const state = filterReducer(initialFilterState, {
      type: "SET_SORT",
      field: "createdAt", // same as default
    });
    expect(state.sortField).toBe("createdAt");
    expect(state.sortDirection).toBe("asc");
  });
});

// --- applyFilters ---

describe("applyFilters", () => {
  const orders: FilterableOrder[] = [
    makeOrder({ id: "1", classification: "customer" }),
    makeOrder({ id: "2", classification: "test" }),
    makeOrder({ id: "3", classification: "sample" }),
    makeOrder({ id: "4", classification: "customer", archivedAt: new Date() }),
    makeOrder({ id: "5", classification: "owner-use" }),
  ];

  it("default state: shows all non-archived", () => {
    const result = applyFilters(orders, initialFilterState);
    expect(result.map((o) => o.id)).toEqual(["1", "2", "3", "5"]);
  });

  it("shows archived when toggled", () => {
    const state = { ...initialFilterState, showArchived: true };
    const result = applyFilters(orders, state);
    expect(result.map((o) => o.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("filters by classification subset", () => {
    const state: FilterState = {
      ...initialFilterState,
      classifications: new Set(["customer"] as const),
    };
    const result = applyFilters(orders, state);
    expect(result.map((o) => o.id)).toEqual(["1"]);
  });

  it("classification + archived interact correctly", () => {
    const state: FilterState = {
      ...initialFilterState,
      classifications: new Set(["customer"] as const),
      showArchived: true,
    };
    const result = applyFilters(orders, state);
    expect(result.map((o) => o.id)).toEqual(["1", "4"]);
  });

  it("shows unclassified orders regardless of classification filter", () => {
    const ordersWithNull = [
      ...orders,
      makeOrder({ id: "6", classification: null }),
    ];
    const state: FilterState = {
      ...initialFilterState,
      classifications: new Set(["customer"] as const),
    };
    const result = applyFilters(ordersWithNull, state);
    expect(result.map((o) => o.id)).toEqual(["1", "6"]);
  });
});

// --- applySort ---

describe("applySort", () => {
  const orders: FilterableOrder[] = [
    makeOrder({ id: "1", totalPrice: 10, createdAt: new Date("2026-04-01") }),
    makeOrder({ id: "2", totalPrice: 30, createdAt: new Date("2026-04-03") }),
    makeOrder({ id: "3", totalPrice: 20, createdAt: new Date("2026-04-02") }),
  ];

  it("sorts by createdAt desc (default)", () => {
    const result = applySort(orders, initialFilterState);
    expect(result.map((o) => o.id)).toEqual(["2", "3", "1"]);
  });

  it("sorts by createdAt asc", () => {
    const state = { ...initialFilterState, sortDirection: "asc" as const };
    const result = applySort(orders, state);
    expect(result.map((o) => o.id)).toEqual(["1", "3", "2"]);
  });

  it("sorts by totalPrice desc", () => {
    const state = { ...initialFilterState, sortField: "totalPrice" as const };
    const result = applySort(orders, state);
    expect(result.map((o) => o.id)).toEqual(["2", "3", "1"]);
  });

  it("handles null values by sorting them last", () => {
    const withNull = [
      ...orders,
      makeOrder({ id: "4", createdAt: null }),
    ];
    const result = applySort(withNull, initialFilterState);
    expect(result[result.length - 1].id).toBe("4");
  });

  it("does not mutate original array", () => {
    const original = [...orders];
    applySort(orders, initialFilterState);
    expect(orders.map((o) => o.id)).toEqual(original.map((o) => o.id));
  });
});

// --- computeSummary ---

describe("computeSummary", () => {
  it("computes summary from ledger entries", () => {
    const orders = [makeOrder({ id: "order-1", classification: "customer" })];
    const ledger: FilterableLedgerEntry[] = [
      makeLedger({ orderId: "order-1", type: "sale", amount: 27.11 }),
      makeLedger({ orderId: "order-1", type: "stripe_fee", amount: -1.09 }),
      makeLedger({ orderId: "order-1", type: "cogs", amount: -18.17 }),
    ];

    const result = computeSummary(orders, ledger, initialFilterState);
    expect(result.orderCount).toBe(1);
    expect(result.revenue).toBeCloseTo(27.11);
    expect(result.stripeFees).toBeCloseTo(-1.09);
    expect(result.cogs).toBeCloseTo(18.17);
    expect(result.grossProfit).toBeCloseTo(27.11 - 1.09 - 18.17);
  });

  it("falls back to order fields when no ledger entries exist", () => {
    const orders = [
      makeOrder({ id: "order-1", totalPrice: 27.11, printfulCost: 18.17 }),
    ];
    const ledger: FilterableLedgerEntry[] = [];

    const result = computeSummary(orders, ledger, initialFilterState);
    expect(result.revenue).toBeCloseTo(27.11);
    expect(result.stripeFees).toBe(0);
    expect(result.cogs).toBeCloseTo(18.17);
    expect(result.grossProfit).toBeCloseTo(27.11 - 18.17);
  });

  it("mixes ledger and fallback for different orders", () => {
    const orders = [
      makeOrder({ id: "order-1", totalPrice: 27.11, printfulCost: 18.17 }),
      makeOrder({ id: "order-2", totalPrice: 20.00, printfulCost: 12.95 }),
    ];
    const ledger: FilterableLedgerEntry[] = [
      makeLedger({ orderId: "order-1", type: "sale", amount: 27.11 }),
      makeLedger({ orderId: "order-1", type: "stripe_fee", amount: -1.09 }),
      makeLedger({ orderId: "order-1", type: "cogs", amount: -18.17 }),
      // order-2 has no ledger entries — uses fallback
    ];

    const result = computeSummary(orders, ledger, initialFilterState);
    expect(result.orderCount).toBe(2);
    expect(result.revenue).toBeCloseTo(27.11 + 20.00);
    expect(result.stripeFees).toBeCloseTo(-1.09);
    expect(result.cogs).toBeCloseTo(18.17 + 12.95);
  });

  it("falls back to order fields when only stripe_fee ledger entry exists", () => {
    const orders = [
      makeOrder({ id: "order-1", totalPrice: 27.11, printfulCost: 18.17 }),
    ];
    const ledger: FilterableLedgerEntry[] = [
      makeLedger({ orderId: "order-1", type: "stripe_fee", amount: -1.09 }),
      // no sale or cogs entries — revenue and COGS should come from order fields
    ];

    const result = computeSummary(orders, ledger, initialFilterState);
    expect(result.revenue).toBeCloseTo(27.11);
    expect(result.stripeFees).toBeCloseTo(-1.09);
    expect(result.cogs).toBeCloseTo(18.17);
    expect(result.grossProfit).toBeCloseTo(27.11 - 1.09 - 18.17);
  });

  it("excludes canceled orders from count and fallback", () => {
    const orders = [
      makeOrder({ id: "order-1", totalPrice: 27.11, printfulCost: 18.17 }),
      makeOrder({ id: "order-2", totalPrice: 20.00, status: "canceled" }),
    ];
    const ledger: FilterableLedgerEntry[] = [];

    const result = computeSummary(orders, ledger, initialFilterState);
    expect(result.orderCount).toBe(1);
    expect(result.revenue).toBeCloseTo(27.11);
  });

  it("respects classification filter", () => {
    const orders = [
      makeOrder({ id: "order-1", classification: "customer", totalPrice: 27.11, printfulCost: 18.17 }),
      makeOrder({ id: "order-2", classification: "test", totalPrice: 20.00, printfulCost: 12.95 }),
    ];
    const ledger: FilterableLedgerEntry[] = [];

    const state: FilterState = {
      ...initialFilterState,
      classifications: new Set(["customer"] as const),
    };
    const result = computeSummary(orders, ledger, state);
    expect(result.orderCount).toBe(1);
    expect(result.revenue).toBeCloseTo(27.11);
  });

  it("excludes archived orders from summary by default", () => {
    const orders = [
      makeOrder({ id: "order-1", totalPrice: 27.11 }),
      makeOrder({ id: "order-2", totalPrice: 20.00, archivedAt: new Date() }),
    ];
    const ledger: FilterableLedgerEntry[] = [];

    const result = computeSummary(orders, ledger, initialFilterState);
    expect(result.orderCount).toBe(1);
    expect(result.revenue).toBeCloseTo(27.11);
  });

  it("includes archived orders in summary when showArchived is true", () => {
    const orders = [
      makeOrder({ id: "order-1", totalPrice: 27.11 }),
      makeOrder({ id: "order-2", totalPrice: 20.00, archivedAt: new Date() }),
    ];
    const ledger: FilterableLedgerEntry[] = [];

    const state = { ...initialFilterState, showArchived: true };
    const result = computeSummary(orders, ledger, state);
    expect(result.orderCount).toBe(2);
    expect(result.revenue).toBeCloseTo(47.11);
  });

  it("handles refunds in ledger", () => {
    const orders = [makeOrder({ id: "order-1" })];
    const ledger: FilterableLedgerEntry[] = [
      makeLedger({ orderId: "order-1", type: "sale", amount: 27.11 }),
      makeLedger({ orderId: "order-1", type: "refund", amount: -27.11 }),
    ];

    const result = computeSummary(orders, ledger, initialFilterState);
    expect(result.revenue).toBeCloseTo(0);
  });

  it("ignores ledger entries for orders not in the filtered set", () => {
    const orders = [
      makeOrder({ id: "order-1", classification: "customer" }),
    ];
    const ledger: FilterableLedgerEntry[] = [
      makeLedger({ orderId: "order-1", type: "sale", amount: 27.11 }),
      makeLedger({ orderId: "order-99", type: "sale", amount: 100.00 }), // not in orders
    ];

    const result = computeSummary(orders, ledger, initialFilterState);
    expect(result.revenue).toBeCloseTo(27.11);
  });
});
