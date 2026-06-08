"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign, approveDesign, getDesignGallery } from "../design/actions";
import {
  generateMockup,
  getOrCreatePlacementRender,
  ensureMockupsPrefetched,
  isMultiPlacementEnabled,
} from "./actions";
import Link from "next/link";
import { Button } from "@/components/ui";
import {
  getProduct,
  DEFAULT_PRODUCT_ID,
  ACTIVE_PRODUCTS,
  productSupportsPlacement,
  type AspectRatio,
} from "@/lib/products";
import { BACK_PLACEMENT_UPCHARGE } from "@/lib/pricing";
import type { SourceImage } from "@/lib/design-images";
import { ProductSilhouette } from "./product-silhouette";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";

const LOADING_MESSAGES = [
  "Rendering your design…",
  "Placing design on product…",
  "Almost there…",
  "Adding finishing touches…",
];

type Placement = "front" | "back";

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
  // Bumped to re-run the placement-render effect (retry after an error).
  const [renderNonce, setRenderNonce] = useState(0);
  const [colorName, setColorName] = useState(product?.colors[0]?.name ?? "White");
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  // Mockup per placement. Front is the phone-first default; back is only
  // populated once the user opts in and picks a source image.
  const [mockups, setMockups] = useState<{ front: string | null; back: string | null }>({
    front: null,
    back: null,
  });
  const [mockupLoading, setMockupLoading] = useState(false);
  const [mockupError, setMockupError] = useState(false);
  const [hasPrimary, setHasPrimary] = useState<boolean | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [panOrigin, setPanOrigin] = useState({ x: 50, y: 50 });
  const [scale, setScale] = useState(1.0);

  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0);

  // Multi-placement (#25). Off-by-default flag keeps the back UI dark in
  // prod; when off, activePlacement never leaves "front" so the whole flow
  // is byte-identical to the single-placement version.
  const [multiPlacement, setMultiPlacement] = useState(false);
  const [activePlacement, setActivePlacement] = useState<Placement>("front");
  const [backImageId, setBackImageId] = useState<string | null>(null);
  const [backSources, setBackSources] = useState<SourceImage[] | null>(null);
  const [backPickerOpen, setBackPickerOpen] = useState(false);

  // Client-side cache: "productId:placement:colorName:scale" -> mockup R2 URL
  const mockupCache = useRef<Map<string, string>>(new Map());
  // Track the latest requested selection so a stale Printful response
  // (color clicked, then changed) can't overwrite the current one.
  const latestColorRef = useRef(colorName);
  const latestProductRef = useRef(productId);
  const latestPlacementRef = useRef<Placement>(activePlacement);

  const colors = product?.colors ?? [];
  const regenerating = renderState.status === "loading";
  const designImageUrl = renderState.status === "ready" ? renderState.imageUrl : null;
  const activeMockup = mockups[activePlacement];
  const showBackToggle =
    multiPlacement && !!product && productSupportsPlacement(product, "back");
  // Show the source picker in place of the hero when on Back with no source
  // yet, or when the user reopened it to swap the back image.
  const showBackPicker =
    activePlacement === "back" && (!backImageId || backPickerOpen);

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
        // Warm the mockup cache for this product if nothing's been
        // prefetched yet — covers existing/already-approved designs that
        // never went through approveDesign's after() prefetch hook.
        // Best-effort; no-op when the cache is already populated.
        ensureMockupsPrefetched(designId, productId).catch((err) =>
          console.warn("ensureMockupsPrefetched failed:", err)
        );
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

  // Read the multi-placement kill-switch once on mount (server-only env).
  useEffect(() => {
    isMultiPlacementEnabled()
      .then(setMultiPlacement)
      .catch(() => setMultiPlacement(false));
  }, []);

  // Resolve the design image to render for the current
  // (designId, productId, activePlacement, backImageId). The server returns
  // either a cached design_image row or a fresh anchored render. State derives
  // from the in-flight call -- the cleanup cancels stale resolutions.
  useEffect(() => {
    if (!designId || !hasPrimary) return;
    // Back with no source yet: nothing to render — the hero shows the
    // source picker instead. Don't fetch.
    if (activePlacement === "back" && !backImageId) {
      setRenderState({ status: "idle" });
      return;
    }
    let canceled = false;
    setRenderState({ status: "loading" });
    const placement = activePlacement;
    const resolve =
      placement === "back"
        ? getOrCreatePlacementRender(designId, productId, "back", backImageId!)
        : getOrCreatePlacementRender(designId, productId);
    resolve
      .then((result) => {
        if (canceled) return;
        setRenderState({
          status: "ready",
          imageUrl: result.imageUrl,
          aspectRatio: result.aspectRatio,
        });
        // Fresh placement render invalidates client mockup entries for this
        // product + placement. Server clears DB mockupUrls on insert.
        const prefix = `${productId}:${placement}:`;
        for (const key of [...mockupCache.current.keys()]) {
          if (key.startsWith(prefix)) mockupCache.current.delete(key);
        }
        setMockups((m) => ({ ...m, [placement]: null }));
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
  }, [designId, productId, hasPrimary, renderNonce, activePlacement, backImageId]);

  // Generate mockup for a placement on demand (called by the auto-trigger
  // effect). Caches per productId:placement:color:scale.
  async function renderMockupFor(placement: Placement) {
    if (!designId) return;

    // Non-front placements render from the picked source; thread it through so
    // the mockup matches the pick and the cache key doesn't collide (#25).
    const sourceImageId = placement === "back" ? backImageId ?? undefined : undefined;
    const scaleKey = Math.round(scale * 100);
    // Key must match the server's cache key (#25 2.1): front stays
    // product:placement:color:scale; non-front inserts the source pick.
    const cacheKey = sourceImageId
      ? `${productId}:${placement}:${sourceImageId}:${colorName}:${scaleKey}`
      : `${productId}:${placement}:${colorName}:${scaleKey}`;

    const cached = mockupCache.current.get(cacheKey);
    if (cached) {
      setMockups((m) => ({ ...m, [placement]: cached }));
      setMockupError(false);
      return;
    }

    setMockupLoading(true);
    setMockupError(false);
    setMockups((m) => ({ ...m, [placement]: null }));
    const stillCurrent = () =>
      latestColorRef.current === colorName &&
      latestProductRef.current === productId &&
      latestPlacementRef.current === placement;
    try {
      const result = await generateMockup(
        designId,
        colorName,
        productId,
        scale,
        placement,
        sourceImageId
      );
      if (stillCurrent()) {
        mockupCache.current.set(cacheKey, result.mockupUrl);
        setMockups((m) => ({ ...m, [placement]: result.mockupUrl }));
      }
    } catch (err) {
      console.error("Mockup generation failed:", err);
      if (stillCurrent()) setMockupError(true);
    } finally {
      if (stillCurrent()) setMockupLoading(false);
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

  // Auto-trigger the real Printful mockup whenever the active placement's
  // render settles (initial load, color/product change, placement switch).
  useEffect(() => {
    if (!designImageUrl) return;
    if (regenerating || mockupLoading || mockups[activePlacement]) return;
    void renderMockupFor(activePlacement);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designImageUrl, productId, colorName, activePlacement, regenerating]);

  function handleColorChange(name: string) {
    setColorName(name);
    latestColorRef.current = name;
    // A new color invalidates both placements' mockups.
    setMockups({ front: null, back: null });
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
    // Reset to front: the new product may not support back, and back
    // renders are product-specific. Keep backImageId (a thread source id).
    setActivePlacement("front");
    latestPlacementRef.current = "front";
    setBackPickerOpen(false);
    setMockups({ front: null, back: null });
    setMockupError(false);
    setMockupLoading(false);

    router.replace(
      `/preview?id=${designId}&product=${newProductId}`,
      { scroll: false }
    );
  }

  function switchPlacement(placement: Placement) {
    if (placement === activePlacement) return;
    setActivePlacement(placement);
    latestPlacementRef.current = placement;
    setMockupError(false);
    setMockupLoading(false);
    if (placement === "back" && !backImageId) {
      // Lazy-load the source picker the first time Back is opened.
      void openBackPicker();
    }
  }

  async function openBackPicker() {
    setBackPickerOpen(true);
    if (backSources || !designId) return;
    try {
      const { sources } = await getDesignGallery(designId);
      setBackSources(sources);
    } catch (err) {
      console.error("getDesignGallery failed:", err);
      setBackSources([]);
    }
  }

  function chooseBackSource(id: string) {
    setBackImageId(id);
    setBackPickerOpen(false);
    // New back source invalidates the back mockup only.
    setMockups((m) => ({ ...m, back: null }));
    setMockupError(false);
    setMockupLoading(false);
  }

  async function handleApprove() {
    if (!designId) return;
    await approveDesign(designId);
    const backParam =
      multiPlacement && backImageId ? `&back=${backImageId}` : "";
    router.push(
      `/order?id=${designId}&color=${encodeURIComponent(colorName)}&product=${productId}${backParam}`
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
  // Approve needs the front mockup; a chosen back also needs its mockup.
  const approveReady =
    !!mockups.front && (!backImageId || !!mockups.back);

  return (
    <div className="min-h-screen flex flex-col items-center py-6 md:py-12 px-4">
      <Breadcrumbs
        trail={breadcrumbTrail("/preview", {
          id: designId ?? undefined,
          product: productId,
        })}
        current="Preview"
        className="w-full max-w-2xl mb-8"
      />

      <h1 className="text-xl md:text-2xl font-bold mb-4 md:mb-6">
        Preview your {productName}
      </h1>

      {/* Product selector */}
      <div className="flex gap-2 md:gap-3 mb-4 md:mb-6 w-full max-w-md justify-center">
        {ACTIVE_PRODUCTS.map((p) => (
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

      {/* Front / Back toggle (#25) — only when the flag is on and the product
          offers a back placement. Front stays the required default. */}
      {showBackToggle && (
        <div className="flex flex-col items-center gap-1 mb-4 md:mb-6">
          <div className="inline-flex rounded-lg border-2 border-border overflow-hidden">
            {(["front", "back"] as const).map((pl) => (
              <button
                key={pl}
                onClick={() => switchPlacement(pl)}
                disabled={regenerating || mockupLoading}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  activePlacement === pl
                    ? "bg-accent text-accent-fg"
                    : "text-text-muted hover:text-foreground"
                }`}
              >
                {pl}
              </button>
            ))}
          </div>
          {activePlacement === "back" && (
            <span className="text-xs text-text-muted">
              Back design +${BACK_PLACEMENT_UPCHARGE.toFixed(2)}
            </span>
          )}
        </div>
      )}

      {/* Hero: back-source picker (Back, no source) or the mockup/preview */}
      {showBackPicker ? (
        <div className="w-64 md:w-80 flex flex-col items-center gap-3">
          <p className="text-sm text-text-muted text-center">
            Pick an image from this design to print on the back.
          </p>
          {backSources === null ? (
            <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          ) : backSources.length === 0 ? (
            <p className="text-sm text-text-faint text-center">
              No images yet. <Link href={`/design?id=${designId}`} className="underline">Add one in the designer.</Link>
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 w-full">
              {backSources.map((s) => (
                <button
                  key={s.id}
                  onClick={() => chooseBackSource(s.id)}
                  className="aspect-square rounded-md overflow-hidden border-2 border-border hover:border-accent bg-checkerboard"
                >
                  <img
                    src={s.imageUrl}
                    alt="Design option"
                    className="w-full h-full object-contain"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => activeMockup && !mockupLoading && setLightboxOpen(true)}
          className={`w-64 h-80 md:w-80 md:h-96 rounded-lg shadow-lg overflow-hidden relative ${
            activeMockup && !mockupLoading ? "cursor-zoom-in" : ""
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

          {renderState.status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-alt z-20 px-4 text-center">
              <span className="text-sm text-text-muted">
                Couldn&rsquo;t prepare your design for the {productName}.
              </span>
              <span className="text-xs text-text-faint">
                Use “Try again” below.
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

          {!mockupLoading && activeMockup && (
            <img
              src={activeMockup}
              alt={`Your design on a ${colorName} ${productName}`}
              className="w-full h-full object-cover"
            />
          )}

          {!mockupLoading && !activeMockup && (
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
      )}

      {/* Change-image affordance once a back source is chosen */}
      {showBackToggle && activePlacement === "back" && backImageId && !backPickerOpen && (
        <button
          onClick={openBackPicker}
          className="text-sm text-text-muted hover:text-foreground hover:underline mt-3"
        >
          Change back image
        </button>
      )}

      {/* Scale slider */}
      {!showBackPicker && !mockupLoading && !activeMockup && (
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
      {lightboxOpen && activeMockup && (
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
              src={activeMockup}
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
          {renderState.status === "error" ? (
            <Button
              onClick={() => setRenderNonce((n) => n + 1)}
              variant="secondary"
              className="flex-1 md:flex-none"
            >
              Try again
            </Button>
          ) : mockupError ? (
            <Button
              onClick={() => renderMockupFor(activePlacement)}
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
              disabled={regenerating || mockupLoading || !approveReady}
            >
              {regenerating
                ? "Preparing design…"
                : mockupLoading || !approveReady
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
