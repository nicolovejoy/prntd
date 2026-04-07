"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign, approveDesign } from "../design/actions";
import { generateMockup } from "./actions";
import Link from "next/link";
import { Button } from "@/components/ui";
import { getProduct, DEFAULT_PRODUCT_ID, PRODUCTS } from "@/lib/products";

export default function PreviewPage() {
  return (
    <Suspense>
      <PreviewPageInner />
    </Suspense>
  );
}

function PreviewPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const designId = searchParams.get("id");
  const initialProductId = searchParams.get("product") ?? DEFAULT_PRODUCT_ID;

  const [productId, setProductId] = useState(initialProductId);
  const product = getProduct(productId);

  const [designImageUrl, setDesignImageUrl] = useState<string | null>(null);
  const [colorName, setColorName] = useState(product?.colors[0]?.name ?? "White");
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [mockupLoading, setMockupLoading] = useState(false);
  const [mockupError, setMockupError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [panOrigin, setPanOrigin] = useState({ x: 50, y: 50 });

  // Client-side cache: "productId:colorName" → mockup R2 URL
  const mockupCache = useRef<Map<string, string>>(new Map());
  // Track the latest requested color to discard stale responses
  const latestColorRef = useRef(colorName);

  const colors = product?.colors ?? [];

  // Load design and seed mockup cache from DB
  useEffect(() => {
    if (!designId) {
      router.push("/design");
      return;
    }
    getDesign(designId).then((design) => {
      if (design?.currentImageUrl) {
        setDesignImageUrl(design.currentImageUrl);
      }
      // Seed cache from previously generated mockups (keyed as "productId:colorName")
      if (design?.mockupUrls) {
        for (const [key, url] of Object.entries(design.mockupUrls)) {
          mockupCache.current.set(key, url as string);
        }
      }
      setLoading(false);
    });
  }, [designId, router]);

  // Generate or retrieve mockup when color or product changes
  const loadMockup = useCallback(
    async (color: string, forProductId: string = productId) => {
      if (!designId) return;

      latestColorRef.current = color;
      const cacheKey = `${forProductId}:${color}`;

      // Check client cache first
      const cached = mockupCache.current.get(cacheKey);
      if (cached) {
        setMockupUrl(cached);
        setMockupError(false);
        return;
      }

      // Generate via server action
      setMockupLoading(true);
      setMockupError(false);
      try {
        const result = await generateMockup(designId, color, forProductId);
        // Only apply if this is still the color the user wants
        if (latestColorRef.current === color) {
          mockupCache.current.set(cacheKey, result.mockupUrl);
          setMockupUrl(result.mockupUrl);
        }
      } catch (err) {
        console.error("Mockup generation failed:", err);
        if (latestColorRef.current === color) {
          setMockupError(true);
        }
      } finally {
        if (latestColorRef.current === color) {
          setMockupLoading(false);
        }
      }
    },
    [designId, productId]
  );

  // Trigger mockup generation once design is loaded
  useEffect(() => {
    if (!loading && designImageUrl) {
      loadMockup(colorName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, designImageUrl]);

  function handleColorChange(name: string) {
    setColorName(name);
    loadMockup(name);
  }

  function handleProductChange(newProductId: string) {
    if (newProductId === productId) return;
    const newProduct = getProduct(newProductId);
    if (!newProduct) return;
    const newColor = newProduct.colors[0]?.name ?? "White";
    setProductId(newProductId);
    setColorName(newColor);
    setMockupUrl(null);
    setMockupError(false);
    loadMockup(newColor, newProductId);
    router.replace(`/preview?id=${designId}&product=${newProductId}`, { scroll: false });
  }

  async function handleApprove() {
    if (!designId) return;
    await approveDesign(designId);
    router.push(
      `/order?id=${designId}&color=${encodeURIComponent(colorName)}&product=${productId}`
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading preview...
      </div>
    );
  }

  const colorHex =
    colors.find((c) => c.name === colorName)?.value ?? "#ffffff";
  const productName = product?.name ?? "design";

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

      <h1 className="text-xl md:text-2xl font-bold mb-4 md:mb-6">
        Preview your {productName}
      </h1>

      {/* Product selector */}
      <div className="flex gap-2 md:gap-3 mb-4 md:mb-6 w-full max-w-md justify-center">
        {PRODUCTS.map((p) => (
          <button
            key={p.id}
            onClick={() => handleProductChange(p.id)}
            disabled={mockupLoading}
            className={`flex-1 px-3 py-2 rounded-lg border-2 text-left transition-colors ${
              productId === p.id
                ? "border-accent ring-2 ring-accent ring-offset-1 ring-offset-background"
                : "border-border hover:border-text-muted"
            } ${mockupLoading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <div className="text-sm font-medium truncate">{p.name}</div>
            <div className="text-xs text-text-muted truncate hidden md:block">
              {p.description}
            </div>
          </button>
        ))}
      </div>

      {/* Mockup */}
      <button
        type="button"
        onClick={() => mockupUrl && !mockupLoading && setLightboxOpen(true)}
        className={`w-64 h-80 md:w-80 md:h-96 rounded-lg shadow-lg overflow-hidden relative ${
          mockupUrl && !mockupLoading ? "cursor-zoom-in" : ""
        }`}
      >
        {mockupLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-alt animate-pulse z-10">
            <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
            <span className="text-sm text-text-muted">
              Generating mockup...
            </span>
          </div>
        )}

        {!mockupLoading && mockupError && (
          <div
            className="w-full h-full flex items-center justify-center transition-colors"
            style={{ backgroundColor: colorHex }}
          >
            <div className="w-40 h-40 md:w-48 md:h-48 flex items-center justify-center">
              {designImageUrl && (
                <img
                  src={designImageUrl}
                  alt="Your design"
                  className="max-w-full max-h-full object-contain"
                />
              )}
            </div>
          </div>
        )}

        {!mockupLoading && !mockupError && mockupUrl && (
          <img
            src={mockupUrl}
            alt={`Your design on a ${colorName} ${productName}`}
            className="w-full h-full object-cover"
          />
        )}

        {!mockupLoading && !mockupError && !mockupUrl && (
          <div
            className="w-full h-full flex items-center justify-center transition-colors"
            style={{ backgroundColor: colorHex }}
          >
            <div className="w-40 h-40 md:w-48 md:h-48 flex items-center justify-center">
              {designImageUrl && (
                <img
                  src={designImageUrl}
                  alt="Your design"
                  className="max-w-full max-h-full object-contain"
                />
              )}
            </div>
          </div>
        )}
      </button>

      {/* Fullscreen lightbox with zoom + pan */}
      {lightboxOpen && mockupUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setLightboxOpen(false);
              setZoomed(false);
              setPanOrigin({ x: 50, y: 50 });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setLightboxOpen(false);
              setZoomed(false);
              setPanOrigin({ x: 50, y: 50 });
            }
          }}
          role="dialog"
          aria-label="Mockup fullscreen view"
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] overflow-hidden cursor-zoom-in"
            onClick={(e) => {
              e.stopPropagation();
              if (!zoomed) {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;
                setPanOrigin({ x, y });
                setZoomed(true);
              } else {
                setZoomed(false);
                setPanOrigin({ x: 50, y: 50 });
              }
            }}
            onMouseMove={(e) => {
              if (!zoomed) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * 100;
              const y = ((e.clientY - rect.top) / rect.height) * 100;
              setPanOrigin({ x, y });
            }}
          >
            <img
              src={mockupUrl}
              alt={`Your design on a ${colorName} ${productName}`}
              className="max-w-[90vw] max-h-[90vh] object-contain transition-transform duration-200"
              style={{
                transform: zoomed ? "scale(2.5)" : "scale(1)",
                transformOrigin: `${panOrigin.x}% ${panOrigin.y}%`,
              }}
              draggable={false}
            />
          </div>
          <button
            onClick={() => {
              setLightboxOpen(false);
              setZoomed(false);
              setPanOrigin({ x: 50, y: 50 });
            }}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>
      )}

      {/* Color picker — hidden when product has only one color */}
      {colors.length > 1 && (
        <>
          <div className="text-sm text-text-muted mt-4 md:mt-6 mb-2 h-5">
            {hoveredColor ?? colorName}
          </div>
          <div className="flex flex-wrap justify-center gap-2 md:gap-3 max-w-xs md:max-w-none">
            {colors.map((c) => (
              <button
                key={c.name}
                onClick={() => handleColorChange(c.name)}
                onMouseEnter={() => setHoveredColor(c.name)}
                onMouseLeave={() => setHoveredColor(null)}
                disabled={mockupLoading}
                className={`w-10 h-10 md:w-8 md:h-8 rounded-full border-2 transition-colors ${
                  colorName === c.name
                    ? "border-accent ring-2 ring-accent ring-offset-1 ring-offset-background"
                    : "border-border"
                } ${mockupLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex gap-4 mt-6 md:mt-8 w-full max-w-xs md:max-w-none md:w-auto">
        <Link href={`/design?id=${designId}`} className="flex-1 md:flex-none">
          <Button variant="secondary" className="w-full md:w-auto">
            Refine design
          </Button>
        </Link>
        <Button onClick={handleApprove} className="flex-1 md:flex-none">
          Order this {productName}
        </Button>
      </div>
    </div>
  );
}
