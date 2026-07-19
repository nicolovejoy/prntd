import { describe, it, expect, vi } from "vitest";
import {
  calculateStripeFee,
  recordSale,
  recordCOGS,
  recordCancellation,
  summarizeLedger,
} from "../ledger";

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

describe("summarizeLedger", () => {
  it("computes revenue, fees, cogs, and gross profit", () => {
    const s = summarizeLedger({ sale: 24.12, stripe_fee: -1.0, cogs: -12.5 });
    expect(s.revenue).toBe(24.12);
    expect(s.stripeFees).toBe(-1.0);
    expect(s.cogs).toBe(12.5); // reported as a positive magnitude
    expect(s.grossProfit).toBeCloseTo(24.12 - 1.0 - 12.5, 5);
  });

  it("folds refunds into revenue", () => {
    const s = summarizeLedger({ sale: 24.12, refund: -24.12 });
    expect(s.revenue).toBe(0);
  });

  it("handles an empty ledger", () => {
    expect(summarizeLedger({})).toEqual({
      revenue: 0,
      stripeFees: 0,
      cogs: 0,
      grossProfit: 0,
    });
  });

  it("excludes a tax pass-through from gross profit (1C)", () => {
    // Tax collected is a liability we remit, not profit. Adding a `tax` type
    // must not move grossProfit. (This is the deliberate carve-out: an UNKNOWN
    // type stays out of profit — but refund_cogs_reversal is NOT unknown, it's a
    // COGS correction and is folded in, see the next test.)
    const base = { sale: 20, stripe_fee: -0.88, cogs: -10 };
    const withTax = summarizeLedger({ ...base, tax: 1.65 });
    expect(withTax.grossProfit).toBe(summarizeLedger(base).grossProfit);
  });

  it("folds refund_cogs_reversal into gross profit and net COGS (cancel correction)", () => {
    // A submitted-then-canceled order: COGS booked, then reversed. Profit and
    // reported COGS must land exactly where a never-fulfilled order would —
    // otherwise the reversed COGS is silently double-counted against profit.
    const withCogs = { sale: 20, stripe_fee: -0.88, cogs: -10 };
    const reversed = summarizeLedger({ ...withCogs, refund_cogs_reversal: 10 });
    const noCogs = summarizeLedger({ sale: 20, stripe_fee: -0.88 });

    expect(reversed.grossProfit).toBeCloseTo(noCogs.grossProfit, 5);
    expect(reversed.cogs).toBe(0); // net COGS is zero after the reversal
  });
});
