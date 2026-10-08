import { describe, expect, it } from "vitest";
import {
  buildUsageRow,
  formatLastActive,
  formatUsd,
  mergeUsageRows,
  parseLimit,
  shortId,
  truncatePrompt,
  usageIdentity,
  type UsageAggregates,
} from "../admin-usage";

const NOW = new Date("2026-10-08T20:00:00Z");
const WEEK_START = new Date("2026-10-02T07:00:00Z");

function emptyAgg(): UsageAggregates {
  return {
    users: [],
    generations: new Map(),
    lastImageAt: new Map(),
    conversations: new Map(),
    chat: new Map(),
    publications: new Map(),
    orders: new Map(),
    cartLines: new Map(),
    genIp: new Map(),
    sessionIp: new Map(),
  };
}

describe("usageIdentity", () => {
  it("shows a guest as guest · first 8 of the id", () => {
    expect(
      usageIdentity({
        id: "abcdef12-3456-7890",
        email: "temp@x.invalid",
        isAnonymous: true,
      }),
    ).toEqual({ label: "guest · abcdef12", kind: "GUEST" });
  });

  it("shows an account as its email", () => {
    expect(
      usageIdentity({ id: "u1", email: "a@example.com", isAnonymous: false }),
    ).toEqual({ label: "a@example.com", kind: "ACCOUNT" });
    expect(
      usageIdentity({ id: "u1", email: "a@example.com", isAnonymous: null }),
    ).toEqual({ label: "a@example.com", kind: "ACCOUNT" });
  });
});

describe("mergeUsageRows", () => {
  it("leaves out a guest with no images, messages or orders, but keeps its jobs in the totals", () => {
    const agg = emptyAgg();
    agg.users = [
      { id: "g1", email: "g1@x", isAnonymous: true, createdAt: new Date("2026-10-07T00:00:00Z") },
      { id: "a1", email: "a1@x", isAnonymous: false, createdAt: new Date("2026-09-01T00:00:00Z") },
    ];
    agg.generations.set("g1", {
      today: 0, week: 0, total: 0, generateTotal: 0, editTotal: 0,
      failedWeek: 2, spendTotal: 0, spendWeek: 0,
    });
    const { rows, totals } = mergeUsageRows(agg, WEEK_START);
    expect(rows.map((r) => r.id)).toEqual(["a1"]);
    expect(totals.failed7d).toBe(2);
  });

  it("keeps a guest with an image, a chat message, or an order", () => {
    for (const set of [
      (a: UsageAggregates) => a.lastImageAt.set("g1", new Date("2026-10-07T00:00:00Z")),
      (a: UsageAggregates) => a.chat.set("g1", { week: 1, lastAt: new Date("2026-10-07T00:00:00Z") }),
      (a: UsageAggregates) =>
        a.orders.set("g1", { paidCount: 0, paidRevenue: 0, paidWeek: 0, lastOrderAt: new Date("2026-10-07T00:00:00Z") }),
    ]) {
      const agg = emptyAgg();
      agg.users = [{ id: "g1", email: "g1@x", isAnonymous: true, createdAt: new Date("2026-10-06T00:00:00Z") }];
      set(agg);
      expect(mergeUsageRows(agg, WEEK_START).rows.map((r) => r.id)).toEqual(["g1"]);
    }
  });

  it("orders by the latest of last image, last chat message and last order, newest first", () => {
    const agg = emptyAgg();
    const created = new Date("2026-09-01T00:00:00Z");
    agg.users = ["a", "b", "c", "d"].map((id) => ({
      id, email: `${id}@x`, isAnonymous: false, createdAt: created,
    }));
    agg.lastImageAt.set("a", new Date("2026-10-01T00:00:00Z"));
    agg.chat.set("b", { week: 0, lastAt: new Date("2026-10-05T00:00:00Z") });
    agg.orders.set("c", { paidCount: 1, paidRevenue: 10, paidWeek: 0, lastOrderAt: new Date("2026-10-03T00:00:00Z") });
    // d has nothing: an account is still listed, last.
    const { rows } = mergeUsageRows(agg, WEEK_START);
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
    expect(rows[0].lastActiveAt).toEqual(new Date("2026-10-05T00:00:00Z"));
    expect(rows[3].lastActiveAt).toBeNull();
  });

  it("counts active users in the last 7 days over listed rows only", () => {
    const agg = emptyAgg();
    const created = new Date("2026-09-01T00:00:00Z");
    agg.users = ["a", "b"].map((id) => ({ id, email: `${id}@x`, isAnonymous: false, createdAt: created }));
    agg.lastImageAt.set("a", new Date("2026-10-03T00:00:00Z"));
    agg.lastImageAt.set("b", new Date("2026-10-01T00:00:00Z"));
    expect(mergeUsageRows(agg, WEEK_START).totals.activeUsers7d).toBe(1);
  });

  it("sums the totals across all users", () => {
    const agg = emptyAgg();
    const created = new Date("2026-09-01T00:00:00Z");
    agg.users = ["a", "b"].map((id) => ({ id, email: `${id}@x`, isAnonymous: false, createdAt: created }));
    agg.generations.set("a", { today: 1, week: 3, total: 5, generateTotal: 4, editTotal: 1, failedWeek: 1, spendTotal: 0.5, spendWeek: 0.2 });
    agg.generations.set("b", { today: 0, week: 2, total: 2, generateTotal: 2, editTotal: 0, failedWeek: 0, spendTotal: 0.1, spendWeek: 0.1 });
    agg.orders.set("a", { paidCount: 2, paidRevenue: 50, paidWeek: 1, lastOrderAt: null });
    const { totals } = mergeUsageRows(agg, WEEK_START);
    expect(totals.generations7d).toBe(5);
    expect(totals.failed7d).toBe(1);
    expect(totals.spend7d).toBeCloseTo(0.3);
    expect(totals.paidOrders7d).toBe(1);
  });
});

describe("buildUsageRow", () => {
  it("fills zeros for a user with no aggregates and prefers the generation IP", () => {
    const agg = emptyAgg();
    const u = { id: "a", email: "a@x", isAnonymous: false, createdAt: new Date("2026-09-01T00:00:00Z") };
    agg.users = [u];
    const row = buildUsageRow(u, agg);
    expect(row.generations).toEqual({ today: 0, week: 0, total: 0, generateTotal: 0, editTotal: 0 });
    expect(row.spend).toBe(0);
    expect(row.ip).toBeNull();
    agg.sessionIp.set("a", "2.2.2.2");
    expect(buildUsageRow(u, agg).ip).toBe("2.2.2.2");
    agg.genIp.set("a", "1.1.1.1");
    expect(buildUsageRow(u, agg).ip).toBe("1.1.1.1");
  });
});

describe("formatters", () => {
  it("formats last active relative within a day, else as a Pacific date", () => {
    expect(formatLastActive(null, NOW)).toBe("—");
    expect(formatLastActive(new Date(NOW.getTime() - 20_000), NOW)).toBe("just now");
    expect(formatLastActive(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5 min ago");
    expect(formatLastActive(new Date(NOW.getTime() - 3 * 3600_000), NOW)).toBe("3 h ago");
    // 2026-10-07 03:30Z is Oct 6 in Pacific.
    expect(formatLastActive(new Date("2026-10-07T03:30:00Z"), NOW)).toBe("10/6/2026");
  });

  it("formats USD with two decimals", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1.2345)).toBe("$1.23");
  });

  it("shortens ids and truncates prompts at 140 characters", () => {
    expect(shortId("abcdef12-3456")).toBe("abcdef12");
    expect(truncatePrompt(null)).toEqual({ text: "", truncated: false });
    expect(truncatePrompt("short")).toEqual({ text: "short", truncated: false });
    const long = "x".repeat(200);
    const t = truncatePrompt(long);
    expect(t.truncated).toBe(true);
    expect(t.text).toHaveLength(140);
  });

  it("parses ?limit= with a default and a cap", () => {
    expect(parseLimit(undefined, 100, 1000)).toBe(100);
    expect(parseLimit("250", 100, 1000)).toBe(250);
    expect(parseLimit("abc", 100, 1000)).toBe(100);
    expect(parseLimit("-5", 100, 1000)).toBe(100);
    expect(parseLimit("0", 100, 1000)).toBe(100);
    expect(parseLimit("99999", 100, 1000)).toBe(1000);
    expect(parseLimit(["30", "40"], 100, 1000)).toBe(30);
  });
});
