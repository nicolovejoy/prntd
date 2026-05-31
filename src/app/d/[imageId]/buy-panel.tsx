"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { SizePicker, ColorPicker } from "@/components/product-options";
import { ACTIVE_PRODUCTS, DEFAULT_PRODUCT_ID, getProduct } from "@/lib/products";
import { computePrice } from "@/lib/pricing";
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
  const [productId, setProductId] = useState(DEFAULT_PRODUCT_ID);
  const product = getProduct(productId);
  const sizes = product?.sizes ?? [];
  const colors = product?.colors ?? [];

  const [size, setSize] = useState(sizes[1] ?? sizes[0] ?? "M");
  const [color, setColor] = useState(
    preferredColor && colors.some((c) => c.name === preferredColor)
      ? preferredColor
      : colors[0]?.name ?? "White"
  );
  const [loading, setLoading] = useState(false);

  // Switching product can invalidate the current size/color. Clamp both to
  // the new product's options.
  function handleProduct(id: string) {
    const next = getProduct(id);
    if (!next) return;
    setProductId(id);
    if (!next.sizes.includes(size)) setSize(next.sizes[1] ?? next.sizes[0]);
    if (!next.colors.some((c) => c.name === color)) {
      setColor(next.colors[0]?.name ?? "White");
    }
  }

  const total = computePrice(0, productId, size).total;

  async function handleBuy() {
    setLoading(true);
    try {
      const { url } = await buyPublishedDesign({ imageId, productId, size, color });
      if (url) window.location.href = url;
    } catch {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5 border-t border-border pt-5">
      {ACTIVE_PRODUCTS.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-2">Product</label>
          <div className="flex flex-wrap gap-2">
            {ACTIVE_PRODUCTS.map((p) => (
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
      <ColorPicker colors={colors} value={color} onChange={setColor} />

      <div className="flex justify-between text-sm border-t border-border pt-4">
        <span className="text-text-muted">Total</span>
        <span className="font-bold">${total.toFixed(2)}</span>
      </div>

      {isLoggedIn ? (
        <Button onClick={handleBuy} disabled={loading} size="lg" className="w-full">
          {loading ? "Redirecting…" : `Buy this design — $${total.toFixed(2)}`}
        </Button>
      ) : (
        <Link href={`/sign-in?next=/d/${imageId}`} className="block">
          <Button size="lg" className="w-full">
            Sign in to buy
          </Button>
        </Link>
      )}
    </div>
  );
}
