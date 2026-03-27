"use client";

import { useEffect, useState } from "react";
import { getOrders } from "./actions";

type Order = Awaited<ReturnType<typeof getOrders>>[number];

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  paid: "bg-blue-100 text-blue-700",
  submitted: "bg-purple-100 text-purple-700",
  shipped: "bg-green-100 text-green-700",
  delivered: "bg-green-200 text-green-800",
};

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrders()
      .then(setOrders)
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

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <h1 className="text-xl font-bold mb-6">Orders</h1>

      {orders.length === 0 ? (
        <p className="text-gray-500">No orders yet.</p>
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
                <th className="py-3 pr-4">Total</th>
                <th className="py-3 pr-4">Printful</th>
                <th className="py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="py-3 pr-4 font-mono text-xs">
                    {order.id.slice(0, 8)}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[order.status] ?? "bg-gray-100 text-gray-700"}`}
                    >
                      {order.status}
                    </span>
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
                  <td className="py-3 pr-4 font-mono text-xs text-gray-400">
                    {order.printfulOrderId ?? "—"}
                  </td>
                  <td className="py-3 text-xs text-gray-400">
                    {order.createdAt
                      ? new Date(order.createdAt).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
