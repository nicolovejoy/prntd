"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign } from "../design/actions";
import { generateMockup } from "../preview/actions";
import { calculatePrice, createCheckoutSession } from "./actions";
import Link from "next/link";
import { Button } from "@/components/ui";
import { getProduct, DEFAULT_PRODUCT_ID } from "@/lib/products";

export default function OrderPage() {
  return (
    <Suspense>
      <OrderPageInner />
    </Suspense>
  );
}

function OrderPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const designId = searchParams.get("id");
  const productId = searchParams.get("product") ?? DEFAULT_PRODUCT_ID;
  const product = getProduct(productId);

  const sizes = product?.sizes ?? [];
  const colors = product?.colors ?? [];
  const sizeLabel = product?.sizeLabel ?? "Size";
  const productName = product?.name ?? "design";

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [mockupLoading, setMockupLoading] = useState(false);
  const [size, setSize] = useState(searchParams.get("size") ?? sizes[1] ?? sizes[0] ?? "M");
  const [color, setColor] = useState(searchParams.get("color") ?? colors[0]?.name ?? "White");
  const [pricing, setPricing] = useState<{
    baseCost: number;
    generationCost: number;
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!designId) {
      router.push("/design");
      return;
    }
    getDesign(designId).then((design) => {
      if (design?.currentImageUrl) setImageUrl(design.currentImageUrl);
    });
  }, [designId, router]);

  // Auto-fetch the Printful mockup for the picked product+color so the
  // canonical render is on screen at checkout. generateMockup caches
  // server-side keyed by productId:color:scale (we use scale=1.0 here).
  useEffect(() => {
    if (!designId) return;
    let cancelled = false;
    setMockupLoading(true);
    setMockupUrl(null);
    generateMockup(designId, color, productId, 1.0)
      .then((res) => {
        if (!cancelled) setMockupUrl(res.mockupUrl);
      })
      .catch(() => {
        // Silently fall back to the raw design image
      })
      .finally(() => {
        if (!cancelled) setMockupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [designId, productId, color]);

  useEffect(() => {
    if (!designId) return;
    calculatePrice(designId, productId, size).then(setPricing);
  }, [designId, productId, size]);

  // Sync selections to URL so they survive Stripe cancel → back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("size", size);
    params.set("color", color);
    params.set("product", productId);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);
  }, [size, color, productId]);

  async function handleCheckout() {
    if (!designId) return;
    setLoading(true);
    try {
      const { url } = await createCheckoutSession({
        designId,
        size,
        color,
        productId,
      });
      if (url) window.location.href = url;
    } catch {
      setLoading(false);
    }
  }

  const colorHex = colors.find((c) => c.name === color)?.value ?? "#f3f4f6";

  return (
    <div className="min-h-screen flex flex-col items-center py-6 md:py-12 px-4 pb-24 md:pb-12">
      {/* Breadcrumbs — hidden on mobile */}
      <nav className="hidden md:flex w-full max-w-2xl mb-8 gap-2 text-sm text-gray-500">
        <Link href={`/design?id=${designId}`} className="hover:underline">
          Design
        </Link>
        <span>/</span>
        <Link href={`/preview?id=${designId}&product=${productId}`} className="hover:underline">
          Preview
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">Order</span>
      </nav>

      <div className="w-full max-w-2xl grid md:grid-cols-2 gap-6 md:gap-8">
        {/* Design preview — compact on mobile */}
        <div className="flex flex-col items-center">
          {mockupUrl ? (
            <div className="w-40 h-40 md:w-full md:aspect-square rounded-lg overflow-hidden">
              <img
                src={mockupUrl}
                alt={`Your design on a ${color} ${productName}`}
                className="w-full h-full object-cover"
              />
            </div>
          ) : imageUrl ? (
            <div
              className="relative w-40 h-40 md:w-full md:aspect-square rounded-lg flex items-center justify-center transition-colors"
              style={{ backgroundColor: colorHex }}
            >
              <img
                src={imageUrl}
                alt="Your design"
                className="max-w-[80%] max-h-[80%] object-contain"
              />
              {mockupLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg">
                  <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Options */}
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">{sizeLabel}</label>
            <div className="flex flex-wrap gap-2">
              {sizes.map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`px-3 py-2.5 md:py-1.5 border-2 rounded-md text-sm transition-colors ${
                    size === s
                      ? "border-accent bg-accent text-accent-fg font-medium"
                      : "border-border text-text-muted hover:border-border-hover"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Color picker — hidden when product has only one color */}
          {colors.length > 1 && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Color — {color}
              </label>
              <div className="flex flex-wrap gap-2.5 md:gap-2">
                {colors.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setColor(c.name)}
                    className={`w-10 h-10 md:w-8 md:h-8 rounded-full border-2 transition-colors ${
                      color === c.name ? "border-accent ring-2 ring-offset-1 ring-accent ring-offset-background" : "border-border"
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Pricing */}
          {pricing && (
            <div className="border-t border-border pt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">{productName}</span>
                <span>${pricing.total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Shipping</span>
                <span className="text-text-muted">Free</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t border-border pt-2">
                <span>Total</span>
                <span>${pricing.total.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Desktop checkout */}
          <Button
            onClick={handleCheckout}
            disabled={loading}
            className="hidden md:block w-full"
            size="lg"
          >
            {loading ? "Redirecting to checkout..." : "Checkout"}
          </Button>
        </div>
      </div>

      {/* Mobile sticky checkout bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-background border-t border-border p-4">
        <Button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full"
          size="lg"
        >
          {loading
            ? "Redirecting..."
            : pricing
              ? `Checkout — $${pricing.total.toFixed(2)}`
              : "Checkout"}
        </Button>
      </div>
    </div>
  );
}
