"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign, approveDesign } from "../design/actions";
import { generateMockup, getOrCreatePlacementRender } from "./actions";
import Link from "next/link";
import { Button } from "@/components/ui";
import {
  getProduct,
  DEFAULT_PRODUCT_ID,
  PRODUCTS,
  type AspectRatio,
} from "@/lib/products";
import { ProductSilhouette } from "./product-silhouette";

const LOADING_MESSAGES = [
  "Rendering your design…",
  "Placing design on product…",
  "Almost there…",
  "Adding finishing touches…",
];

// Discriminated union: the placement render is the single source of
// truth for what's on screen. Drives both the design image and the
// "preparing your design" spinner via derivation, no seq-guard.
type RenderState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; imageUrl: string; aspectRatio: AspectRatio }
  | { status: "error"; message: string };

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

  const [renderState, setRenderState] = useState<RenderState>({ status: "idle" });
  const [colorName, setColorName] = useState(product?.colors[0]?.name ?? "White");
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [mockupLoading, setMockupLoading] = useState(false);
  const [mockupError, setMockupError] = useState(false);
  const [hasPrimary, setHasPrimary] = useState<boolean | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [panOrigin, setPanOrigin] = useState({ x: 50, y: 50 });
  const [scale, setScale] = useState(1.0);

  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0);

  // Client-side cache: "productId:colorName:scale" -> mockup R2 URL
  const mockupCache = useRef<Map<string, string>>(new Map());
  // Track the latest requested selection so a stale Printful response
  // (color clicked, then changed) can't overwrite the current one.
  const latestColorRef = useRef(colorName);
  const latestProductRef = useRef(productId);

  const colors = product?.colors ?? [];
  const regenerating = renderState.status === "loading";
  const designImageUrl = renderState.status === "ready" ? renderState.imageUrl : null;

  // Load design once. Confirms primary_image_id exists (else send the
  // user back to /design to pick one) and seeds the client mockup cache
  // from the DB-cached entries.
  useEffect(() => {
    if (!designId) {
      router.push("/design");
      return;
    }
    let canceled = false;
    getDesign(designId)
      .then((design) => {
        if (canceled) return;
        if (!design?.primaryImageId) {
          router.push(`/design?id=${designId}`);
          return;
        }
        setHasPrimary(true);
        if (design.mockupUrls) {
          for (const [key, url] of Object.entries(design.mockupUrls)) {
            mockupCache.current.set(key, url as string);
          }
        }
      })
      .catch((err) => {
        if (canceled) return;
        console.error("getDesign failed:", err);
        setHasPrimary(false);
      });
    return () => {
      canceled = true;
    };
  }, [designId, router]);

  // Resolve the design image to render for the current (designId, productId).
  // The server returns either a cached design_image row or a fresh anchored
  // render. State derives from the in-flight call -- the cleanup function
  // cancels stale resolutions, replacing the old seq-guard ref pattern.
  useEffect(() => {
    if (!designId || !hasPrimary) return;
    let canceled = false;
    setRenderState({ status: "loading" });
    getOrCreatePlacementRender(designId, productId)
      .then((result) => {
        if (canceled) return;
        setRenderState({
          status: "ready",
          imageUrl: result.imageUrl,
          aspectRatio: result.aspectRatio,
        });
        // Fresh placement render invalidates client mockup entries for
        // this product. Server clears DB mockupUrls on insert.
        for (const key of [...mockupCache.current.keys()]) {
          if (key.startsWith(`${productId}:`)) mockupCache.current.delete(key);
        }
        setMockupUrl(null);
        setMockupError(false);
      })
      .catch((err) => {
        if (canceled) return;
        console.error("getOrCreatePlacementRender failed:", err);
        setRenderState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      canceled = true;
    };
  }, [designId, productId, hasPrimary]);

  // Generate mockup on demand (called by "Preview on product" effect)
  async function handlePreviewOnProduct() {
    if (!designId) return;

    const scaleKey = Math.round(scale * 100);
    const cacheKey = `${productId}:${colorName}:${scaleKey}`;

    const cached = mockupCache.current.get(cacheKey);
    if (cached) {
      setMockupUrl(cached);
      setMockupError(false);
      return;
    }

    setMockupLoading(true);
    setMockupError(false);
    setMockupUrl(null);
    try {
      const result = await generateMockup(designId, colorName, productId, scale);
      if (latestColorRef.current === colorName && latestProductRef.current === productId) {
        mockupCache.current.set(cacheKey, result.mockupUrl);
        setMockupUrl(result.mockupUrl);
      }
    } catch (err) {
      console.error("Mockup generation failed:", err);
      if (latestColorRef.current === colorName && latestProductRef.current === productId) {
        setMockupError(true);
      }
    } finally {
      if (latestColorRef.current === colorName && latestProductRef.current === productId) {
        setMockupLoading(false);
      }
    }
  }

  // Rotate loading messages while mockup generates
  useEffect(() => {
    if (!mockupLoading) {
      setLoadingMessageIdx(0);
      return;
    }
    const timer = setInterval(() => {
      setLoadingMessageIdx((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [mockupLoading]);

  // Auto-trigger the real Printful mockup whenever the placement render
  // settles (initial load, color change, product change). The mockup is
  // the actual product render the user will see in their order.
  useEffect(() => {
    if (!designImageUrl) return;
    if (regenerating || mockupLoading || mockupUrl) return;
    void handlePreviewOnProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designImageUrl, productId, colorName, regenerating]);

  function handleColorChange(name: string) {
    setColorName(name);
    latestColorRef.current = name;
    setMockupUrl(null);
    setMockupError(false);
    setMockupLoading(false);
  }

  function handleProductChange(newProductId: string) {
    if (newProductId === productId) return;
    const newProduct = getProduct(newProductId);
    if (!newProduct) return;
    const newColor = newProduct.colors[0]?.name ?? "White";
    setProductId(newProductId);
    latestProductRef.current = newProductId;
    setColorName(newColor);
    latestColorRef.current = newColor;
    setMockupUrl(null);
    setMockupError(false);
    setMockupLoading(false);

    router.replace(
      `/preview?id=${designId}&product=${newProductId}`,
      { scroll: false }
    );
  }

  async function handleApprove() {
    if (!designId) return;
    await approveDesign(designId);
    router.push(
      `/order?id=${designId}&color=${encodeURIComponent(colorName)}&product=${productId}`
    );
  }

  if (hasPrimary === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading preview...
      </div>
    );
  }

  if (hasPrimary === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p>Couldn&apos;t load this design.</p>
        <Link href="/designs" className="underline">My Designs</Link>
      </div>
    );
  }

  const colorHex =
    colors.find((c) => c.name === colorName)?.value ?? "#ffffff";
  const productName = product?.name ?? "design";

  return (
    <div className="min-h-screen flex flex-col items-center py-6 md:py-12 px-4">
      {/* Breadcrumbs -- hidden on mobile to save space */}
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
            disabled={regenerating || mockupLoading}
            className={`flex-1 px-3 py-2 rounded-lg border-2 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              productId === p.id
                ? "border-accent ring-2 ring-accent ring-offset-1 ring-offset-background"
                : "border-border hover:border-text-muted"
            }`}
          >
            <div className="text-sm font-medium truncate">{p.name}</div>
            <div className="text-xs text-text-muted truncate hidden md:block">
              {p.description}
            </div>
          </button>
        ))}
      </div>

      {/* Color picker -- above the preview, hidden when product has only one color */}
      {colors.length > 1 && (
        <>
          <div className="text-sm text-text-muted mb-2 h-5">
            {hoveredColor ?? colorName}
          </div>
          <div className="flex flex-wrap justify-center gap-2 md:gap-3 max-w-xs md:max-w-none mb-4 md:mb-6">
            {colors.map((c) => (
              <button
                key={c.name}
                onClick={() => handleColorChange(c.name)}
                onMouseEnter={() => setHoveredColor(c.name)}
                onMouseLeave={() => setHoveredColor(null)}
                className={`w-10 h-10 md:w-8 md:h-8 rounded-full border-2 transition-colors ${
                  colorName === c.name
                    ? "border-accent ring-2 ring-accent ring-offset-1 ring-offset-background"
                    : "border-border"
                }`}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        </>
      )}

      {/* Mockup / Client-side preview */}
      <button
        type="button"
        onClick={() => mockupUrl && !mockupLoading && setLightboxOpen(true)}
        className={`w-64 h-80 md:w-80 md:h-96 rounded-lg shadow-lg overflow-hidden relative ${
          mockupUrl && !mockupLoading ? "cursor-zoom-in" : ""
        }`}
      >
        {regenerating && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-alt animate-pulse z-20">
            <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
            <span className="text-sm text-text-muted text-center px-4">
              Preparing your design for the {productName}…
            </span>
          </div>
        )}

        {!regenerating && mockupLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-alt animate-pulse z-10">
            <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
            <span className="text-sm text-text-muted transition-opacity">
              {LOADING_MESSAGES[loadingMessageIdx]}
            </span>
          </div>
        )}

        {!mockupLoading && mockupUrl && (
          <img
            src={mockupUrl}
            alt={`Your design on a ${colorName} ${productName}`}
            className="w-full h-full object-cover"
          />
        )}

        {!mockupLoading && !mockupUrl && (
          <div className="w-full h-full p-2">
            <ProductSilhouette
              productType={product?.type ?? "shirt"}
              color={colorHex}
              designImageUrl={designImageUrl}
              scale={scale}
              printArea={product?.printArea ?? { width: 12, height: 16 }}
            />
          </div>
        )}
      </button>

      {/* Scale slider */}
      {!mockupLoading && !mockupUrl && (
        <div className="w-full max-w-xs mt-4">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>Design size</span>
            <span>{Math.round(scale * 100)}%</span>
          </div>
          <input
            type="range"
            min={30}
            max={100}
            value={Math.round(scale * 100)}
            onChange={(e) => setScale(Number(e.target.value) / 100)}
            className="w-full h-2 accent-accent"
          />
        </div>
      )}

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

      {/* Actions */}
      <div className="flex flex-col items-center gap-3 mt-6 md:mt-8 w-full max-w-xs md:max-w-none md:w-auto">
        <div className="flex gap-4 w-full md:w-auto">
          {/* The order CTA is gated on having a real Printful mockup on
              screen -- users shouldn't reach checkout without seeing what
              their product will actually look like. When the mockup
              errors, the same button becomes the retry. */}
          {mockupError ? (
            <Button
              onClick={handlePreviewOnProduct}
              variant="secondary"
              className="flex-1 md:flex-none"
              disabled={regenerating}
            >
              Retry preview
            </Button>
          ) : (
            <Button
              onClick={handleApprove}
              className="flex-1 md:flex-none"
              disabled={regenerating || mockupLoading || !mockupUrl}
            >
              {regenerating
                ? "Preparing design…"
                : mockupLoading || !mockupUrl
                  ? "Rendering preview…"
                  : `Use this design`}
            </Button>
          )}
        </div>
        {mockupError && (
          <p className="text-sm text-red-400 text-center">
            Couldn&apos;t render the preview.
          </p>
        )}
        <Link href={`/design?id=${designId}`} className="text-sm text-text-muted hover:text-foreground hover:underline">
          Refine design
        </Link>
      </div>
    </div>
  );
}
