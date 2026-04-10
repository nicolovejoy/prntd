"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getOrderDetail,
  retryPrintfulSubmission,
  recoverPendingOrder,
  archiveOrder,
  unarchiveOrder,
  setOrderClassification,
  setOrderTags,
} from "../../actions";
import { Badge, Button, Card } from "@/components/ui";
import {
  ORDER_CLASSIFICATIONS,
  CLASSIFICATION_INFO,
  type OrderClassification,
} from "@/lib/order-classification";

type OrderDetail = Awaited<ReturnType<typeof getOrderDetail>>;

const LEDGER_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  sale: { label: "Sale", color: "text-green-400" },
  stripe_fee: { label: "Stripe Fee", color: "text-red-400" },
  cogs: { label: "COGS", color: "text-red-400" },
  refund: { label: "Refund", color: "text-red-400" },
  refund_cogs_reversal: { label: "COGS Reversal", color: "text-green-400" },
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [recovering, setRecovering] = useState(false);

  async function fetchOrder() {
    const o = await getOrderDetail(params.id);
    setOrder(o);
    return o;
  }

  async function handleRetry() {
    if (!window.confirm("Retry Printful submission for this order?")) return;
    setRetrying(true);
    try {
      await retryPrintfulSubmission(params.id);
      await fetchOrder();
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    } finally {
      setRetrying(false);
    }
  }

  async function handleRecover() {
    if (
      !window.confirm(
        "Replay the Stripe webhook for this stuck pending order? This will run pending → paid → submitted and send emails."
      )
    )
      return;
    setRecovering(true);
    try {
      const result = await recoverPendingOrder(params.id);
      if (result.ok) {
        alert(`Recovered: ${result.action}`);
        await fetchOrder();
      } else {
        alert(
          `Cannot recover: ${result.reason}\n\nIf the Stripe session was never paid, click Archive instead.`
        );
      }
    } catch (err: any) {
      alert(`Recover failed: ${err.message}`);
    } finally {
      setRecovering(false);
    }
  }

  async function handleArchive() {
    if (!window.confirm("Archive this order?")) return;
    await archiveOrder(params.id);
    setOrder((prev) => (prev ? { ...prev, archivedAt: new Date() } : prev));
  }

  async function handleUnarchive() {
    await unarchiveOrder(params.id);
    setOrder((prev) => (prev ? { ...prev, archivedAt: null } : prev));
  }

  async function handleClassification(classification: OrderClassification) {
    await setOrderClassification(params.id, classification);
    setOrder((prev) => (prev ? { ...prev, classification } : prev));
  }

  async function handleToggleTag(tag: string) {
    if (!order) return;
    const tags = order.tags ?? [];
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    await setOrderTags(params.id, next);
    setOrder((prev) => (prev ? { ...prev, tags: next } : prev));
  }

  function handleAddTag(tag: string) {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed || !order) return;
    const tags = order.tags ?? [];
    if (tags.includes(trimmed)) return;
    const next = [...tags, trimmed];
    setOrderTags(params.id, next);
    setOrder((prev) => (prev ? { ...prev, tags: next } : prev));
  }

  useEffect(() => {
    fetchOrder()
      .catch(() => setError("Order not found or unauthorized"))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        {error ?? "Order not found"}
      </div>
    );
  }

  const profit =
    order.printfulCost != null ? order.totalPrice - order.printfulCost : null;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Back link */}
      <Link href="/admin" className="text-sm text-text-muted hover:text-text-primary mb-4 inline-block">
        &larr; Back to Orders
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-xl font-bold font-mono">{order.id.slice(0, 8)}</h1>
        <Badge variant={order.status as any}>{order.status}</Badge>
        {order.classification && (
          <span className="text-xs px-2 py-0.5 rounded bg-surface-raised text-text-muted">
            {CLASSIFICATION_INFO[order.classification as OrderClassification]?.label ?? order.classification}
          </span>
        )}
        {order.archivedAt && (
          <span className="text-xs text-text-faint">archived</span>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          {/* Customer */}
          <Card className="p-4">
            <h3 className="text-xs text-text-muted uppercase mb-2">Customer</h3>
            <p className="text-sm">{order.userEmail}</p>
            {order.shippingName && (
              <div className="mt-2 text-xs text-text-muted">
                <p>{order.shippingName}</p>
                <p>{order.shippingAddress1}</p>
                {order.shippingAddress2 && <p>{order.shippingAddress2}</p>}
                <p>
                  {[order.shippingCity, order.shippingState, order.shippingZip]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p>{order.shippingCountry}</p>
              </div>
            )}
          </Card>

          {/* Product */}
          <Card className="p-4">
            <h3 className="text-xs text-text-muted uppercase mb-2">Product</h3>
            <div className="flex gap-3">
              {order.designImageUrl && (
                <img
                  src={order.designImageUrl}
                  alt="Design"
                  className="w-20 h-20 rounded object-cover"
                />
              )}
              <div className="text-sm">
                <p>
                  {order.size} / {order.color}
                </p>
                {order.printfulOrderId && (
                  <p className="text-xs text-text-faint mt-1">
                    Printful: {order.printfulOrderId}
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* Financials */}
          <Card className="p-4">
            <h3 className="text-xs text-text-muted uppercase mb-2">Financials</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Revenue</span>
                <span>${order.totalPrice.toFixed(2)}</span>
              </div>
              {order.printfulCost != null && (
                <div className="flex justify-between">
                  <span className="text-text-muted">COGS</span>
                  <span className="text-red-400">-${order.printfulCost.toFixed(2)}</span>
                </div>
              )}
              {profit != null && (
                <div className="flex justify-between border-t border-border-default pt-1 mt-1">
                  <span className="text-text-muted">Profit</span>
                  <span className={profit >= 0 ? "text-green-400" : "text-red-400"}>
                    ${profit.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </Card>

          {/* Classification + Tags */}
          <Card className="p-4">
            <h3 className="text-xs text-text-muted uppercase mb-2">Classification & Tags</h3>
            <div className="space-y-2">
              <select
                className="text-xs px-2 py-1 rounded bg-surface-base border border-border-default text-text-primary cursor-pointer outline-none"
                value={order.classification ?? ""}
                onChange={(e) => {
                  if (e.target.value) handleClassification(e.target.value as OrderClassification);
                }}
              >
                {!order.classification && <option value="">unclassified</option>}
                {ORDER_CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {CLASSIFICATION_INFO[c].label}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap items-center gap-1">
                {(order.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-muted cursor-pointer hover:line-through"
                    onClick={() => handleToggleTag(tag)}
                    title={`Click to remove "${tag}"`}
                  >
                    {tag}
                  </span>
                ))}
                <input
                  type="text"
                  placeholder="+tag"
                  className="text-[10px] w-16 bg-transparent text-text-faint border-none outline-none placeholder:text-text-faint"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const input = e.currentTarget;
                      handleAddTag(input.value);
                      input.value = "";
                    }
                  }}
                />
              </div>
            </div>
          </Card>

          {/* Actions */}
          <div className="flex gap-2">
            {order.status === "pending" && order.stripeSessionId && (
              <Button size="sm" onClick={handleRecover} disabled={recovering}>
                {recovering ? "Recovering..." : "Recover (replay webhook)"}
              </Button>
            )}
            {order.status === "paid" && (
              <Button size="sm" onClick={handleRetry} disabled={retrying}>
                {retrying ? "Retrying..." : "Retry Printful"}
              </Button>
            )}
            {order.trackingUrl && (
              <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="secondary">
                  Track Shipment
                </Button>
              </a>
            )}
            {order.archivedAt ? (
              <Button size="sm" variant="ghost" onClick={handleUnarchive}>
                Unarchive
              </Button>
            ) : !order.printfulOrderId ? (
              <Button size="sm" variant="ghost" onClick={handleArchive}>
                Archive
              </Button>
            ) : null}
          </div>
        </div>

        {/* Right column — Ledger timeline */}
        <div>
          <Card className="p-4">
            <h3 className="text-xs text-text-muted uppercase mb-3">Ledger</h3>
            {order.ledger.length === 0 ? (
              <p className="text-xs text-text-faint">No ledger entries (pre-April 2026 order)</p>
            ) : (
              <div className="space-y-3">
                {order.ledger.map((entry) => {
                  const typeInfo = LEDGER_TYPE_LABELS[entry.type] ?? {
                    label: entry.type,
                    color: "text-text-muted",
                  };
                  return (
                    <div key={entry.id} className="flex items-start gap-3 text-xs">
                      <div className="w-2 h-2 rounded-full bg-border-default mt-1 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text-primary">{typeInfo.label}</span>
                          <span className={`font-mono ${typeInfo.color}`}>
                            {entry.amount >= 0 ? "+" : ""}${entry.amount.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-text-faint truncate">{entry.description}</p>
                        <p className="text-text-faint">
                          {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* References */}
          {(order.stripeSessionId || order.stripePaymentIntentId) && (
            <Card className="p-4 mt-4">
              <h3 className="text-xs text-text-muted uppercase mb-2">References</h3>
              <div className="text-xs text-text-faint space-y-1 font-mono break-all">
                {order.stripeSessionId && <p>Stripe Session: {order.stripeSessionId}</p>}
                {order.stripePaymentIntentId && <p>Payment Intent: {order.stripePaymentIntentId}</p>}
                {order.printfulOrderId && <p>Printful: {order.printfulOrderId}</p>}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
