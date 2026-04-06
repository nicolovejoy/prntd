"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign } from "../design/actions";
import { calculatePrice, createCheckoutSession } from "./actions";
import Link from "next/link";
import { Button } from "@/components/ui";
import { SHIRT_COLORS } from "@/lib/colors";

export default function OrderPage() {
  return (
    <Suspense>
      <OrderPageInner />
    </Suspense>
  );
}

const SIZES = ["S", "M", "L", "XL", "2XL"];
const QUALITIES: { value: "standard" | "premium"; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
];

function OrderPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const designId = searchParams.get("id");

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mockupUrls, setMockupUrls] = useState<Record<string, string> | null>(null);
  const [size, setSize] = useState(searchParams.get("size") ?? "M");
  const [color, setColor] = useState(searchParams.get("color") ?? "White");
  const [quality, setQuality] = useState<"standard" | "premium">(
    (searchParams.get("quality") as "standard" | "premium") ?? "standard"
  );
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
      if (design?.mockupUrls) setMockupUrls(design.mockupUrls);
    });
  }, [designId, router]);

  useEffect(() => {
    if (!designId) return;
    calculatePrice(designId, quality).then(setPricing);
  }, [designId, quality]);

  // Sync selections to URL so they survive Stripe cancel → back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("size", size);
    params.set("color", color);
    params.set("quality", quality);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);
  }, [size, color, quality]);

  async function handleCheckout() {
    if (!designId) return;
    setLoading(true);
    try {
      const { url } = await createCheckoutSession({
        designId,
        size,
        color,
        quality,
      });
      if (url) window.location.href = url;
    } catch {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center py-6 md:py-12 px-4 pb-24 md:pb-12">
      {/* Breadcrumbs — hidden on mobile */}
      <nav className="hidden md:flex w-full max-w-2xl mb-8 gap-2 text-sm text-gray-500">
        <Link href={`/design?id=${designId}`} className="hover:underline">
          Design
        </Link>
        <span>/</span>
        <Link href={`/preview?id=${designId}`} className="hover:underline">
          Preview
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">Order</span>
      </nav>

      <div className="w-full max-w-2xl grid md:grid-cols-2 gap-6 md:gap-8">
        {/* Design preview — compact on mobile */}
        <div className="flex flex-col items-center">
          {mockupUrls?.[color] ? (
            <div className="w-40 h-40 md:w-full md:aspect-square rounded-lg overflow-hidden">
              <img
                src={mockupUrls[color]}
                alt={`Your design on a ${color} shirt`}
                className="w-full h-full object-cover"
              />
            </div>
          ) : imageUrl ? (
            <div
              className="w-40 h-40 md:w-full md:aspect-square rounded-lg flex items-center justify-center transition-colors"
              style={{ backgroundColor: SHIRT_COLORS.find((c) => c.name === color)?.value ?? "#f3f4f6" }}
            >
              <img
                src={imageUrl}
                alt="Your design"
                className="max-w-[80%] max-h-[80%] object-contain"
              />
            </div>
          ) : null}
        </div>

        {/* Options */}
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Size</label>
            <div className="flex gap-2">
              {SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`flex-1 md:flex-none px-3 py-2.5 md:py-1.5 border-2 rounded-md text-sm transition-colors ${
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

          <div>
            <label className="block text-sm font-medium mb-2">
              Color — {color}
            </label>
            <div className="flex flex-wrap gap-2.5 md:gap-2">
              {SHIRT_COLORS.map((c) => (
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

          <div>
            <label className="block text-sm font-medium mb-2">Quality</label>
            <div className="flex gap-2">
              {QUALITIES.map((q) => (
                <button
                  key={q.value}
                  onClick={() => setQuality(q.value)}
                  className={`flex-1 md:flex-none px-3 py-2.5 md:py-1.5 border-2 rounded-md text-sm transition-colors ${
                    quality === q.value
                      ? "border-accent bg-accent text-accent-fg font-medium"
                      : "border-border text-text-muted hover:border-border-hover"
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pricing */}
          {pricing && (
            <div className="border-t border-border pt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Shirt ({quality})</span>
                <span>${pricing.baseCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Design generation</span>
                <span>${pricing.generationCost.toFixed(2)}</span>
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
