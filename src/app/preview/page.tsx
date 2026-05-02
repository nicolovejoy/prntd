"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign, approveDesign } from "../design/actions";
import { generateMockup, regenerateForPlacement } from "./actions";
import Link from "next/link";
import { Button } from "@/components/ui";
import {
  getProduct,
  getDefaultPlacement,
  needsAspectRegeneration,
  DEFAULT_PRODUCT_ID,
  PRODUCTS,
  type AspectRatio,
} from "@/lib/products";
import { ProductSilhouette } from "./product-silhouette";

const LOADING_MESSAGES = [
  "Rendering your design\u2026",
  "Placing design on product\u2026",
  "Almost there\u2026",
  "Adding finishing touches\u2026",
];

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
  // Tracks the aspect ratio of the current design image. Persisted in the
  // URL so refresh/bookmark of e.g. ?aspect=1:2 doesn't trigger a redundant
  // regeneration. Defaults to 1:1, the aspect every design is born at.
  const initialAspect = (searchParams.get("aspect") as AspectRatio | null) ?? "1:1";

  const [productId, setProductId] = useState(initialProductId);
  const product = getProduct(productId);

  const [designImageUrl, setDesignImageUrl] = useState<string | null>(null);
  const [currentAspect, setCurrentAspect] = useState<AspectRatio>(initialAspect);
  const [colorName, setColorName] = useState(product?.colors[0]?.name ?? "White");
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [mockupLoading, setMockupLoading] = useState(false);
  const [mockupError, setMockupError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [panOrigin, setPanOrigin] = useState({ x: 50, y: 50 });
  const [scale, setScale] = useState(1.0);

  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0);

  // Client-side cache: "productId:colorName:scale" → mockup R2 URL
  const mockupCache = useRef<Map<string, string>>(new Map());
  // Track the latest requested selection to discard stale responses
  const latestColorRef = useRef(colorName);
  const latestProductRef = useRef(productId);
  const latestAspectRef = useRef(currentAspect);
  // Monotonic counter for regen attempts. Only the latest attempt is
  // allowed to clear the regenerating spinner, so an earlier in-flight
  // regen (e.g. from a product the user already navigated away from)
  // can't accidentally cancel a newer one.
  const regenSeqRef = useRef(0);

  const colors = product?.colors ?? [];

  // Load design and seed mockup cache from DB. After load, kick off a
  // placement-aware regeneration if the URL's product/aspect combo doesn't
  // already fit — this handles the "shared link to a phone-case preview"
  // case where the stored image is still 1:1.
  useEffect(() => {
    if (!designId) {
      router.push("/design");
      return;
    }
    let canceled = false;
    getDesign(designId).then((design) => {
      if (canceled) return;
      if (design?.currentImageUrl) {
        setDesignImageUrl(design.currentImageUrl);
      }
      if (design?.mockupUrls) {
        for (const [key, url] of Object.entries(design.mockupUrls)) {
          mockupCache.current.set(key, url as string);
        }
      }
      setLoading(false);
      // Same regen path as a manual product change, using the URL's aspect
      // hint as the assumed source aspect.
      void maybeRegenerateForProduct(initialProductId, initialAspect);
    });
    return () => {
      canceled = true;
    };
    // Deliberately runs once for the initial design+product+aspect tuple.
    // Subsequent product changes are handled by handleProductChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId, router]);

  // Generate mockup on demand (called by "Preview on product" button)
  async function handlePreviewOnProduct() {
    if (!designId) return;

    const scaleKey = Math.round(scale * 100);
    const cacheKey = `${productId}:${colorName}:${scaleKey}`;

    // Check client cache first
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
      // Only apply if selections haven't changed
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

  // Auto-trigger the real Printful mockup whenever the underlying inputs
  // settle (initial load, color change, product change post-regen) and we
  // don't already have one. The mockup is the actual product render the
  // user will see in their order — making them click a button to see it
  // is friction we don't want before checkout.
  useEffect(() => {
    if (!designImageUrl) return;
    if (regenerating || mockupLoading || mockupUrl) return;
    // If the current image needs an aspect regen for this product, skip —
    // the regen path will set designImageUrl when done and we'll re-run
    // the effect against a correctly-shaped image. Avoids burning a Printful
    // mockup call on a soon-to-be-discarded image.
    const product = getProduct(productId);
    if (product) {
      const targetAspect = getDefaultPlacement(product).aspectRatio;
      if (needsAspectRegeneration(currentAspect, targetAspect)) return;
    }
    void handlePreviewOnProduct();
    // handlePreviewOnProduct closes over current state; the dep list captures
    // the inputs that determine whether a mockup is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designImageUrl, productId, colorName, regenerating, currentAspect]);

  function handleColorChange(name: string) {
    setColorName(name);
    latestColorRef.current = name;
    // Revert to client-side preview — user can hit "Preview on product" to render
    setMockupUrl(null);
    setMockupError(false);
    setMockupLoading(false);
  }

  // Regenerate the design image at the new placement aspect when needed.
  // Skips work when the current aspect already fits the target placement
  // (server also re-checks via needsAspectRegeneration as a guard).
  async function maybeRegenerateForProduct(
    newProductId: string,
    sourceAspect: AspectRatio
  ) {
    const newProduct = getProduct(newProductId);
    if (!designId || !newProduct) return;

    const targetAspect = getDefaultPlacement(newProduct).aspectRatio;
    if (!needsAspectRegeneration(sourceAspect, targetAspect)) return;

    const seq = ++regenSeqRef.current;
    setRegenerating(true);
    try {
      const result = await regenerateForPlacement(designId, newProductId, sourceAspect);
      // If a newer regen has been started, defer to it and don't touch
      // shared state (image URL, URL params, cache, spinner).
      if (seq !== regenSeqRef.current) return;
      if (result) {
        setDesignImageUrl(result.imageUrl);
        setCurrentAspect(result.aspectRatio);
        latestAspectRef.current = result.aspectRatio;
        router.replace(
          `/preview?id=${designId}&product=${newProductId}&aspect=${encodeURIComponent(result.aspectRatio)}`,
          { scroll: false }
        );
        mockupCache.current.clear();
      }
    } catch (err) {
      console.error("regenerateForPlacement failed:", err);
    } finally {
      // Only the latest regen owns the spinner. An earlier attempt that
      // happens to settle later must not flip it off — that would unmask
      // a stale state and let the user click Order while the real regen
      // is still in flight.
      if (seq === regenSeqRef.current) {
        setRegenerating(false);
      }
    }
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
    // Revert to client-side preview
    setMockupUrl(null);
    setMockupError(false);
    setMockupLoading(false);

    router.replace(
      `/preview?id=${designId}&product=${newProductId}&aspect=${encodeURIComponent(currentAspect)}`,
      { scroll: false }
    );

    // Kick off a re-render at the new placement aspect if the current
    // image's shape doesn't fit. Fire-and-forget; the UI shows a banner.
    void maybeRegenerateForProduct(newProductId, currentAspect);
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
            className={`flex-1 px-3 py-2 rounded-lg border-2 text-left transition-colors ${
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

      {/* Color picker — above the preview, hidden when product has only one color */}
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
              screen — users shouldn't reach checkout without seeing what
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
