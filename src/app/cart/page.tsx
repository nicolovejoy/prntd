"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getCart, removeCartItem, checkoutCart, type CartView } from "./actions";
import { Button } from "@/components/ui";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { ensureGuestSession } from "@/lib/ensure-guest-session";

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartView | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  async function refresh() {
    setCart(await getCart());
  }

  useEffect(() => {
    // Keep the guest session alive, then load the cart it owns.
    ensureGuestSession().finally(refresh);
  }, []);

  async function handleRemove(id: string) {
    setRemoving(id);
    try {
      await removeCartItem(id);
      await refresh();
    } finally {
      setRemoving(null);
    }
  }

  async function handleCheckout() {
    setCheckingOut(true);
    try {
      const { url, needsAuth } = await checkoutCart();
      if (needsAuth) {
        window.location.href = "/sign-in?next=/cart";
        return;
      }
      if (url) window.location.href = url;
    } finally {
      setCheckingOut(false);
    }
  }

  const empty = cart !== null && cart.items.length === 0;

  return (
    <div className="min-h-screen flex flex-col items-center py-6 md:py-12 px-4 pb-24 md:pb-12">
      <Breadcrumbs
        trail={breadcrumbTrail("/cart")}
        current="Cart"
        className="w-full max-w-2xl mb-8"
      />

      <div className="w-full max-w-2xl">
        <h1 className="text-xl font-semibold mb-6">Your cart</h1>

        {cart === null && <p className="text-text-muted">Loading…</p>}

        {empty && (
          <div className="text-center py-12 space-y-4">
            <p className="text-text-muted">Your cart is empty.</p>
            <Link href="/design">
              <Button size="lg">Start a design</Button>
            </Link>
          </div>
        )}

        {cart && cart.items.length > 0 && (
          <>
            <ul className="divide-y divide-border border-y border-border">
              {cart.items.map((item) => (
                <li
                  key={item.id}
                  data-testid="cart-line-item"
                  className="flex items-center gap-4 py-4"
                >
                  <div className="w-16 h-16 shrink-0 rounded-md bg-checkerboard overflow-hidden">
                    {item.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="w-full h-full object-contain"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{item.productName}</p>
                    <p className="text-sm text-text-muted">
                      {item.color} / {item.size}
                      {item.hasBack ? " · front + back" : ""}
                      {item.quantity > 1 ? ` · ×${item.quantity}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-medium">
                      ${(item.unitPrice * item.quantity).toFixed(2)}
                    </p>
                    <button
                      onClick={() => handleRemove(item.id)}
                      disabled={removing === item.id}
                      className="text-xs text-text-faint hover:text-text-muted transition-colors mt-1"
                    >
                      {removing === item.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="space-y-2 text-sm mt-4">
              <div className="flex justify-between">
                <span className="text-text-muted">Items</span>
                <span>${cart.itemSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Shipping (bundled)</span>
                <span>${cart.shipping.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-border pt-2">
                <span>Total</span>
                <span>${cart.total.toFixed(2)}</span>
              </div>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Button
                onClick={handleCheckout}
                disabled={checkingOut}
                size="lg"
                className="w-full"
              >
                {checkingOut ? "Redirecting…" : `Checkout — $${cart.total.toFixed(2)}`}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => router.push("/design")}
              >
                Add another design
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
