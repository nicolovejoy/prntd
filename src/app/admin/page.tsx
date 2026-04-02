"use client";

import { useEffect, useState } from "react";
import {
  getOrders,
  retryPrintfulSubmission,
  archiveOrder,
  unarchiveOrder,
  getFinancialSummary,
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

type Order = Awaited<ReturnType<typeof getOrders>>[number];
type Summary = Awaited<ReturnType<typeof getFinancialSummary>>;

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [classificationFilter, setClassificationFilter] = useState<
    OrderClassification | "all"
  >("all");

  async function refresh(filter?: OrderClassification | "all") {
    const f = filter ?? classificationFilter;
    const [o, s] = await Promise.all([
      getOrders(),
      getFinancialSummary(f),
    ]);
    setOrders(o);
    setSummary(s);
  }

  async function handleRetry(orderId: string) {
    if (!window.confirm("Retry Printful submission for this order?")) return;
    setRetrying(orderId);
    try {
      await retryPrintfulSubmission(orderId);
      await refresh();
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    } finally {
      setRetrying(null);
    }
  }

  async function handleArchive(orderId: string) {
    if (!window.confirm("Archive this order? It will be hidden from the customer.")) return;
    await archiveOrder(orderId);
    await refresh();
  }

  async function handleUnarchive(orderId: string) {
    await unarchiveOrder(orderId);
    await refresh();
  }

  async function handleToggleTag(orderId: string, tag: string, currentTags: string[] | null) {
    const tags = currentTags ?? [];
    const next = tags.includes(tag)
      ? tags.filter((t) => t !== tag)
      : [...tags, tag];
    await setOrderTags(orderId, next);
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, tags: next } : o))
    );
  }

  async function handleClassificationChange(orderId: string, classification: OrderClassification) {
    await setOrderClassification(orderId, classification);
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, classification } : o))
    );
    // Re-fetch summary since classification affects financial totals
    const s = await getFinancialSummary(classificationFilter);
    setSummary(s);
  }

  async function handleFilterChange(filter: OrderClassification | "all") {
    setClassificationFilter(filter);
    const s = await getFinancialSummary(filter);
    setSummary(s);
  }

  function handleAddTag(orderId: string, tag: string, currentTags: string[] | null) {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) return;
    const tags = currentTags ?? [];
    if (tags.includes(trimmed)) return;
    const next = [...tags, trimmed];
    setOrderTags(orderId, next);
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, tags: next } : o))
    );
  }

  useEffect(() => {
    refresh()
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

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        {error}
      </div>
    );
  }

  const filtered = showArchived
    ? orders
    : orders.filter((o) => !o.archivedAt);

  const archivedCount = orders.filter((o) => o.archivedAt).length;

  const filterLabel =
    classificationFilter === "all"
      ? ""
      : CLASSIFICATION_INFO[classificationFilter].label;

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <h1 className="text-xl font-bold mb-6">Admin</h1>

      {/* Financial summary */}
      {summary && (
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
            <p className="text-2xl font-bold mt-1 text-red-400">${Math.abs(summary.stripeFees).toFixed(2)}</p>
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
      )}

      {/* Orders heading + filters */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Orders</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {(["all", ...ORDER_CLASSIFICATIONS] as const).map((value) => (
              <button
                key={value}
                onClick={() => handleFilterChange(value)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                  classificationFilter === value
                    ? "bg-surface-raised text-text-primary font-medium"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {value === "all" ? "All" : CLASSIFICATION_INFO[value].label}
              </button>
            ))}
          </div>
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                showArchived
                  ? "bg-surface-raised text-text-primary font-medium"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              Archived ({archivedCount})
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-500">No orders.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="border-b text-gray-500 text-xs uppercase">
              <tr>
                <th className="py-3 pr-4">Order</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Customer</th>
                <th className="py-3 pr-4">Design</th>
                <th className="py-3 pr-4">Details</th>
                <th className="py-3 pr-4">Shipping</th>
                <th className="py-3 pr-4">Revenue</th>
                <th className="py-3 pr-4">COGS</th>
                <th className="py-3 pr-4">Profit</th>
                <th className="py-3 pr-4">Printful</th>
                <th className="py-3 pr-4">Date</th>
                <th className="py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((order) => {
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
                      {order.id.slice(0, 8)}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={order.status as any}>
                          {order.status}
                        </Badge>
                        {order.archivedAt && (
                          <span className="text-xs text-text-faint">archived</span>
                        )}
                        {/* Classification selector */}
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
                          {!order.classification && (
                            <option value="">unclassified</option>
                          )}
                          {ORDER_CLASSIFICATIONS.map((c) => (
                            <option key={c} value={c}>
                              {CLASSIFICATION_INFO[c].label}
                            </option>
                          ))}
                        </select>
                        {/* Tags */}
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
                        {/* Freeform tag input */}
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
                      <br />
                      <span className="text-gray-400">{order.quality}</span>
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
                    <td className="py-3 pr-4 text-xs text-gray-400">
                      {order.createdAt
                        ? new Date(order.createdAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="py-3 text-xs space-x-2">
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
                      ) : order.status !== "shipped" && order.status !== "delivered" && !order.trackingNumber && !order.printfulOrderId ? (
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
