"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import {
  getOrderDetail,
  retryPrintfulSubmission,
  recoverPendingOrder,
  refundOrder,
  archiveOrder,
  unarchiveOrder,
  setOrderClassification,
  setOrderTags,
} from "../../actions";
import { Badge, Button, Card, InlineNotice, useConfirm, type InlineNoticeTone } from "@/components/ui";
import { getBlank, getColorHex } from "@/lib/blanks";
import {
  ORDER_CLASSIFICATIONS,
  CLASSIFICATION_INFO,
  type OrderClassification,
} from "@/lib/order-classification";
import {
  ADMIN_ALREADY_REFUNDED,
  ADMIN_RECOVER_ARCHIVE_HINT,
  ADMIN_RECOVER_FAILED,
  ADMIN_REFUND_FAILED,
  ADMIN_REFUND_ISSUED,
  ADMIN_RETRY_FAILED,
  adminCannotRecover,
  adminCannotRefund,
  adminRecovered,
} from "@/lib/action-copy";

type OrderDetail = Awaited<ReturnType<typeof getOrderDetail>>;

const LEDGER_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  sale: { label: "Sale", color: "text-positive" },
  stripe_fee: { label: "Stripe Fee", color: "text-negative" },
  cogs: { label: "COGS", color: "text-negative" },
  refund: { label: "Refund", color: "text-negative" },
  refund_cogs_reversal: { label: "COGS Reversal", color: "text-positive" },
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [actionResult, setActionResult] = useState<{
    tone: InlineNoticeTone;
    message: string;
    hint?: string;
  } | null>(null);
  const { confirm, element: confirmSheet } = useConfirm();

  async function fetchOrder() {
    const o = await getOrderDetail(params.id);
    setOrder(o);
    return o;
  }

  async function handleRetry() {
    const ok = await confirm({
      title: "Retry Printful submission for this order?",
      confirmLabel: "Retry",
    });
    if (!ok) return;
    setRetrying(true);
    setActionResult(null);
    try {
      await retryPrintfulSubmission(params.id);
      await fetchOrder();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionResult({ tone: "negative", message: ADMIN_RETRY_FAILED, hint: message });
    } finally {
      setRetrying(false);
    }
  }

  async function handleRecover() {
    const ok = await confirm({
      title: "Replay the Stripe webhook for this stuck pending order?",
      body: "This will run pending → paid → submitted and send emails.",
      confirmLabel: "Recover",
      danger: true,
    });
    if (!ok) return;
    setRecovering(true);
    setActionResult(null);
    try {
      const result = await recoverPendingOrder(params.id);
      if (result.ok) {
        setActionResult({ tone: "neutral", message: adminRecovered(result.action) });
        await fetchOrder();
      } else {
        setActionResult({
          tone: "negative",
          message: adminCannotRecover(result.reason),
          hint: ADMIN_RECOVER_ARCHIVE_HINT,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionResult({ tone: "negative", message: ADMIN_RECOVER_FAILED, hint: message });
    } finally {
      setRecovering(false);
    }
  }

  async function handleRefund() {
    const ok = await confirm({
      title: "Refund this customer via Stripe?",
      body: "This issues a real refund and cannot be undone.",
      confirmLabel: "Refund",
      danger: true,
    });
    if (!ok) return;
    setRefunding(true);
    setActionResult(null);
    try {
      const result = await refundOrder(params.id);
      if (result.ok) {
        setActionResult({
          tone: "neutral",
          message: result.refunded ? ADMIN_REFUND_ISSUED : ADMIN_ALREADY_REFUNDED,
        });
        await fetchOrder();
      } else {
        setActionResult({ tone: "negative", message: adminCannotRefund(result.reason) });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionResult({ tone: "negative", message: ADMIN_REFUND_FAILED, hint: message });
    } finally {
      setRefunding(false);
    }
  }

  async function handleArchive() {
    const ok = await confirm({
      title: "Archive this order?",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    setActionResult(null);
    await archiveOrder(params.id);
    setOrder((prev) => (prev ? { ...prev, archivedAt: new Date() } : prev));
  }

  async function handleUnarchive() {
    setActionResult(null);
    await unarchiveOrder(params.id);
    setOrder((prev) => (prev ? { ...prev, archivedAt: null } : prev));
  }

  async function handleClassification(classification: OrderClassification) {
    setActionResult(null);
    await setOrderClassification(params.id, classification);
    setOrder((prev) => (prev ? { ...prev, classification } : prev));
  }

  async function handleToggleTag(tag: string) {
    if (!order) return;
    setActionResult(null);
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
    // New interaction: drop the previous result line so a stale
    // Retry/Recover/Refund failure isn't read as a failure of the tag add.
    setActionResult(null);
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
      <div className="min-h-screen flex items-center justify-center text-text-faint">
        Loading...
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-faint">
        {error ?? "Order not found"}
      </div>
    );
  }

  const profit =
    order.printfulCost != null ? order.totalPrice - order.printfulCost : null;
  const hasRefund = order.ledger.some((e) => e.type === "refund");

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {confirmSheet}
      <Breadcrumbs
        trail={breadcrumbTrail(`/admin/orders/${params.id}`)}
        current={`Order ${params.id.slice(0, 8)}`}
        className="mb-4"
      />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h1 className="text-xl font-bold">{order.displayName ?? order.id.slice(0, 8)}</h1>
        {order.displayName && (
          <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">{order.id.slice(0, 8)}</span>
        )}
        <Badge variant={order.status}>{order.status}</Badge>
        {order.classification && (
          <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
            {CLASSIFICATION_INFO[order.classification as OrderClassification]?.label ?? order.classification}
          </span>
        )}
        {order.archivedAt && (
          <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">archived</span>
        )}
        <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted ml-auto">
          {order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          {/* Customer — data-loop-redact keeps this PII out of feedback page captures */}
          <Card className="p-4" data-loop-redact="">
            <h3 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted mb-2">Customer</h3>
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

          {/* Product — every purchased line (cart orders have several) */}
          <Card className="p-4">
            <h3 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted mb-2">
              {order.lines.length > 1 ? `Products (${order.lines.length})` : "Product"}
            </h3>
            <div className="space-y-3">
              {order.lines.map((line, i) => {
                const extras = Object.keys(line.placements).filter(
                  (p) => p !== "front"
                );
                const thumb = line.imageUrl ?? order.designImageUrl;
                return (
                  <div key={i} className="flex gap-3">
                    {thumb && (
                      <div
                        className="w-16 h-16 rounded p-1.5 overflow-hidden flex-shrink-0"
                        style={{
                          backgroundColor: getColorHex(line.blankId, line.color),
                        }}
                      >
                        <img
                          src={thumb}
                          alt={line.title || "Design"}
                          className="w-full h-full object-contain"
                        />
                      </div>
                    )}
                    <div className="text-sm min-w-0">
                      {line.title && <p className="font-medium">{line.title}</p>}
                      <p>
                        {getBlank(line.blankId)?.name ?? line.blankId} —{" "}
                        {line.size} / {line.color}
                        {line.quantity > 1 && ` ×${line.quantity}`}
                        {extras.length > 0 && (
                          <span className="text-xs text-text-muted">
                            {" "}
                            (+{extras.join(", ")})
                          </span>
                        )}
                      </p>
                      {line.designedByName && (
                        <p className="text-xs text-text-muted mt-0.5">
                          Designed by {line.designedByName}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {order.printfulOrderId && (
                <p className="font-mono text-xs text-text-muted">
                  Printful: {order.printfulOrderId}
                </p>
              )}
            </div>
          </Card>

          {/* Financials */}
          <Card className="p-4">
            <h3 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted mb-2">Financials</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Revenue</span>
                <span className="font-mono">${order.totalPrice.toFixed(2)}</span>
              </div>
              {order.printfulCost != null && (
                <div className="flex justify-between">
                  <span className="text-text-muted">COGS</span>
                  <span className="font-mono text-negative">-${order.printfulCost.toFixed(2)}</span>
                </div>
              )}
              {profit != null && (
                <div className="flex justify-between border-t border-border pt-1 mt-1">
                  <span className="text-text-muted">Profit</span>
                  <span className={`font-mono ${profit >= 0 ? "text-positive" : "text-negative"}`}>
                    ${profit.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </Card>

          {/* Classification + Tags */}
          <Card className="p-4">
            <h3 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted mb-2">Classification & Tags</h3>
            <div className="space-y-2">
              <select
                className="text-sm min-h-11 px-2 rounded bg-surface border border-foreground text-foreground cursor-pointer outline-none focus:ring-1 focus:ring-foreground"
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
                    className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted cursor-pointer hover:line-through"
                    onClick={() => handleToggleTag(tag)}
                    title={`Click to remove "${tag}"`}
                  >
                    {tag} <span aria-hidden>×</span>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder="+tag"
                  className="font-mono text-[10px] w-16 bg-transparent text-foreground border-b border-border focus:border-foreground outline-none placeholder:text-text-muted"
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
            {order.status === "pending" && order.abandonedAt ? (
              <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                Abandoned
              </span>
            ) : (
              order.status === "pending" &&
              order.stripeSessionId && (
                <Button size="sm" onClick={handleRecover} disabled={recovering}>
                  {recovering ? "Recovering..." : "Recover (replay webhook)"}
                </Button>
              )
            )}
            {order.status === "paid" && (
              <Button size="sm" onClick={handleRetry} disabled={retrying}>
                {retrying ? "Retrying..." : "Retry Printful"}
              </Button>
            )}
            {order.status === "canceled" &&
              order.totalPrice > 0 &&
              order.classification !== "test" &&
              (hasRefund ? (
                <span className="font-mono text-xs text-text-muted self-center">
                  Refunded ${order.totalPrice.toFixed(2)}
                </span>
              ) : (
                <Button size="sm" onClick={handleRefund} disabled={refunding}>
                  {refunding ? "Refunding..." : `Refund $${order.totalPrice.toFixed(2)}`}
                </Button>
              ))}
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
          {actionResult && (
            <InlineNotice
              testId="admin-action-result"
              tone={actionResult.tone}
              message={actionResult.message}
              hint={actionResult.hint}
            />
          )}
        </div>

        {/* Right column — Ledger rows */}
        <div>
          <Card className="p-4">
            <h3 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted mb-3">Ledger</h3>
            {order.ledger.length === 0 ? (
              <p className="text-sm text-text-muted">No ledger entries (pre-April 2026 order)</p>
            ) : (
              <div className="divide-y divide-border border-t border-border">
                {order.ledger.map((entry) => {
                  const typeInfo = LEDGER_TYPE_LABELS[entry.type] ?? {
                    label: entry.type,
                    color: "text-text-muted",
                  };
                  return (
                    <div key={entry.id} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-foreground">
                          {typeInfo.label}
                        </span>
                        <span className={`font-mono text-sm ${typeInfo.color}`}>
                          {entry.amount >= 0 ? "+" : ""}${entry.amount.toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted truncate">
                        {entry.description}
                      </p>
                      <p className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* References */}
          {(order.stripeSessionId || order.stripePaymentIntentId) && (
            <Card className="p-4 mt-4">
              <h3 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted mb-2">References</h3>
              <div className="text-xs text-text-muted space-y-1 font-mono break-all">
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
