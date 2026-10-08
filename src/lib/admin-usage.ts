/**
 * Pure helpers behind /admin/usage: merging the per-table aggregates into
 * one row per user, the totals row, and display formatting. The queries live
 * in src/app/admin/usage/actions.ts; nothing here touches the database.
 */
import { formatDisplayDate } from "./display-time-zone";

export type UsageUserBase = {
  id: string;
  email: string;
  isAnonymous: boolean | null;
  createdAt: Date;
};

/** Succeeded-job counts and spend for one user, from `image_generation`. */
export type GenerationAgg = {
  today: number;
  week: number;
  total: number;
  generateTotal: number;
  editTotal: number;
  /** Failed or cancelled jobs started in the last 7 days. */
  failedWeek: number;
  spendTotal: number;
  spendWeek: number;
};

export type OrderAgg = {
  /** Orders that are neither pending nor abandoned. */
  paidCount: number;
  paidRevenue: number;
  paidWeek: number;
  /** Latest order of any status, for the "last active" sort. */
  lastOrderAt: Date | null;
};

export type UsageAggregates = {
  users: UsageUserBase[];
  generations: Map<string, GenerationAgg>;
  lastImageAt: Map<string, Date>;
  conversations: Map<string, number>;
  chat: Map<string, { week: number; lastAt: Date | null }>;
  publications: Map<string, { published: number; hidden: number }>;
  orders: Map<string, OrderAgg>;
  cartLines: Map<string, number>;
  genIp: Map<string, string>;
  sessionIp: Map<string, string>;
};

export type UsageUserRow = {
  id: string;
  label: string;
  kind: "GUEST" | "ACCOUNT";
  createdAt: Date;
  lastActiveAt: Date | null;
  generations: {
    today: number;
    week: number;
    total: number;
    generateTotal: number;
    editTotal: number;
  };
  failedWeek: number;
  spend: number;
  conversations: number;
  chatWeek: number;
  published: number;
  hidden: number;
  paidOrders: number;
  revenue: number;
  cartLines: number;
  ip: string | null;
};

export type UsageTotals = {
  activeUsers7d: number;
  generations7d: number;
  failed7d: number;
  spend7d: number;
  paidOrders7d: number;
};

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function usageIdentity(user: {
  id: string;
  email: string;
  isAnonymous: boolean | null;
}): { label: string; kind: "GUEST" | "ACCOUNT" } {
  return user.isAnonymous
    ? { label: `guest · ${shortId(user.id)}`, kind: "GUEST" }
    : { label: user.email, kind: "ACCOUNT" };
}

function latest(...dates: (Date | null | undefined)[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (d && (!best || d.getTime() > best.getTime())) best = d;
  }
  return best;
}

/** One user's row from the aggregates; absent aggregates read as zero. */
export function buildUsageRow(
  user: UsageUserBase,
  agg: UsageAggregates,
): UsageUserRow {
  const gen = agg.generations.get(user.id);
  const chat = agg.chat.get(user.id);
  const pub = agg.publications.get(user.id);
  const orders = agg.orders.get(user.id);
  return {
    id: user.id,
    ...usageIdentity(user),
    createdAt: user.createdAt,
    lastActiveAt: latest(
      agg.lastImageAt.get(user.id),
      chat?.lastAt,
      orders?.lastOrderAt,
    ),
    generations: {
      today: gen?.today ?? 0,
      week: gen?.week ?? 0,
      total: gen?.total ?? 0,
      generateTotal: gen?.generateTotal ?? 0,
      editTotal: gen?.editTotal ?? 0,
    },
    failedWeek: gen?.failedWeek ?? 0,
    spend: gen?.spendTotal ?? 0,
    conversations: agg.conversations.get(user.id) ?? 0,
    chatWeek: chat?.week ?? 0,
    published: pub?.published ?? 0,
    hidden: pub?.hidden ?? 0,
    paidOrders: orders?.paidCount ?? 0,
    revenue: orders?.paidRevenue ?? 0,
    cartLines: agg.cartLines.get(user.id) ?? 0,
    ip: agg.genIp.get(user.id) ?? agg.sessionIp.get(user.id) ?? null,
  };
}

/**
 * Rows for the user list plus the totals row. A guest with no image, chat
 * message or order is a session mint, not a user, and is left out of the
 * rows (its jobs still count in the totals). Most recently active first; an
 * account that has done nothing is listed last.
 */
export function mergeUsageRows(
  agg: UsageAggregates,
  weekStart: Date,
): { rows: UsageUserRow[]; totals: UsageTotals } {
  const totals: UsageTotals = {
    activeUsers7d: 0,
    generations7d: 0,
    failed7d: 0,
    spend7d: 0,
    paidOrders7d: 0,
  };
  for (const g of agg.generations.values()) {
    totals.generations7d += g.week;
    totals.failed7d += g.failedWeek;
    totals.spend7d += g.spendWeek;
  }
  for (const o of agg.orders.values()) totals.paidOrders7d += o.paidWeek;

  const rows: UsageUserRow[] = [];
  for (const user of agg.users) {
    const row = buildUsageRow(user, agg);
    if (row.kind === "GUEST" && row.lastActiveAt === null) continue;
    rows.push(row);
  }
  rows.sort((a, b) => {
    const at = a.lastActiveAt?.getTime() ?? -Infinity;
    const bt = b.lastActiveAt?.getTime() ?? -Infinity;
    if (at !== bt) return bt > at ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  totals.activeUsers7d = rows.filter(
    (r) => r.lastActiveAt && r.lastActiveAt.getTime() >= weekStart.getTime(),
  ).length;
  return { rows, totals };
}

/** "just now", "5 min ago", "3 h ago" within a day, else the Pacific date. */
export function formatLastActive(date: Date | null, now: Date): string {
  if (!date) return "—";
  const ageMs = now.getTime() - date.getTime();
  if (ageMs < 60_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)} min ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)} h ago`;
  return formatDisplayDate(date);
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export const PROMPT_PREVIEW_CHARS = 140;

export function truncatePrompt(prompt: string | null): {
  text: string;
  truncated: boolean;
} {
  if (!prompt) return { text: "", truncated: false };
  if (prompt.length <= PROMPT_PREVIEW_CHARS) {
    return { text: prompt, truncated: false };
  }
  return { text: prompt.slice(0, PROMPT_PREVIEW_CHARS), truncated: true };
}

/** A positive integer from a `?limit=` param, else `fallback`; capped at `max`. */
export function parseLimit(
  raw: string | string[] | undefined,
  fallback: number,
  max: number,
): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = value === undefined ? NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}
