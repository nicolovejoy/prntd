"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getUserOrders } from "./actions";
import { Badge, Button, Card } from "@/components/ui";

type Order = Awaited<ReturnType<typeof getUserOrders>>[number];

const statusLabel: Record<string, string> = {
  pending: "Processing",
  paid: "Paid",
  submitted: "In production",
  shipped: "Shipped",
  delivered: "Delivered",
  canceled: "Canceled",
};

function formatDate(date: Date | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUserOrders()
      .then(setOrders)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-6 py-8 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">My Orders</h1>
          <Link href="/design">
            <Button size="sm">New Design</Button>
          </Link>
        </div>

        {loading ? (
          <p className="text-text-muted">Loading...</p>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <p className="text-text-muted text-lg">No orders yet.</p>
            <Link href="/design">
              <Button>Design your first shirt</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <Card key={order.id} className="p-4">
                <div className="flex gap-4">
                  {/* Design thumbnail */}
                  <div className="w-16 h-16 rounded bg-surface-raised flex-shrink-0 overflow-hidden">
                    {order.designImageUrl ? (
                      <img
                        src={order.designImageUrl}
                        alt="Design"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-faint text-xs">
                        —
                      </div>
                    )}
                  </div>

                  {/* Order details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={order.status as any}>
                          {statusLabel[order.status] ?? order.status}
                        </Badge>
                        <span className="text-xs text-text-faint font-mono">
                          {order.id.slice(0, 8)}
                        </span>
                      </div>
                      <span className="text-sm font-medium">
                        ${order.totalPrice.toFixed(2)}
                      </span>
                    </div>

                    <p className="text-sm text-text-muted">
                      {order.size} / {order.color}
                      <span className="text-text-faint"> · {order.quality}</span>
                    </p>

                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-text-faint">
                        {formatDate(order.createdAt)}
                      </span>
                      {order.trackingUrl && (
                        <a
                          href={order.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent underline underline-offset-2"
                        >
                          Track shipment
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
