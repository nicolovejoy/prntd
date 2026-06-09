"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign } from "../design/actions";
import { generateMockup, isMultiPlacementEnabled } from "../preview/actions";
import { calculatePrice, createCheckoutSession } from "./actions";
import { addToCart, isCartEnabled } from "../cart/actions";
import { computeOrderTotal, BACK_PLACEMENT_UPCHARGE } from "@/lib/pricing";
import { Button } from "@/components/ui";
import { SizePicker, ColorPicker } from "@/components/product-options";
import { getProduct, DEFAULT_PRODUCT_ID } from "@/lib/products";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { ensureGuestSession } from "@/lib/ensure-guest-session";

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

  // Capture the back source once on mount. The URL-sync effect below rewrites
  // the query string, so reading it live would race the flag load and drop it.
  const [backImageId] = useState<string | null>(() => searchParams.get("back"));
  // Multi-placement kill-switch (#25). A stray `?back=` is ignored (no upcharge,
  // not sent to checkout) until the flag is on; the server gates it again at
  // checkout, defense in depth.
  const [multiPlacement, setMultiPlacement] = useState(false);
  const backActive = multiPlacement && !!backImageId;

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
  // Cart (#26 B3): show "Add to cart" alongside Buy-now when CART_ENABLED.
  const [cartShown, setCartShown] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);

  // Guest funnel (#26): keep the anonymous session alive so a signed-out
  // visitor can reach the order page; the auth gate fires at checkout.
  useEffect(() => {
    ensureGuestSession();
  }, []);

  useEffect(() => {
    isCartEnabled().then(setCartShown).catch(() => setCartShown(false));
  }, []);

  useEffect(() => {
    isMultiPlacementEnabled()
      .then(setMultiPlacement)
      .catch(() => setMultiPlacement(false));
  }, []);

  useEffect(() => {
    if (!designId) {
      router.push("/design");
      return;
    }
    getDesign(designId).then((design) => {
      if (design?.displayImageUrl) setImageUrl(design.displayImageUrl);
    });
  }, [designId, router]);

  // Auto-fetch the Printful mockup for the picked product+color so the
  // canonical render is on screen at checkout. generateMockup caches
  // server-side keyed by productId:color:scale (we use scale=1.0 here).
  useEffect(() => {
    if (!designId) return;
    let cancelled = false;
    // Reset on dep change so the new product/color doesn't briefly show
    // the previous mockup. Legitimate use of setState in effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMockupLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    calculatePrice(designId, productId, size, backActive).then(setPricing);
  }, [designId, productId, size, backActive]);

  // Sync selections to URL so they survive Stripe cancel → back. The back
  // source is preserved verbatim (it's captured once, never cleared here).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("size", size);
    params.set("color", color);
    params.set("product", productId);
    if (backImageId) params.set("back", backImageId);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);
  }, [size, color, productId, backImageId]);

  async function handleCheckout() {
    if (!designId) return;
    setLoading(true);
    try {
      const { url, needsAuth } = await createCheckoutSession({
        designId,
        size,
        color,
        productId,
        ...(backActive ? { back: backImageId! } : {}),
      });
      // Guest hit the purchase gate — send them to sign-in and back. After
      // sign-in the anonymous plugin re-parents this design to their account.
      if (needsAuth) {
        const next = window.location.pathname + window.location.search;
        window.location.href = `/sign-in?next=${encodeURIComponent(next)}`;
        return;
      }
      if (url) window.location.href = url;
    } catch {
      setLoading(false);
    }
  }

  async function handleAddToCart() {
    if (!designId) return;
    setAddingToCart(true);
    try {
      await addToCart({
        designId,
        size,
        color,
        productId,
        ...(backActive ? { back: backImageId! } : {}),
      });
      router.push("/cart");
    } catch {
      setAddingToCart(false);
    }
  }

  const colorHex = colors.find((c) => c.name === color)?.value ?? "#f3f4f6";

  // Product price + shipping → grand total, from the same helper the checkout
  // choke point charges, so the displayed total matches the Stripe total.
  const breakdown = pricing ? computeOrderTotal(pricing.total) : null;

  return (
    <div className="min-h-screen flex flex-col items-center py-6 md:py-12 px-4 pb-24 md:pb-12">
      <Breadcrumbs
        trail={breadcrumbTrail("/order", {
          id: designId ?? undefined,
          product: productId,
          color,
        })}
        current="Order"
        className="w-full max-w-2xl mb-8"
      />

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
          <SizePicker sizes={sizes} value={size} onChange={setSize} label={sizeLabel} />
          <ColorPicker colors={colors} value={color} onChange={setColor} />

          {/* Pricing */}
          {breakdown && (
            <div className="border-t border-border pt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">{productName}</span>
                {/* When a back design is added its +$8 shows as its own line,
                    so the product line stays the front price. */}
                <span>
                  ${(backActive ? breakdown.item - BACK_PLACEMENT_UPCHARGE : breakdown.item).toFixed(2)}
                </span>
              </div>
              {backActive && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Back design</span>
                  <span>+${BACK_PLACEMENT_UPCHARGE.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-text-muted">Shipping</span>
                <span>${breakdown.shipping.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t border-border pt-2">
                <span>Total</span>
                <span>${breakdown.total.toFixed(2)}</span>
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
            {loading ? "Redirecting to checkout..." : "Buy now"}
          </Button>
          {cartShown && (
            <Button
              onClick={handleAddToCart}
              disabled={addingToCart}
              variant="secondary"
              className="hidden md:block w-full mt-3"
              size="lg"
            >
              {addingToCart ? "Adding…" : "Add to cart"}
            </Button>
          )}
        </div>
      </div>

      {/* Mobile sticky checkout bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-background border-t border-border p-4 space-y-2">
        <Button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full"
          size="lg"
        >
          {loading
            ? "Redirecting..."
            : breakdown
              ? `Buy now — $${breakdown.total.toFixed(2)}`
              : "Buy now"}
        </Button>
        {cartShown && (
          <Button
            onClick={handleAddToCart}
            disabled={addingToCart}
            variant="secondary"
            className="w-full"
            size="lg"
          >
            {addingToCart ? "Adding…" : "Add to cart"}
          </Button>
        )}
      </div>
    </div>
  );
}
