"use client";

import { useEffect, useReducer, useState } from "react";
import Link from "next/link";
import {
  getAdminData,
  retryPrintfulSubmission,
  recoverPendingOrder,
  archiveOrder,
  unarchiveOrder,
  setOrderTags,
  setOrderClassification,
} from "./actions";
import { Badge, Button, Card } from "@/components/ui";
import {
  ORDER_CLASSIFICATIONS,
  CLASSIFICATION_INFO,
  FUTURE_CLASSIFICATIONS,
  type OrderClassification,
} from "@/lib/order-classification";
import {
  filterReducer,
  initialFilterState,
  applyFilters,
  applySort,
  computeSummary,
  type SortField,
} from "@/lib/admin-filters";

type AdminData = Awaited<ReturnType<typeof getAdminData>>;
type Order = AdminData["orders"][number];

// --- Sortable header helper ---

const SORT_COLUMNS: { field: SortField; label: string }[] = [
  { field: "userEmail", label: "Customer" },
  { field: "totalPrice", label: "Revenue" },
  { field: "status", label: "Status" },
  { field: "createdAt", label: "Date" },
];

// --- Component ---

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [recovering, setRecovering] = useState<string | null>(null);
  const [filterState, dispatch] = useReducer(filterReducer, initialFilterState);

  async function fetchData() {
    const d = await getAdminData();
    setData(d);
    return d;
  }

  function updateOrder(id: string, patch: Partial<Order>) {
    setData((prev) =>
      prev
        ? { ...prev, orders: prev.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
        : prev
    );
  }

  async function handleRetry(orderId: string) {
    if (!window.confirm("Retry Printful submission for this order?")) return;
    setRetrying(orderId);
    try {
      await retryPrintfulSubmission(orderId);
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Retry failed: ${message}`);
    } finally {
      setRetrying(null);
    }
  }

  async function handleRecover(orderId: string) {
    if (
      !window.confirm(
        "Replay the Stripe webhook for this stuck pending order? This will charge through the full flow: paid → submitted → emails."
      )
    )
      return;
    setRecovering(orderId);
    try {
      const result = await recoverPendingOrder(orderId);
      if (result.ok) {
        alert(`Recovered: ${result.action}`);
        await fetchData();
      } else {
        alert(
          `Cannot recover: ${result.reason}\n\nIf the Stripe session was never paid, click Archive instead.`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Recover failed: ${message}`);
    } finally {
      setRecovering(null);
    }
  }

  async function handleArchive(orderId: string) {
    if (!window.confirm("Archive this order? It will be hidden from the customer.")) return;
    await archiveOrder(orderId);
    updateOrder(orderId, { archivedAt: new Date() });
  }

  async function handleUnarchive(orderId: string) {
    await unarchiveOrder(orderId);
    updateOrder(orderId, { archivedAt: null });
  }

  async function handleToggleTag(orderId: string, tag: string, currentTags: string[] | null) {
    const tags = currentTags ?? [];
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    await setOrderTags(orderId, next);
    updateOrder(orderId, { tags: next });
  }

  function handleAddTag(orderId: string, tag: string, currentTags: string[] | null) {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) return;
    const tags = currentTags ?? [];
    if (tags.includes(trimmed)) return;
    const next = [...tags, trimmed];
    setOrderTags(orderId, next);
    updateOrder(orderId, { tags: next });
  }

  async function handleClassificationChange(orderId: string, classification: OrderClassification) {
    await setOrderClassification(orderId, classification);
    updateOrder(orderId, { classification });
  }

  useEffect(() => {
    fetchData()
      .catch(() => setError("Unauthorized"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        {error ?? "Failed to load"}
      </div>
    );
  }

  // Derived state — recomputed every render
  const filtered = applyFilters(data.orders, filterState);
  const displayed = applySort(filtered, filterState);
  const summary = computeSummary(data.orders, data.ledger, filterState);
  const archivedCount = data.orders.filter((o) => o.archivedAt).length;
  const allSelected = filterState.classifications.size === ORDER_CLASSIFICATIONS.length;

  // Label for summary cards when filtered
  const activeLabels = allSelected
    ? []
    : ORDER_CLASSIFICATIONS.filter((c) => filterState.classifications.has(c)).map(
        (c) => CLASSIFICATION_INFO[c].label
      );
  const filterLabel = activeLabels.length > 0 ? activeLabels.join(" + ") : "";

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <h1 className="text-xl font-bold mb-6">Admin</h1>

      {/* Financial summary */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <Card className="p-4">
          <p className="text-xs text-text-muted uppercase">Orders</p>
          <p className="text-2xl font-bold mt-1">{summary.orderCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-muted uppercase">
            {filterLabel ? `${filterLabel} Revenue` : "Revenue"}
          </p>
          <p className="text-2xl font-bold mt-1">${summary.revenue.toFixed(2)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-muted uppercase">Stripe Fees</p>
          <p className="text-2xl font-bold mt-1 text-red-400">
            ${Math.abs(summary.stripeFees).toFixed(2)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-muted uppercase">COGS (Printful)</p>
          <p className="text-2xl font-bold mt-1">${summary.cogs.toFixed(2)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-muted uppercase">Gross Profit</p>
          <p className="text-2xl font-bold mt-1">${summary.grossProfit.toFixed(2)}</p>
        </Card>
      </div>

      {/* Orders heading + filters */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Orders</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => dispatch({ type: "SET_ALL_CLASSIFICATIONS" })}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                allSelected
                  ? "bg-surface-raised text-text-primary font-medium border border-border-default"
                  : "text-text-muted hover:text-text-primary border border-transparent"
              }`}
            >
              All
            </button>
            {ORDER_CLASSIFICATIONS.map((c) => (
              <button
                key={c}
                onClick={() => dispatch({ type: "TOGGLE_CLASSIFICATION", classification: c })}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                  filterState.classifications.has(c)
                    ? "bg-surface-raised text-text-primary font-medium border border-border-default"
                    : "text-text-muted hover:text-text-primary border border-transparent"
                }`}
              >
                {CLASSIFICATION_INFO[c].label}
              </button>
            ))}
          </div>
          {archivedCount > 0 && (
            <button
              onClick={() => dispatch({ type: "TOGGLE_ARCHIVED" })}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                filterState.showArchived
                  ? "bg-surface-raised text-text-primary font-medium border border-border-default"
                  : "text-text-muted hover:text-text-primary border border-transparent"
              }`}
            >
              Archived ({archivedCount})
            </button>
          )}
        </div>
      </div>

      {displayed.length === 0 ? (
        <p className="text-gray-500">No orders.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="border-b text-gray-500 text-xs uppercase">
              <tr>
                <th className="py-3 pr-4">Order</th>
                {["Status", "Customer", "Design", "Details", "Shipping", "Revenue", "COGS", "Profit", "Printful", "Date", ""].map(
                  (label) => {
                    const sortable = SORT_COLUMNS.find((s) => s.label === label);
                    if (!sortable) {
                      return (
                        <th key={label} className="py-3 pr-4">
                          {label}
                        </th>
                      );
                    }
                    const isActive = filterState.sortField === sortable.field;
                    return (
                      <th
                        key={label}
                        className="py-3 pr-4 cursor-pointer select-none hover:text-text-primary"
                        onClick={() => dispatch({ type: "SET_SORT", field: sortable.field })}
                      >
                        {label}
                        {isActive && (
                          <span className="ml-1">
                            {filterState.sortDirection === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </th>
                    );
                  }
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {displayed.map((order) => {
                const profit =
                  order.printfulCost != null
                    ? order.totalPrice - order.printfulCost
                    : null;
                return (
                  <tr
                    key={order.id}
                    className={`hover:bg-surface-raised ${order.archivedAt ? "opacity-50" : ""}`}
                  >
                    <td className="py-3 pr-4 font-mono text-xs">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="text-blue-400 hover:underline"
                      >
                        {order.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={order.status}>{order.status}</Badge>
                        {order.archivedAt && (
                          <span className="text-xs text-text-faint">archived</span>
                        )}
                        <select
                          className="text-[10px] px-1.5 py-0.5 rounded bg-surface-base border border-border-default text-text-primary cursor-pointer outline-none"
                          value={order.classification ?? ""}
                          onChange={(e) => {
                            if (e.target.value) {
                              handleClassificationChange(
                                order.id,
                                e.target.value as OrderClassification
                              );
                            }
                          }}
                        >
                          {!order.classification && <option value="">unclassified</option>}
                          {ORDER_CLASSIFICATIONS.map((c) => (
                            <option key={c} value={c}>
                              {CLASSIFICATION_INFO[c].label}
                            </option>
                          ))}
                        </select>
                        {(order.tags ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-muted cursor-pointer hover:line-through"
                            onClick={() => handleToggleTag(order.id, tag, order.tags)}
                            title={`Click to remove "${tag}" tag`}
                          >
                            {tag}
                          </span>
                        ))}
                        <input
                          type="text"
                          placeholder="+tag"
                          className="text-[10px] w-12 bg-transparent text-text-faint border-none outline-none placeholder:text-text-faint"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const input = e.currentTarget;
                              handleAddTag(order.id, input.value, order.tags);
                              input.value = "";
                            }
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-xs">{order.userEmail}</td>
                    <td className="py-3 pr-4">
                      {order.designImageUrl && (
                        <img
                          src={order.designImageUrl}
                          alt="Design"
                          className="w-10 h-10 rounded object-cover"
                        />
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {order.size} / {order.color}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {order.shippingName && (
                        <>
                          {order.shippingName}
                          <br />
                          <span className="text-gray-400">
                            {[order.shippingCity, order.shippingState]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-medium">
                      ${order.totalPrice.toFixed(2)}
                    </td>
                    <td className="py-3 pr-4 text-xs text-text-muted">
                      {order.printfulCost != null
                        ? `$${order.printfulCost.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 text-xs font-medium">
                      {profit != null ? (
                        <span className={profit >= 0 ? "text-green-400" : "text-red-400"}>
                          ${profit.toFixed(2)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-text-muted">
                      {order.printfulOrderId ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-xs text-gray-400 whitespace-nowrap">
                      {order.createdAt
                        ? new Date(order.createdAt).toLocaleString(undefined, {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td className="py-3 text-xs space-x-2">
                      {order.status === "pending" && order.stripeSessionId && (
                        <Button
                          size="sm"
                          onClick={() => handleRecover(order.id)}
                          disabled={recovering === order.id}
                        >
                          {recovering === order.id ? "Recovering..." : "Recover"}
                        </Button>
                      )}
                      {order.status === "paid" && (
                        <Button
                          size="sm"
                          onClick={() => handleRetry(order.id)}
                          disabled={retrying === order.id}
                        >
                          {retrying === order.id ? "Retrying..." : "Retry"}
                        </Button>
                      )}
                      {order.trackingUrl && (
                        <a
                          href={order.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 underline"
                        >
                          Track
                        </a>
                      )}
                      {order.archivedAt ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleUnarchive(order.id)}
                        >
                          Unarchive
                        </Button>
                      ) : order.status !== "shipped" &&
                        order.status !== "delivered" &&
                        !order.trackingNumber &&
                        !order.printfulOrderId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleArchive(order.id)}
                        >
                          Archive
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Classification reference */}
      <details className="mt-8">
        <summary className="text-sm text-text-muted cursor-pointer hover:text-text-primary">
          Classification Reference
        </summary>
        <div className="mt-3 space-y-4">
          <div className="space-y-2">
            {ORDER_CLASSIFICATIONS.map((c) => {
              const info = CLASSIFICATION_INFO[c];
              return (
                <div key={c} className="text-xs">
                  <span className="font-medium text-text-primary">{info.label}</span>
                  <span className="text-text-muted ml-2">{info.description}</span>
                  <span className="text-text-faint ml-2">— {info.accountingNote}</span>
                </div>
              );
            })}
          </div>
          <div>
            <p className="text-xs text-text-faint mb-1">Planned (not yet in use):</p>
            {FUTURE_CLASSIFICATIONS.map((c) => (
              <span
                key={c}
                className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-faint mr-1 mb-1"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
