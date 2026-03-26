"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign } from "../design/actions";
import { calculatePrice, createCheckoutSession } from "./actions";
import Link from "next/link";

export default function OrderPage() {
  return (
    <Suspense>
      <OrderPageInner />
    </Suspense>
  );
}

const SIZES = ["S", "M", "L", "XL", "2XL"];
const SHIRT_COLORS: { name: string; value: string }[] = [
  { name: "White", value: "#ffffff" },
  { name: "Black", value: "#1a1a1a" },
  { name: "Navy", value: "#1e3a5f" },
  { name: "Dark Grey Heather", value: "#4a4a4a" },
  { name: "Red", value: "#b22222" },
  { name: "True Royal", value: "#2a5caa" },
  { name: "Forest", value: "#2d5a27" },
  { name: "Maroon", value: "#5a1a2a" },
  { name: "Heather Mauve", value: "#b08a9a" },
  { name: "Soft Cream", value: "#f5f0e1" },
  { name: "Steel Blue", value: "#4a7c9b" },
  { name: "Olive", value: "#5c6b3c" },
  { name: "Gold", value: "#d4a843" },
  { name: "Athletic Heather", value: "#c5c5c5" },
];
const QUALITIES: { value: "standard" | "premium"; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
];

function OrderPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const designId = searchParams.get("id");

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [size, setSize] = useState("M");
  const [color, setColor] = useState("White");
  const [quality, setQuality] = useState<"standard" | "premium">("standard");
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

  useEffect(() => {
    if (!designId) return;
    calculatePrice(designId, quality).then(setPricing);
  }, [designId, quality]);

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
    <div className="min-h-screen flex flex-col items-center py-12 px-4">
      {/* Breadcrumbs */}
      <nav className="w-full max-w-2xl mb-8 flex gap-2 text-sm text-gray-500">
        <Link href={`/design?id=${designId}`} className="hover:underline">
          Design
        </Link>
        <span>/</span>
        <Link href={`/preview?id=${designId}`} className="hover:underline">
          Preview
        </Link>
        <span>/</span>
        <span className="text-black font-medium">Order</span>
      </nav>

      <div className="w-full max-w-2xl grid md:grid-cols-2 gap-8">
        {/* Design preview */}
        <div className="flex flex-col items-center">
          {imageUrl && (
            <div className="w-64 h-64 bg-gray-100 rounded-lg flex items-center justify-center">
              <img
                src={imageUrl}
                alt="Your design"
                className="max-w-[90%] max-h-[90%] object-contain"
              />
            </div>
          )}
        </div>

        {/* Options */}
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Size</label>
            <div className="flex gap-2">
              {SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`px-3 py-1.5 border rounded-md text-sm ${
                    size === s
                      ? "border-black bg-black text-white"
                      : "border-gray-300 hover:border-gray-400"
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
            <div className="flex flex-wrap gap-2">
              {SHIRT_COLORS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setColor(c.name)}
                  className={`w-8 h-8 rounded-full border-2 ${
                    color === c.name ? "border-black ring-2 ring-offset-1 ring-black" : "border-gray-300"
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
                  className={`px-3 py-1.5 border rounded-md text-sm ${
                    quality === q.value
                      ? "border-black bg-black text-white"
                      : "border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pricing */}
          {pricing && (
            <div className="border-t pt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Shirt ({quality})</span>
                <span>${pricing.baseCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Design generation</span>
                <span>${pricing.generationCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t pt-2">
                <span>Total</span>
                <span>${pricing.total.toFixed(2)}</span>
              </div>
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={loading}
            className="w-full py-3 bg-black text-white rounded-md font-medium disabled:opacity-50"
          >
            {loading ? "Redirecting to checkout..." : "Checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}
