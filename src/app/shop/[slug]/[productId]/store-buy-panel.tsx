"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { SizePicker, ColorPicker } from "@/components/product-options";
import type { BlankColor } from "@/lib/blanks";
import { computePrice, computeOrderTotal } from "@/lib/pricing";
import { buyStoreProduct } from "../../actions";

/**
 * Buy UI for one storefront product. The blank is fixed (the organizer chose
 * it); the shopper picks size + color. Price = the organizer's override when
 * set, else the computed default per size. Browsing is open — signed-out
 * shoppers get a sign-in CTA that returns here; the gate is at buy.
 */
export function StoreBuyPanel({
  storeSlug,
  productId,
  blankId,
  fixedPrice,
  sizes,
  colors,
  isLoggedIn,
  buyable,
  rememberedSize,
}: {
  storeSlug: string;
  productId: string;
  blankId: string;
  fixedPrice: number | null;
  sizes: string[];
  colors: BlankColor[];
  isLoggedIn: boolean;
  buyable: boolean;
  /** Last-purchase size (#44); null for guests/first purchase. */
  rememberedSize?: string | null;
}) {
  // No silent size (#60): a remembered size pre-selects a visible chip; with
  // nothing remembered the buy CTA stays disabled until a pick.
  const [size, setSize] = useState<string | null>(() =>
    rememberedSize && sizes.includes(rememberedSize) ? rememberedSize : null
  );
  const [color, setColor] = useState(colors[0]?.name ?? "White");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInHref = `/sign-in?next=/shop/${storeSlug}/${productId}`;

  // Organizer price is size-independent; the computed fallback varies by
  // size — before a pick it shows the base-size price.
  const itemPrice =
    fixedPrice ?? computePrice(0, blankId, size ?? sizes[0] ?? "M").total;
  const { item, shipping, total } = computeOrderTotal(itemPrice);

  async function handleBuy() {
    if (!size) return;
    setLoading(true);
    setError(null);
    try {
      const { url, needsAuth, error } = await buyStoreProduct({
        storeProductId: productId,
        size,
        color,
      });
      if (needsAuth) {
        window.location.href = signInHref;
        return;
      }
      if (url) {
        window.location.href = url;
        return;
      }
      setError(error ?? "Couldn't start checkout");
      setLoading(false);
    } catch {
      setError("Couldn't start checkout");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5 border-t border-border pt-5">
      <SizePicker sizes={sizes} value={size} onChange={setSize} />
      <ColorPicker colors={colors} value={color} onChange={setColor} />

      <div className="space-y-2 text-sm border-t border-border pt-4">
        <div className="flex justify-between">
          <span className="text-text-muted">Design</span>
          <span>${item.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Shipping</span>
          <span>${shipping.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-bold border-t border-border pt-2">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      {!buyable ? (
        <p className="text-sm text-text-faint">
          Not listed yet — publish the shop and list this product to sell it.
        </p>
      ) : isLoggedIn ? (
        <div className="space-y-1.5">
          {!size && (
            <p className="text-sm text-text-muted text-center">Choose a size</p>
          )}
          <Button
            onClick={handleBuy}
            disabled={loading || !size}
            size="lg"
            className="w-full"
          >
            {loading ? "Redirecting…" : `Buy — $${total.toFixed(2)}`}
          </Button>
        </div>
      ) : (
        <Link href={signInHref} className="block">
          <Button size="lg" className="w-full">
            Sign in to buy
          </Button>
        </Link>
      )}
    </div>
  );
}
