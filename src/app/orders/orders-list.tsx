"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { getColorHex } from "@/lib/blanks";
import type { UserOrder } from "@/lib/user-orders";

type StatusFilter = "active" | "canceled" | "all";

const statusLabel: Record<string, string> = {
  pending: "Processing",
  paid: "Paid",
  submitted: "In production",
  shipped: "Shipped",
  delivered: "Delivered",
  canceled: "Canceled",
};

// The Badge primitive (src/components/ui/badge.tsx) IS the mono status label
// under Paper — no pill, no color except shipped/delivered (positive) and
// canceled (negative). Don't re-inline a status→color map here; Badge already
// carries that mapping (and /admin's, so the two lists agree).

function formatDate(date: Date | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function OrdersList({ orders }: { orders: UserOrder[] }) {
  const [filter, setFilter] = useState<StatusFilter>("active");

  const canceledCount = useMemo(
    () => orders.filter((o) => o.status === "canceled" || o.archivedAt).length,
    [orders]
  );
  const activeCount = orders.length - canceledCount;

  const filtered = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "canceled")
      return orders.filter((o) => o.status === "canceled" || o.archivedAt);
    // "active" — not canceled and not archived
    return orders.filter((o) => o.status !== "canceled" && !o.archivedAt);
  }, [orders, filter]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full">
        <div className="mb-6">
          {/* Mono masthead, same class string as /shop's (src/app/shop/page.tsx):
              a section label, not a display heading. `uppercase` does the
              casing, so the text stays sentence case in code. */}
          <h1 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
            Orders
          </h1>
        </div>

        {/* Status filter — mirrors the Studio tab strip (studio-tabs.tsx). */}
        {orders.length > 0 && (
          <div className="flex items-center gap-4 border-b border-border mb-4">
            {(["active", "canceled", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`-mb-px min-h-11 flex items-center border-b-2 px-1 text-sm transition-colors ${
                  filter === f
                    ? "border-foreground text-foreground"
                    : "border-transparent text-text-muted hover:text-foreground"
                }`}
              >
                {f === "active"
                  ? `Active (${activeCount})`
                  : f === "canceled"
                    ? `Canceled (${canceledCount})`
                    : `All (${orders.length})`}
              </button>
            ))}
          </div>
        )}

        {orders.length === 0 ? (
          <EmptyState
            message="No orders yet."
            action={
              <Link href="/studio">
                <Button size="lg">Make your first design</Button>
              </Link>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            message={`No ${filter === "canceled" ? "canceled" : "active"} orders.`}
          />
        ) : (
          <ul className="border-t border-border">
            {filtered.map((order) => (
              <li key={order.id} className="border-b border-border py-5">
                {/* Order header: status + name/id (left), total (right) */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant={order.status}>
                      {statusLabel[order.status] ?? order.status}
                    </Badge>
                    {order.displayName && (
                      <span className="text-sm font-medium truncate">
                        {order.displayName}
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-text-faint">
                      {order.id.slice(0, 8)}
                    </span>
                  </div>
                  <span className="font-mono text-sm whitespace-nowrap">
                    ${order.totalPrice.toFixed(2)}
                  </span>
                </div>

                {/* One row per purchased shirt */}
                <div className="space-y-2">
                  {order.lines.map((line, i) => (
                    <div key={i} className="flex gap-4">
                      {/* Design thumbnail(s) on the line's selected color; a
                          second tile for the back print when the line has one. */}
                      <div className="flex gap-1.5 flex-shrink-0">
                        <div className="flex flex-col items-center gap-0.5">
                          <div
                            className="w-16 h-16 border border-border p-1.5 overflow-hidden"
                            style={{
                              backgroundColor: line.imageUrl
                                ? getColorHex(line.blankId, line.color)
                                : undefined,
                            }}
                          >
                            {line.imageUrl ? (
                              <Image
                                src={line.imageUrl}
                                alt="Front design"
                                width={64}
                                height={64}
                                sizes="64px"
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-text-faint text-xs bg-surface-well">
                                —
                              </div>
                            )}
                          </div>
                          {line.imageUrl && line.backImageUrl && (
                            <span className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
                              Front
                            </span>
                          )}
                        </div>
                        {line.imageUrl && line.backImageUrl && (
                          <div className="flex flex-col items-center gap-0.5">
                            <div
                              className="w-16 h-16 border border-border p-1.5 overflow-hidden"
                              style={{
                                backgroundColor: getColorHex(line.blankId, line.color),
                              }}
                            >
                              <Image
                                src={line.backImageUrl}
                                alt="Back design"
                                width={64}
                                height={64}
                                sizes="64px"
                                className="w-full h-full object-contain"
                              />
                            </div>
                            {line.imageUrl && (
                              <span className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
                                Back
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-muted">
                          {line.size} / {line.color}
                          {line.quantity > 1 && (
                            <span className="ml-2">×{line.quantity}</span>
                          )}
                        </p>
                        {line.designedByName && (
                          <p className="text-xs text-text-faint mt-0.5">
                            Designed by {line.designedByName}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Order footer: date + tracking */}
                <div className="flex items-center justify-between mt-3">
                  <span className="font-mono text-[11px] text-text-faint">
                    {formatDate(order.createdAt)}
                  </span>
                  {order.trackingUrl && (
                    <a
                      href={order.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-11 inline-flex items-center text-sm text-foreground underline underline-offset-[3px]"
                    >
                      Track shipment
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
