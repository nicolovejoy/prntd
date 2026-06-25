"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getOrderBySession } from "./actions";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";

export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmPageInner />
    </Suspense>
  );
}

function ConfirmPageInner() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const [order, setOrder] = useState<{
    id: string;
    status: string;
    totalPrice: number;
    lines: { blankId: string; size: string; color: string; quantity: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    getOrderBySession(sessionId).then((o) => {
      setOrder(o);
      setLoading(false);
    });
  }, [sessionId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading order details...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-muted">Order not found.</p>
          <Link href="/design" className="mt-4 underline">
            Start a new design
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col px-4">
      <Breadcrumbs
        trail={breadcrumbTrail("/order/confirm")}
        current="Confirmed"
        className="py-4"
      />
      <div className="flex-1 flex flex-col items-center justify-center">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="text-5xl">&#10003;</div>
        <h1 className="text-2xl font-bold">Order confirmed!</h1>
        <p className="text-text-muted">
          Your custom t-shirt is being prepared. Check your order status
          anytime on{" "}
          <Link href="/orders" className="underline underline-offset-2">
            My Orders
          </Link>
          .
        </p>

        <Card className="p-4 text-sm space-y-2 text-left">
          <div className="flex justify-between">
            <span className="text-text-muted">Order ID</span>
            <span className="font-mono">{order.id.slice(0, 8)}</span>
          </div>
          {order.lines.map((line, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-text-muted">
                {order.lines.length > 1 ? `Item ${i + 1}` : "Item"}
              </span>
              <span>
                {line.size} / {line.color}
                {line.quantity > 1 && ` ×${line.quantity}`}
              </span>
            </div>
          ))}
          <div className="flex justify-between font-bold border-t border-border pt-2">
            <span>Total paid</span>
            <span>${order.totalPrice.toFixed(2)}</span>
          </div>
        </Card>

        <div className="flex flex-col gap-3">
          <Link href="/orders">
            <Button className="w-full">View My Orders</Button>
          </Link>
          <Link href="/design">
            <Button variant="ghost" className="w-full">Start another design</Button>
          </Link>
        </div>
      </div>
      </div>
    </div>
  );
}
