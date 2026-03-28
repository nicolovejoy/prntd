"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign, approveDesign } from "../design/actions";
import Link from "next/link";

export default function PreviewPage() {
  return (
    <Suspense>
      <PreviewPageInner />
    </Suspense>
  );
}

const SHIRT_COLORS = [
  { name: "White", value: "#ffffff" },
  { name: "Black", value: "#0c0c0c" },
  { name: "Dark Grey", value: "#2A2929" },
  { name: "Natural", value: "#fef1d1" },
  { name: "Tan", value: "#ddb792" },
  { name: "Soft Cream", value: "#e7d4c0" },
  { name: "Pebble", value: "#9a8479" },
  { name: "Heather Dust", value: "#e5d9c9" },
  { name: "Vintage White", value: "#fcf4e8" },
  { name: "Aqua", value: "#008db5" },
  { name: "Burnt Orange", value: "#ed8043" },
  { name: "Mustard", value: "#eda027" },
  { name: "Sage", value: "#9eab96" },
];

function PreviewPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const designId = searchParams.get("id");

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [shirtColor, setShirtColor] = useState("#ffffff");
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!designId) {
      router.push("/design");
      return;
    }
    getDesign(designId).then((design) => {
      if (design?.currentImageUrl) {
        setImageUrl(design.currentImageUrl);
      }
      setLoading(false);
    });
  }, [designId, router]);

  async function handleApprove() {
    if (!designId) return;
    await approveDesign(designId);
    router.push(`/order?id=${designId}`);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading preview...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4">
      {/* Breadcrumbs */}
      <nav className="w-full max-w-2xl mb-8 flex gap-2 text-sm text-gray-500">
        <Link href="/designs" className="hover:underline">
          My Designs
        </Link>
        <span>/</span>
        <Link href={`/design?id=${designId}`} className="hover:underline">
          Design
        </Link>
        <span>/</span>
        <span className="text-black font-medium">Preview</span>
        <span>/</span>
        <span>Order</span>
      </nav>

      <h1 className="text-2xl font-bold mb-8">Preview your shirt</h1>

      {/* Shirt mockup */}
      <div
        className="w-80 h-96 rounded-lg shadow-lg flex items-center justify-center relative transition-colors"
        style={{ backgroundColor: shirtColor }}
      >
        {/* Design on shirt — multiply blend makes white areas transparent */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-48 h-48 flex items-center justify-center">
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Your design"
                className="max-w-full max-h-full object-contain"
              />
            )}
          </div>
        </div>
      </div>

      {/* Color picker */}
      <div className="text-sm text-gray-400 mt-6 mb-2 h-5">
        {hoveredColor ?? SHIRT_COLORS.find((c) => c.value === shirtColor)?.name}
      </div>
      <div className="flex gap-3">
        {SHIRT_COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => setShirtColor(c.value)}
            onMouseEnter={() => setHoveredColor(c.name)}
            onMouseLeave={() => setHoveredColor(null)}
            className={`w-8 h-8 rounded-full border-2 ${
              shirtColor === c.value ? "border-black" : "border-gray-300"
            }`}
            style={{ backgroundColor: c.value }}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-4 mt-8">
        <Link
          href={`/design?id=${designId}`}
          className="px-6 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Refine design
        </Link>
        <button
          onClick={handleApprove}
          className="px-6 py-2 bg-black text-white rounded-md"
        >
          Order this shirt
        </button>
      </div>
    </div>
  );
}
