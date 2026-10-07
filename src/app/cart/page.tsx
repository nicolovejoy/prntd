"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getCart,
  removeCartItem,
  setCartItemQuantity,
  checkoutCart,
  type CartView,
} from "./actions";
import { Button, EmptyState, InlineNotice } from "@/components/ui";
import { CART_LINE_UNAVAILABLE_LABEL, QUANTITY_UPDATE_FAILED } from "@/lib/action-copy";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { CART_LINE_MIN_QUANTITY, CART_LINE_MAX_QUANTITY } from "@/lib/cart-line-edit";

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
  // The id of the line with a Remove or quantity change in flight. It is one
  // id for the whole page, not one per line: starting a change on another line
  // replaces it. That is harmless because quantity writes are absolute (the
  // last write wins and each response is followed by a fresh getCart), and
  // while it is set the Checkout button is disabled so its total can't be
  // stale. `removing` is the Remove subset, for its "Removing…" label.
  const [busy, setBusy] = useState<string | null>(null);
  const [quantityFailed, setQuantityFailed] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  // checkoutCart's refusal ({ error }), shown above the buttons; the lines
  // that caused it are marked by getCart.
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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
    setBusy(id);
    setRemoving(id);
    try {
      await removeCartItem(id);
      await refresh();
    } finally {
      setRemoving(null);
      setBusy(null);
    }
  }

  async function handleQuantity(id: string, quantity: number) {
    if (quantity < CART_LINE_MIN_QUANTITY || quantity > CART_LINE_MAX_QUANTITY) return;
    setBusy(id);
    setQuantityFailed(false);
    try {
      await setCartItemQuantity(id, quantity);
    } catch {
      setQuantityFailed(true);
    }
    // Re-read either way, so the stepper shows the server's number (also when
    // the line is gone: { ok: false }).
    try {
      await refresh();
    } catch {
      setQuantityFailed(true);
    } finally {
      setBusy(null);
    }
  }

  async function handleCheckout() {
    setCheckingOut(true);
    setCheckoutError(null);
    try {
      const { url, needsAuth, error } = await checkoutCart();
      if (error) {
        setCheckoutError(error);
        // Re-read the cart so the line that failed carries its label.
        await refresh();
        return;
      }
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
        <h1 className="text-xl sm:text-2xl font-bold mb-6">Your cart</h1>

        {cart === null && !loadFailed && (
          <p className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-faint">
            Loading…
          </p>
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
              // /design, not /studio — the one make-CTA that keeps ruling W1
              // after #241. An empty cart is exactly what a first-time
              // visitor with no session sees (Cart is in the header bar, and
              // /, /shop and /cart mint no session), and the proxy sends a
              // sessionless /studio request to /sign-in. /design is open to
              // them and mints the guest session. "Add another design" below
              // goes to /studio: a cart with lines implies a session.
              <Link href="/design">
                <Button size="lg">Start a design</Button>
              </Link>
            }
          />
        )}

        {cart && cart.items.length > 0 && (
          <>
            <ul className="border-t border-border">
              {cart.items.map((item) => {
                // Two thumbnails would squeeze the text column at 390px
                // (358 - 2x64 - 3x16 gaps - ~60 price = ~122px), so a
                // two-sided line uses 56px ones (~138px).
                const thumb = item.backImageUrl ? "w-14 h-14" : "w-16 h-16";
                // Edit reopens the image detail page with this line's picks;
                // an unavailable line has nothing to reopen.
                // While checkout is starting the cart must not change under it,
                // so the links go quiet (Edit becomes plain text below).
                const canEdit = item.unavailable ? null : item.editHref;
                const editHref = checkingOut ? null : canEdit;
                const thumbs = (
                  <>
                    <div className={`${thumb} shrink-0 bg-surface-well border border-border overflow-hidden`}>
                      {item.imageUrl && (
                        // alt="" is deliberate: the visible product name beside
                        // this thumbnail is the row's label, so a non-empty alt
                        // would have a screen reader announce it twice per line.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="w-full h-full object-contain"
                        />
                      )}
                    </div>
                    {item.backImageUrl && (
                      <div
                        data-testid="cart-line-back"
                        className={`${thumb} shrink-0 bg-surface-well border border-border overflow-hidden`}
                      >
                        {/* alt="" for the same reason as the front: the text
                            beside it ("front + back") is the label. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.backImageUrl}
                          alt=""
                          className="w-full h-full object-contain"
                        />
                      </div>
                    )}
                  </>
                );
                const linkStyle =
                  "min-h-11 inline-flex items-center text-xs text-text-muted underline underline-offset-[3px] hover:text-foreground disabled:no-underline disabled:text-text-faint transition-colors";
                return (
                  <li
                    key={item.id}
                    data-testid="cart-line-item"
                    className="border-b border-border py-4"
                  >
                    <div className="flex items-center gap-4">
                      {editHref ? (
                        <Link
                          href={editHref}
                          data-testid="cart-line-thumb-link"
                          // Same destination as the Edit link beside it, which
                          // is the one with a name; this one is a larger tap
                          // target only, so it stays out of the tab order.
                          tabIndex={-1}
                          aria-hidden="true"
                          className="flex items-center gap-4 shrink-0"
                        >
                          {thumbs}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-4 shrink-0">{thumbs}</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.productName}</p>
                        <p className="text-sm text-text-muted">
                          {item.color} / {item.size}
                          {item.hasBack ? " · front + back" : ""}
                        </p>
                        {item.unavailable && (
                          <p
                            data-testid="cart-line-unavailable"
                            className="text-sm font-medium mt-0.5"
                          >
                            {CART_LINE_UNAVAILABLE_LABEL}
                          </p>
                        )}
                      </div>
                      <p className="font-mono text-sm text-right shrink-0">
                        ${(item.unitPrice * item.quantity).toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-3">
                      <div
                        role="group"
                        aria-label="Quantity"
                        className="inline-flex items-center border border-border"
                      >
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          onClick={() => handleQuantity(item.id, item.quantity - 1)}
                          disabled={checkingOut || busy === item.id || item.quantity <= CART_LINE_MIN_QUANTITY}
                          className="w-11 h-11 inline-flex items-center justify-center text-base disabled:text-text-faint"
                        >
                          −
                        </button>
                        <span data-testid="cart-line-quantity" className="w-8 text-center font-mono text-sm">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          onClick={() => handleQuantity(item.id, item.quantity + 1)}
                          disabled={checkingOut || busy === item.id || item.quantity >= CART_LINE_MAX_QUANTITY}
                          className="w-11 h-11 inline-flex items-center justify-center text-base disabled:text-text-faint"
                        >
                          +
                        </button>
                      </div>
                      <div className="flex items-center gap-4">
                        {editHref ? (
                          <Link href={editHref} className={linkStyle}>
                            Edit
                          </Link>
                        ) : (
                          canEdit && (
                            <span className="min-h-11 inline-flex items-center text-xs text-text-faint">
                              Edit
                            </span>
                          )
                        )}
                        <button
                          onClick={() => handleRemove(item.id)}
                          disabled={checkingOut || busy === item.id}
                          className={linkStyle}
                        >
                          {removing === item.id ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {quantityFailed && (
              <InlineNotice
                message={QUANTITY_UPDATE_FAILED}
                className="mt-4"
                testId="cart-quantity-error"
              />
            )}

            <div className="space-y-2 text-sm mt-4">
              <div className="flex justify-between">
                <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                  Items
                </span>
                <span className="font-mono text-sm">${cart.itemSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                  Shipping (bundled)
                </span>
                <span className="font-mono text-sm">${cart.shipping.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2">
                <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                  Total
                </span>
                <span className="font-mono text-sm font-medium">${cart.total.toFixed(2)}</span>
              </div>
            </div>

            {checkoutError && (
              <InlineNotice
                message={checkoutError}
                className="mt-4"
                testId="cart-checkout-error"
              />
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Button
                onClick={handleCheckout}
                disabled={checkingOut || busy !== null}
                size="lg"
                className="w-full"
              >
                {checkingOut ? "Redirecting…" : `Checkout — $${cart.total.toFixed(2)}`}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                // /studio (#241 reversed ruling W1 here). A cart with lines
                // implies a session — guest or real — so with the guest
                // funnel on this always reaches the bench. The empty-state
                // CTA above stays on /design; see its comment.
                onClick={() => router.push("/studio")}
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
