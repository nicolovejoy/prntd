"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { SizePicker, ColorPicker } from "@/components/product-options";
import { ACTIVE_BLANKS, DEFAULT_BLANK_ID, getBlank } from "@/lib/blanks";
import { computePrice, computeOrderTotal } from "@/lib/pricing";
import { buyPublishedDesign } from "../actions";

/**
 * Buy-existing UI on `/d/[imageId]`. Logged-in users pick product/size/color
 * and buy the published design directly (no design step). Signed-out users
 * get a sign-in CTA that returns them here. Price is computed client-side at
 * generationCost 0 — the buyer never incurs generation cost — so it updates
 * instantly without a server round-trip. Phone-first: sticky CTA handled by
 * the page; this is the options block.
 */
export function BuyPanel({
  imageId,
  isLoggedIn,
  preferredColor,
}: {
  imageId: string;
  isLoggedIn: boolean;
  /** The design's pinned backdrop color; pre-selected when this product carries it. */
  preferredColor?: string | null;
}) {
  const [productId, setProductId] = useState(DEFAULT_BLANK_ID);
  const product = getBlank(productId);
  const sizes = product?.sizes ?? [];
  const colors = product?.colors ?? [];

  // No default size (#60): the buyer must pick one before the CTA enables,
  // so nobody checks out in a size they never chose.
  const [size, setSize] = useState<string | null>(null);
  // The pinned backdrop color IS defaulted (the design is displayed on it),
  // but labeled below so it's not a silent pick.
  const pinnedColorApplied =
    !!preferredColor && colors.some((c) => c.name === preferredColor);
  const [color, setColor] = useState<string>(
    pinnedColorApplied && preferredColor
      ? preferredColor
      : colors[0]?.name ?? "White"
  );
  const [loading, setLoading] = useState(false);

  // Switching product can invalidate the current size/color. Size resets to
  // unselected (never silently re-picked); color clamps to the new options.
  function handleProduct(id: string) {
    const next = getBlank(id);
    if (!next) return;
    setProductId(id);
    if (size && !next.sizes.includes(size)) setSize(null);
    if (!next.colors.some((c) => c.name === color)) {
      setColor(next.colors[0]?.name ?? "White");
    }
  }

  // Price display before a size is picked uses the base size — S–XL share a
  // price; a 2XL pick updates it live.
  const { item, shipping, total } = computeOrderTotal(
    computePrice(0, productId, size ?? sizes[0] ?? "M").total
  );

  async function handleBuy() {
    if (!size) return;
    setLoading(true);
    try {
      const { url, needsAuth } = await buyPublishedDesign({ imageId, productId, size, color });
      if (needsAuth) {
        window.location.href = `/sign-in?next=/d/${imageId}`;
        return;
      }
      if (url) window.location.href = url;
    } catch {
      setLoading(false);
    }
  }

  const cta = isLoggedIn ? (
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
        {loading ? "Redirecting…" : `Order — $${total.toFixed(2)}`}
      </Button>
    </div>
  ) : (
    <Link href={`/sign-in?next=/d/${imageId}`} className="block">
      <Button size="lg" className="w-full">
        Sign in to buy
      </Button>
    </Link>
  );

  return (
    <div className="space-y-4 sm:space-y-5 border-t border-border pt-4 sm:pt-5">
      {ACTIVE_BLANKS.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-2">Product</label>
          <div className="flex flex-wrap gap-2">
            {ACTIVE_BLANKS.map((p) => (
              <button
                key={p.id}
                onClick={() => handleProduct(p.id)}
                className={`px-3 py-2.5 md:py-1.5 border-2 rounded-md text-sm transition-colors ${
                  productId === p.id
                    ? "border-accent bg-accent text-accent-fg font-medium"
                    : "border-border text-text-muted hover:border-border-hover"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <SizePicker
        sizes={sizes}
        value={size}
        onChange={setSize}
        label={product?.sizeLabel ?? "Size"}
      />
      <ColorPicker
        colors={colors}
        value={color}
        onChange={setColor}
        note={
          pinnedColorApplied
            ? `Shown in ${preferredColor} — designer's pick`
            : undefined
        }
      />

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

      {/* Desktop: CTA sits inline below the price breakdown. */}
      <div className="hidden md:block">{cta}</div>

      {/* Mobile: CTA pinned to the bottom of the viewport so it's always
          reachable without scrolling the tall image + options column. The
          page reserves matching bottom padding so nothing hides behind it. */}
      <div
        className="md:hidden fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 pt-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {cta}
      </div>
    </div>
  );
}
