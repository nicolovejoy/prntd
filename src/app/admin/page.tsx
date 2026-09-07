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
import { Badge, Button, InlineNotice, useConfirm, type InlineNoticeTone } from "@/components/ui";
import { getColorHex } from "@/lib/blanks";
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
import {
  ADMIN_RECOVER_ARCHIVE_HINT,
  ADMIN_RECOVER_FAILED,
  ADMIN_RETRY_FAILED,
  adminCannotRecover,
  adminRecovered,
} from "@/lib/action-copy";

type AdminData = Awaited<ReturnType<typeof getAdminData>>;
type Order = AdminData["orders"][number];

// --- Sortable header helper ---

const SORT_COLUMNS: { field: SortField; label: string }[] = [
  { field: "userEmail", label: "Customer" },
  { field: "totalPrice", label: "Revenue" },
  { field: "status", label: "Status" },
  { field: "createdAt", label: "Date" },
];

// Filters are underlined text, not chips: the selected one inks and
// underlines, the rest sit muted. min-h-11 keeps the phone tap target.
const filterOn = "text-xs px-2 min-h-11 text-foreground underline underline-offset-[3px]";
const filterOff = "text-xs px-2 min-h-11 text-text-muted hover:text-foreground";

// --- Component ---

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [recovering, setRecovering] = useState<string | null>(null);
  // One result line at a time, keyed to the row whose button was pressed —
  // admin acts on one order and then reads what happened to it.
  const [actionResult, setActionResult] = useState<{
    orderId: string;
    tone: InlineNoticeTone;
    message: string;
    hint?: string;
  } | null>(null);
  const [filterState, dispatch] = useReducer(filterReducer, initialFilterState);
  const { confirm, element: confirmSheet } = useConfirm();

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
    const ok = await confirm({
      title: "Retry Printful submission for this order?",
      confirmLabel: "Retry",
    });
    if (!ok) return;
    setRetrying(orderId);
    setActionResult(null);
    try {
      await retryPrintfulSubmission(orderId);
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionResult({ orderId, tone: "negative", message: ADMIN_RETRY_FAILED, hint: message });
    } finally {
      setRetrying(null);
    }
  }

  async function handleRecover(orderId: string) {
    const ok = await confirm({
      title: "Replay the Stripe webhook for this stuck pending order?",
      body: "This will charge through the full flow: paid → submitted → emails.",
      confirmLabel: "Recover",
      danger: true,
    });
    if (!ok) return;
    setRecovering(orderId);
    setActionResult(null);
    try {
      const result = await recoverPendingOrder(orderId);
      if (result.ok) {
        setActionResult({ orderId, tone: "neutral", message: adminRecovered(result.action) });
        await fetchData();
      } else {
        setActionResult({
          orderId,
          tone: "negative",
          message: adminCannotRecover(result.reason),
          hint: ADMIN_RECOVER_ARCHIVE_HINT,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionResult({ orderId, tone: "negative", message: ADMIN_RECOVER_FAILED, hint: message });
    } finally {
      setRecovering(null);
    }
  }

  async function handleArchive(orderId: string) {
    const ok = await confirm({
      title: "Archive this order?",
      body: "It will be hidden from the customer.",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    setActionResult(null);
    await archiveOrder(orderId);
    updateOrder(orderId, { archivedAt: new Date() });
  }

  async function handleUnarchive(orderId: string) {
    setActionResult(null);
    await unarchiveOrder(orderId);
    updateOrder(orderId, { archivedAt: null });
  }

  async function handleToggleTag(orderId: string, tag: string, currentTags: string[] | null) {
    setActionResult(null);
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
    // Clear the previous result line: this is a new interaction, and a stale
    // Retry/Recover failure sitting next to a freshly added tag reads as a
    // failure of the tag add.
    setActionResult(null);
    const next = [...tags, trimmed];
    setOrderTags(orderId, next);
    updateOrder(orderId, { tags: next });
  }

  async function handleClassificationChange(orderId: string, classification: OrderClassification) {
    setActionResult(null);
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
      <div className="min-h-screen flex items-center justify-center text-text-faint">
        Loading...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-faint">
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
      {confirmSheet}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Admin</h1>
        <div className="flex items-center gap-4">
          <Link href="/admin/errors" className="text-sm underline underline-offset-[3px] hover:no-underline">
            Errors →
          </Link>
          <Link href="/admin/published" className="text-sm underline underline-offset-[3px] hover:no-underline">
            Published images →
          </Link>
        </div>
      </div>

      {/* Financial summary — a ruled block of figures, not five panels.
          Colour only where a figure is already signed money-out (fees). */}
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border-t border-border mb-8">
        {[
          { label: "Orders", value: String(summary.orderCount) },
          {
            label: filterLabel ? `${filterLabel} Revenue` : "Revenue",
            value: `$${summary.revenue.toFixed(2)}`,
          },
          {
            label: "Stripe Fees",
            value: `$${Math.abs(summary.stripeFees).toFixed(2)}`,
            tone: "text-negative",
          },
          { label: "COGS (Printful)", value: `$${summary.cogs.toFixed(2)}` },
          { label: "Gross Profit", value: `$${summary.grossProfit.toFixed(2)}` },
        ].map((f) => (
          <div key={f.label} className="border-b border-border py-3 pr-4">
            <dt className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
              {f.label}
            </dt>
            <dd className={`mt-1 text-sm font-mono ${f.tone ?? "text-foreground"}`}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Orders heading + filters */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Orders</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => dispatch({ type: "SET_ALL_CLASSIFICATIONS" })}
              className={allSelected ? filterOn : filterOff}
            >
              All
            </button>
            {ORDER_CLASSIFICATIONS.map((c) => (
              <button
                key={c}
                onClick={() => dispatch({ type: "TOGGLE_CLASSIFICATION", classification: c })}
                className={filterState.classifications.has(c) ? filterOn : filterOff}
              >
                {CLASSIFICATION_INFO[c].label}
              </button>
            ))}
          </div>
          {archivedCount > 0 && (
            <button
              onClick={() => dispatch({ type: "TOGGLE_ARCHIVED" })}
              className={filterState.showArchived ? filterOn : filterOff}
            >
              Archived ({archivedCount})
            </button>
          )}
        </div>
      </div>

      {displayed.length === 0 ? (
        <p className="text-sm text-text-muted">No orders.</p>
      ) : (
        <div className="overflow-x-auto">
          {/* data-loop-redact: rows carry customer names/locations — keep out of feedback page captures */}
          <table className="w-full text-sm text-left" data-loop-redact="">
            <thead className="border-b border-border text-text-muted">
              <tr>
                <th className="py-3 pr-4 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase font-normal">Order</th>
                {["Status", "Customer", "Design", "Details", "Shipping", "Revenue", "COGS", "Profit", "Printful", "Date", ""].map(
                  (label) => {
                    const sortable = SORT_COLUMNS.find((s) => s.label === label);
                    if (!sortable) {
                      return (
                        <th key={label} className="py-3 pr-4 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase font-normal">
                          {label}
                        </th>
                      );
                    }
                    const isActive = filterState.sortField === sortable.field;
                    return (
                      <th
                        key={label}
                        className="py-3 pr-4 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase font-normal cursor-pointer select-none hover:text-foreground"
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
            <tbody className="divide-y divide-border">
              {displayed.map((order) => {
                const profit =
                  order.printfulCost != null
                    ? order.totalPrice - order.printfulCost
                    : null;
                const firstLine = order.lines[0];
                return (
                  <tr
                    key={order.id}
                    className={`hover:bg-surface-raised ${order.archivedAt ? "opacity-50" : ""}`}
                  >
                    <td className="py-3 pr-4 text-xs">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="text-foreground underline underline-offset-[3px] hover:text-text-muted"
                      >
                        {order.displayName ?? <span className="font-mono">{order.id.slice(0, 8)}</span>}
                      </Link>
                      {order.displayName && (
                        <div className="font-mono text-text-muted text-[10px] mt-0.5">{order.id.slice(0, 8)}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={order.status}>{order.status}</Badge>
                        {order.archivedAt && (
                          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">archived</span>
                        )}
                        <select
                          className="font-mono text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-surface border border-border hover:border-border-hover focus:border-border-hover text-foreground cursor-pointer outline-none"
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
                            className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted cursor-pointer hover:line-through"
                            onClick={() => handleToggleTag(order.id, tag, order.tags)}
                            title={`Click to remove "${tag}" tag`}
                          >
                            {tag}
                          </span>
                        ))}
                        <input
                          type="text"
                          placeholder="+tag"
                          className="font-mono text-[10px] w-12 bg-transparent text-foreground border-b border-border focus:border-foreground outline-none placeholder:text-text-muted"
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
                        <div
                          className="w-10 h-10 rounded p-1 overflow-hidden"
                          style={{
                            backgroundColor: firstLine
                              ? getColorHex(firstLine.blankId, firstLine.color)
                              : undefined,
                          }}
                        >
                          <img
                            src={order.designImageUrl}
                            alt="Design"
                            className="w-full h-full object-contain"
                          />
                        </div>
                      )}
                      {order.lines.length > 1 && (
                        <span
                          className="mt-1 inline-block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
                          title={`${order.lines.length} items — open the order to see each design`}
                        >
                          ×{order.lines.length} items
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {firstLine ? `${firstLine.size} / ${firstLine.color}` : "—"}
                      {order.lines.length > 1 && (
                        <span className="text-text-faint">
                          {" "}
                          +{order.lines.length - 1} more
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {order.shippingName && (
                        <>
                          {order.shippingName}
                          <br />
                          <span className="text-text-muted">
                            {[order.shippingCity, order.shippingState]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono">
                      ${order.totalPrice.toFixed(2)}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-text-muted">
                      {order.printfulCost != null
                        ? `$${order.printfulCost.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 text-xs font-mono">
                      {profit != null ? (
                        <span className={profit >= 0 ? "text-positive" : "text-negative"}>
                          ${profit.toFixed(2)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-text-muted">
                      {order.printfulOrderId ?? "—"}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-text-muted whitespace-nowrap">
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
                          className="text-foreground underline underline-offset-[3px] hover:text-text-muted"
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
                      {actionResult?.orderId === order.id && (
                        <InlineNotice
                          testId="admin-action-result"
                          tone={actionResult.tone}
                          message={actionResult.message}
                          hint={actionResult.hint}
                        />
                      )}
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
        <summary className="text-sm text-text-muted underline underline-offset-[3px] cursor-pointer hover:text-foreground">
          Classification Reference
        </summary>
        <div className="mt-3 space-y-4">
          <div className="space-y-2">
            {ORDER_CLASSIFICATIONS.map((c) => {
              const info = CLASSIFICATION_INFO[c];
              return (
                <div key={c} className="text-xs">
                  <span className="font-medium text-foreground">{info.label}</span>
                  <span className="text-text-muted ml-2">{info.description}</span>
                  <span className="text-text-faint ml-2">— {info.accountingNote}</span>
                </div>
              );
            })}
          </div>
          <div>
            <p className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted mb-1">Planned (not yet in use):</p>
            {FUTURE_CLASSIFICATIONS.map((c) => (
              <span
                key={c}
                className="inline-block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted mr-1 mb-1"
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
