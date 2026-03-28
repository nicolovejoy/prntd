"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getOrderBySession } from "./actions";
import Link from "next/link";

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
    size: string;
    color: string;
    quality: string;
    totalPrice: number;
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
          <p className="text-gray-600">Order not found.</p>
          <Link href="/design" className="mt-4 underline">
            Start a new design
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="text-5xl">&#10003;</div>
        <h1 className="text-2xl font-bold">Order confirmed!</h1>
        <p className="text-gray-600">
          Your custom t-shirt is being prepared. You&apos;ll receive shipping
          updates via email.
        </p>

        <div className="border border-gray-700 rounded-lg p-4 text-sm space-y-2 text-left">
          <div className="flex justify-between">
            <span className="text-gray-400">Order ID</span>
            <span className="font-mono">{order.id.slice(0, 8)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Size</span>
            <span>{order.size}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Color</span>
            <span>{order.color}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Quality</span>
            <span className="capitalize">{order.quality}</span>
          </div>
          <div className="flex justify-between font-bold border-t border-gray-700 pt-2">
            <span>Total paid</span>
            <span>${order.totalPrice.toFixed(2)}</span>
          </div>
        </div>

        <Link
          href="/design"
          className="inline-block px-6 py-2 bg-black text-white rounded-md"
        >
          Design another shirt
        </Link>
      </div>
    </div>
  );
}
