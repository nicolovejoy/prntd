import { describe, it, expect, vi } from "vitest";
import { calculateStripeFee, recordSale, recordCOGS, recordCancellation } from "../ledger";

describe("calculateStripeFee", () => {
  it("calculates fee for a typical order", () => {
    // $29.00 → 29 * 0.029 + 0.30 = 1.141 → rounded to 1.14
    expect(calculateStripeFee(29)).toBe(1.14);
  });

  it("calculates fee for a small amount", () => {
    // $1.00 → 1 * 0.029 + 0.30 = 0.329 → rounded to 0.33
    expect(calculateStripeFee(1)).toBe(0.33);
  });

  it("calculates fee for a large amount", () => {
    // $100 → 100 * 0.029 + 0.30 = 3.20
    expect(calculateStripeFee(100)).toBe(3.2);
  });

  it("handles zero", () => {
    expect(calculateStripeFee(0)).toBe(0.3);
  });
});

function mockDb() {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  return {
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    _mocks: { insertValues },
  } as any;
}

describe("recordSale", () => {
  it("inserts sale and stripe_fee entries", async () => {
    const db = mockDb();
    await recordSale("order-1", 29, "Test order", db);

    expect(db._mocks.insertValues).toHaveBeenCalledOnce();
    const entries = db._mocks.insertValues.mock.calls[0][0];
    expect(entries).toHaveLength(2);

    expect(entries[0].type).toBe("sale");
    expect(entries[0].amount).toBe(29);
    expect(entries[0].orderId).toBe("order-1");

    expect(entries[1].type).toBe("stripe_fee");
    expect(entries[1].amount).toBe(-calculateStripeFee(29));
    expect(entries[1].orderId).toBe("order-1");
  });
});

describe("recordCOGS", () => {
  it("inserts negative cogs entry", async () => {
    const db = mockDb();
    await recordCOGS("order-1", 15.5, "Printful cost", db);

    const entry = db._mocks.insertValues.mock.calls[0][0];
    expect(entry.type).toBe("cogs");
    expect(entry.amount).toBe(-15.5);
    expect(entry.orderId).toBe("order-1");
  });
});

describe("recordCancellation", () => {
  it("inserts negative refund entry", async () => {
    const db = mockDb();
    await recordCancellation("order-1", 29, "Canceled", db);

    const entry = db._mocks.insertValues.mock.calls[0][0];
    expect(entry.type).toBe("refund");
    expect(entry.amount).toBe(-29);
    expect(entry.orderId).toBe("order-1");
  });
});
