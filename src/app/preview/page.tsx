"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign, approveDesign } from "../design/actions";
import Link from "next/link";
import { Button } from "@/components/ui";

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
    <div className="min-h-screen flex flex-col items-center py-6 md:py-12 px-4">
      {/* Breadcrumbs — hidden on mobile to save space */}
      <nav className="hidden md:flex w-full max-w-2xl mb-8 gap-2 text-sm text-gray-500">
        <Link href="/designs" className="hover:underline">
          My Designs
        </Link>
        <span>/</span>
        <Link href={`/design?id=${designId}`} className="hover:underline">
          Design
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">Preview</span>
        <span>/</span>
        <span>Order</span>
      </nav>

      <h1 className="text-xl md:text-2xl font-bold mb-4 md:mb-8">Preview your shirt</h1>

      {/* Shirt mockup */}
      <div
        className="w-64 h-80 md:w-80 md:h-96 rounded-lg shadow-lg flex items-center justify-center relative transition-colors"
        style={{ backgroundColor: shirtColor }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-40 h-40 md:w-48 md:h-48 flex items-center justify-center">
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
      <div className="text-sm text-text-muted mt-4 md:mt-6 mb-2 h-5">
        {hoveredColor ?? SHIRT_COLORS.find((c) => c.value === shirtColor)?.name}
      </div>
      <div className="flex flex-wrap justify-center gap-2 md:gap-3 max-w-xs md:max-w-none">
        {SHIRT_COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => setShirtColor(c.value)}
            onMouseEnter={() => setHoveredColor(c.name)}
            onMouseLeave={() => setHoveredColor(null)}
            className={`w-10 h-10 md:w-8 md:h-8 rounded-full border-2 transition-colors ${
              shirtColor === c.value ? "border-accent ring-2 ring-accent ring-offset-1 ring-offset-background" : "border-border"
            }`}
            style={{ backgroundColor: c.value }}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-4 mt-6 md:mt-8 w-full max-w-xs md:max-w-none md:w-auto">
        <Link href={`/design?id=${designId}`} className="flex-1 md:flex-none">
          <Button variant="secondary" className="w-full md:w-auto">Refine design</Button>
        </Link>
        <Button onClick={handleApprove} className="flex-1 md:flex-none">Order this shirt</Button>
      </div>
    </div>
  );
}
