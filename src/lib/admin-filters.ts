import { ORDER_CLASSIFICATIONS, type OrderClassification } from "./order-classification";

// --- Types ---

export type SortField = "createdAt" | "totalPrice" | "status" | "userEmail";

export type FilterState = {
  classifications: Set<OrderClassification>;
  showArchived: boolean;
  sortField: SortField;
  sortDirection: "asc" | "desc";
};

/*
 * Adding a new filter dimension:
 * 1. Add the state field to FilterState (e.g., statusFilter: Set<string>)
 * 2. Add the action(s) to FilterAction (e.g., TOGGLE_STATUS)
 * 3. Handle the action in filterReducer
 * 4. Add filtering logic to applyFilters() — one new conditional
 * 5. Add UI control alongside the existing filter buttons
 */

export type FilterAction =
  | { type: "TOGGLE_CLASSIFICATION"; classification: OrderClassification }
  | { type: "SET_ALL_CLASSIFICATIONS" }
  | { type: "TOGGLE_ARCHIVED" }
  | { type: "SET_SORT"; field: SortField };

export const initialFilterState: FilterState = {
  classifications: new Set(ORDER_CLASSIFICATIONS),
  showArchived: false,
  sortField: "createdAt",
  sortDirection: "desc",
};

// --- Reducer ---

export function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case "TOGGLE_CLASSIFICATION": {
      const next = new Set(state.classifications);
      if (next.has(action.classification)) {
        if (next.size > 1) next.delete(action.classification);
      } else {
        next.add(action.classification);
      }
      return { ...state, classifications: next };
    }
    case "SET_ALL_CLASSIFICATIONS":
      return { ...state, classifications: new Set(ORDER_CLASSIFICATIONS) };
    case "TOGGLE_ARCHIVED":
      return { ...state, showArchived: !state.showArchived };
    case "SET_SORT":
      return action.field === state.sortField
        ? { ...state, sortDirection: state.sortDirection === "asc" ? "desc" : "asc" }
        : { ...state, sortField: action.field, sortDirection: "desc" };
  }
}

// --- Minimal types for the pure functions (avoid coupling to full Order/LedgerEntry) ---

export type FilterableOrder = {
  id: string;
  status: string;
  classification: string | null;
  archivedAt: Date | null;
  totalPrice: number;
  printfulCost: number | null;
  createdAt: Date | null;
  userEmail: string | null;
};

export type FilterableLedgerEntry = {
  orderId: string | null;
  type: string;
  amount: number;
};

// --- Pure functions ---

export function applyFilters<T extends FilterableOrder>(orders: T[], state: FilterState): T[] {
  return orders.filter((o) => {
    if (!state.showArchived && o.archivedAt) return false;
    if (o.classification && !state.classifications.has(o.classification as OrderClassification)) return false;
    return true;
  });
}

export function applySort<T extends FilterableOrder>(orders: T[], state: FilterState): T[] {
  const dir = state.sortDirection === "asc" ? 1 : -1;
  return [...orders].sort((a, b) => {
    const av = a[state.sortField];
    const bv = b[state.sortField];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });
}

export function computeSummary(
  orders: FilterableOrder[],
  ledger: FilterableLedgerEntry[],
  state: FilterState
) {
  const filtered = applyFilters(orders, state);
  const orderIds = new Set(filtered.map((o) => o.id));

  // Sum ledger entries for visible orders
  const byType: Record<string, number> = {};
  const ordersWithLedger = new Set<string>();
  for (const entry of ledger) {
    if (entry.orderId && orderIds.has(entry.orderId)) {
      byType[entry.type] = (byType[entry.type] ?? 0) + entry.amount;
      ordersWithLedger.add(entry.orderId);
    }
  }

  let revenue = (byType["sale"] ?? 0) + (byType["refund"] ?? 0);
  let stripeFees = byType["stripe_fee"] ?? 0;
  let cogs = byType["cogs"] ?? 0;

  // Fallback: for orders without ledger entries, use order table fields
  for (const o of filtered) {
    if (ordersWithLedger.has(o.id) || o.status === "canceled") continue;
    revenue += o.totalPrice;
    if (o.printfulCost != null) cogs -= o.printfulCost;
  }

  return {
    orderCount: filtered.filter((o) => o.status !== "canceled").length,
    revenue,
    stripeFees,
    cogs: Math.abs(cogs),
    grossProfit: revenue + stripeFees + cogs,
  };
}
