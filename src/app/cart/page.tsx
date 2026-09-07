"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getCart, removeCartItem, checkoutCart, type CartView } from "./actions";
import { Button, EmptyState } from "@/components/ui";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";

/** Reject if `p` doesn't settle within `ms` — so one slow/lost server-action
 * response doesn't strand the load forever (a retry issues a fresh call). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("getCart timed out")), ms)
    ),
  ]);
}

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartView | null>(null);
  // A failed load is its own state. Falling back to an empty cart made a
  // broken load look identical to "you have nothing in your cart" — wrong for
  // tests and worse for a customer who is about to walk away.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  async function refresh() {
    setCart(await getCart());
  }

  useEffect(() => {
    // getCart is a server action whose response can be slow or lost; one silent
    // retry absorbs that, and anything past it surfaces as an error the visitor
    // can act on. No ensureGuestSession here: getCart resolves the existing
    // session server-side and returns an empty cart for a true guest — minting
    // a fresh anon user client-side only risked stomping the real session.
    let cancelled = false;
    setLoadFailed(false);
    (async () => {
      for (let i = 0; i < 2 && !cancelled; i++) {
        try {
          const view = await withTimeout(getCart(), 8000);
          if (!cancelled) setCart(view);
          return;
        } catch {
          if (i === 0) await new Promise((r) => setTimeout(r, 800));
        }
      }
      if (!cancelled) setLoadFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

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

  const empty = !loadFailed && cart !== null && cart.items.length === 0;

  return (
    <div className="min-h-screen flex flex-col items-center py-6 md:py-12 px-4 pb-24 md:pb-12">
      <Breadcrumbs
        trail={breadcrumbTrail("/cart")}
        current="Cart"
        className="w-full max-w-2xl mb-8"
      />

      <div className="w-full max-w-2xl">
        <h1 className="text-xl font-semibold mb-6">Your cart</h1>

        {cart === null && !loadFailed && (
          <p className="text-text-muted">Loading…</p>
        )}

        {loadFailed && (
          <EmptyState
            testId="cart-load-error"
            message="Couldn't load your cart."
            action={
              <Button size="lg" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </Button>
            }
          />
        )}

        {empty && (
          <EmptyState
            message="Your cart is empty."
            action={
              <Link href="/design">
                <Button size="lg">Start a design</Button>
              </Link>
            }
          />
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
