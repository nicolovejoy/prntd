"use client";

import { useEffect, useState } from "react";
import {
  getOrders,
  retryPrintfulSubmission,
  archiveOrder,
  unarchiveOrder,
  getFinancialSummary,
} from "./actions";
import { Badge, Button, Card } from "@/components/ui";

type Order = Awaited<ReturnType<typeof getOrders>>[number];
type Summary = Awaited<ReturnType<typeof getFinancialSummary>>;

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  async function refresh() {
    const [o, s] = await Promise.all([getOrders(), getFinancialSummary()]);
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

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <h1 className="text-xl font-bold mb-6">Admin</h1>

      {/* Financial summary */}
      {summary && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card className="p-4">
            <p className="text-xs text-text-muted uppercase">Orders</p>
            <p className="text-2xl font-bold mt-1">{summary.orderCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-text-muted uppercase">Revenue</p>
            <p className="text-2xl font-bold mt-1">${summary.revenue.toFixed(2)}</p>
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

      {/* Filter toggle */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Orders</h2>
        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="text-xs text-text-muted underline"
          >
            {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
          </button>
        )}
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
                      <Badge variant={order.status as any}>
                        {order.status}
                      </Badge>
                      {order.archivedAt && (
                        <span className="text-xs text-text-faint ml-1">archived</span>
                      )}
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
    </div>
  );
}
