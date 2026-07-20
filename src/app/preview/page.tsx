"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDesign } from "../design/actions";
import { calculatePrice, createCheckoutSession } from "../order/actions";
import { addToCart, isCartEnabled } from "../cart/actions";
import {
  generateMockup,
  getOrCreatePlacementRender,
  ensureMockupsPrefetched,
  isMultiPlacementEnabled,
  getBackDesignSources,
  getLastPurchaseDefaults,
} from "./actions";
import {
  resolveProductAndSize,
  resolveDefaultColor,
  type PurchaseDefaults,
} from "@/lib/purchase-defaults";
import Link from "next/link";
import { Button } from "@/components/ui";
import { SizePicker, ColorPicker } from "@/components/product-options";
import {
  getBlank,
  DEFAULT_BLANK_ID,
  ACTIVE_BLANKS,
  productSupportsPlacement,
  type AspectRatio,
} from "@/lib/blanks";
import { BACK_PLACEMENT_UPCHARGE, computeOrderTotal } from "@/lib/pricing";
import type { BackSourceGroup } from "@/lib/back-sources";
import { createLatestWins } from "@/lib/latest-wins";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import {
  isDarkShirt,
  mockupBackdrop,
  resolveHeroDisplay,
} from "@/lib/instant-preview";

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
  const initialProductId = searchParams.get("product") ?? DEFAULT_BLANK_ID;
  // URL params as they were on arrival (§3 precedence: URL wins). Captured
  // once — the replaceState sync below rewrites the URL from state, so the
  // live params stop meaning "what the link carried".
  const initialUrl = useRef({
    product: searchParams.get("product"),
    size: searchParams.get("size"),
    color: searchParams.get("color"),
  }).current;

  const [productId, setProductId] = useState(initialProductId);
  const product = getBlank(productId);
  // Remembered defaults (#44) + the design's pinned backdrop color. Both
  // arrive async; they only fill selections the URL didn't set and the user
  // hasn't touched (the *Touched refs).
  const [remembered, setRemembered] = useState<PurchaseDefaults | null>(null);
  const [pinnedColor, setPinnedColor] = useState<string | null>(null);
  const productTouched = useRef(false);
  const colorTouched = useRef(false);

  const [renderState, setRenderState] = useState<RenderState>({ status: "idle" });
  // Bumped to re-run the placement-render effect (retry after an error).
  const [renderNonce, setRenderNonce] = useState(0);
  // Color/size initialize from the URL when valid (Stripe cancel → back, deep
  // links). No default size (#60): the buy CTAs stay disabled until a pick.
  const [colorName, setColorName] = useState(() => {
    const fromUrl = searchParams.get("color");
    const palette = product?.colors ?? [];
    return fromUrl && palette.some((c) => c.name === fromUrl)
      ? fromUrl
      : palette[0]?.name ?? "White";
  });
  const [size, setSize] = useState<string | null>(() => {
    const fromUrl = searchParams.get("size");
    return fromUrl && (product?.sizes ?? []).includes(fromUrl) ? fromUrl : null;
  });
  const [pricing, setPricing] = useState<{
    baseCost: number;
    generationCost: number;
    total: number;
  } | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  // Cart (#26 B3): show "Add to cart" alongside the buy CTA when CART_ENABLED.
  const [cartShown, setCartShown] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);
  // Mockup per placement. Front is the phone-first default; back is only
  // populated once the user opts in and picks a source image.
  const [mockups, setMockups] = useState<{ front: string | null; back: string | null }>({
    front: null,
    back: null,
  });
  const [mockupLoading, setMockupLoading] = useState(false);
  const [mockupError, setMockupError] = useState(false);
  // Most recent ready artwork per placement — keeps the instant
  // artwork-on-color layer populated while a product/color change
  // re-resolves the placement render (#57).
  const [lastArtwork, setLastArtwork] = useState<{
    front: string | null;
    back: string | null;
  }>({ front: null, back: null });
  // URL of the mockup image the browser has finished loading; drives the
  // crossfade from the instant layer to the exact Printful render.
  const [loadedMockupUrl, setLoadedMockupUrl] = useState<string | null>(null);
  const [hasPrimary, setHasPrimary] = useState<boolean | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [panOrigin, setPanOrigin] = useState({ x: 50, y: 50 });
  const [scale, setScale] = useState(1.0);

  // Multi-placement (#25). Off-by-default flag keeps the back UI dark in
  // prod; when off, activePlacement never leaves "front" so the whole flow
  // is byte-identical to the single-placement version.
  const [multiPlacement, setMultiPlacement] = useState(false);
  const [activePlacement, setActivePlacement] = useState<Placement>("front");
  // Back source from the URL, captured once on mount (Stripe cancel → back,
  // /order redirects). The URL-sync effect rewrites the query string, so
  // reading it live would race and drop it. A stray `?back=` stays inert
  // while the flag is off (`backActive` gates pricing/checkout; the server
  // gates again at checkout, defense in depth).
  const [backImageId, setBackImageId] = useState<string | null>(() =>
    searchParams.get("back")
  );
  const [backGroups, setBackGroups] = useState<BackSourceGroup[] | null>(null);
  const [backPickerOpen, setBackPickerOpen] = useState(false);

  // Client-side cache: "productId:placement:colorName:scale" -> mockup R2 URL
  const mockupCache = useRef<Map<string, string>>(new Map());
  // Latest-wins token (#71): every selection tap supersedes all in-flight
  // mockup fetches, so a stale Printful response — whatever field it was for
  // (color, product, placement, back pick, scale) — can never overwrite the
  // newer selection's state. Replaces per-field ref comparisons, which missed
  // A→B→A sequences.
  const mockupReq = useRef(createLatestWins()).current;

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

  // Guest funnel (#26): keep the anonymous session alive on this surface so a
  // signed-out visitor who deep-links here (or returns) can load their design.
  useEffect(() => {
    ensureGuestSession();
  }, []);

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
        setPinnedColor(design.backgroundColor ?? null);
        if (design.mockupUrls) {
          for (const [key, url] of Object.entries(design.mockupUrls)) {
            mockupCache.current.set(key, url as string);
          }
        }
        // Warm the mockup cache for this product if nothing's been
        // prefetched yet. Best-effort; no-op when the cache is already
        // populated.
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

  useEffect(() => {
    isCartEnabled().then(setCartShown).catch(() => setCartShown(false));
  }, []);

  // Fetch remembered defaults once (#44). Null for guests/first purchase.
  useEffect(() => {
    getLastPurchaseDefaults()
      .then((d) => {
        if (d) setRemembered(d);
      })
      .catch(() => {});
  }, []);

  // Apply remembered product + size when they arrive (§3): URL param >
  // remembered > static. Remembered size pre-selects a visible chip — never
  // a silent default (#66); anything the user already picked wins.
  useEffect(() => {
    if (!remembered) return;
    const resolved = resolveProductAndSize({
      urlProduct: initialUrl.product,
      urlSize: initialUrl.size,
      remembered,
    });
    if (!productTouched.current && resolved.productId !== productId) {
      handleProductChange(resolved.productId);
    }
    // Validate the size against the product actually on screen — the user
    // may have switched products before the fetch landed.
    const effectiveId = productTouched.current ? productId : resolved.productId;
    const sizes = getBlank(effectiveId)?.sizes ?? [];
    const candidate =
      resolved.size && sizes.includes(resolved.size) ? resolved.size : null;
    if (candidate) setSize((s) => s ?? candidate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remembered]);

  // Color default (§3, not remembered): URL > pinned backdrop > White >
  // first color. Re-derives when the product changes or the pinned color
  // loads; a user pick sticks as long as the palette still offers it.
  useEffect(() => {
    const palette = product?.colors ?? [];
    if (palette.length === 0) return;
    if (colorTouched.current && palette.some((c) => c.name === colorName)) return;
    colorTouched.current = false;
    const { color } = resolveDefaultColor({
      urlColor: initialUrl.color,
      pinnedColor,
      palette,
    });
    if (color !== colorName) handleColorChange(color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, pinnedColor]);

  // A picked back design prices + checks out only while the flag is on — the
  // server gates it again at checkout, defense in depth.
  const backActive = multiPlacement && !!backImageId;

  useEffect(() => {
    if (!designId || !size) return;
    let canceled = false;
    calculatePrice(designId, productId, size, backActive)
      .then((p) => {
        if (!canceled) setPricing(p);
      })
      .catch((err) => console.error("calculatePrice failed:", err));
    return () => {
      canceled = true;
    };
  }, [designId, productId, size, backActive]);

  // Sync selections to the URL so they survive Stripe cancel → back and
  // reloads. replaceState, not router.replace — a router.replace issued next
  // to a server-action call gets cancelled by the action.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (size) params.set("size", size);
    else params.delete("size");
    params.set("color", colorName);
    params.set("product", productId);
    if (backImageId) params.set("back", backImageId);
    else params.delete("back");
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${params.toString()}`
    );
  }, [size, colorName, productId, backImageId]);

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
        setLastArtwork((m) => ({ ...m, [placement]: result.imageUrl }));
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
    // Latest-wins (#71): this fetch supersedes any earlier in-flight one, and
    // only applies its own result if nothing newer has started (or a selection
    // tap invalidated it) by the time it lands.
    const token = mockupReq.begin();

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
      // Synchronous, so this call is still the latest by construction.
      setMockups((m) => ({ ...m, [placement]: cached }));
      setMockupError(false);
      return;
    }

    setMockupLoading(true);
    setMockupError(false);
    setMockups((m) => ({ ...m, [placement]: null }));
    try {
      const result = await generateMockup(
        designId,
        colorName,
        productId,
        scale,
        placement,
        sourceImageId
      );
      if (mockupReq.isCurrent(token)) {
        mockupCache.current.set(cacheKey, result.mockupUrl);
        setMockups((m) => ({ ...m, [placement]: result.mockupUrl }));
      }
    } catch (err) {
      console.error("Mockup generation failed:", err);
      if (mockupReq.isCurrent(token)) setMockupError(true);
    } finally {
      if (mockupReq.isCurrent(token)) setMockupLoading(false);
    }
  }

  // Auto-trigger the real Printful mockup whenever the active placement's
  // render settles (initial load, color/product change, placement switch).
  // Self-healing (#71): the full state deps mean any settle into "render
  // ready, no mockup, not loading, no error" re-fires the fetch — a
  // superseded stale resolution can't leave the page stuck mockup-less.
  // mockupError blocks the auto-fire so a persistent failure doesn't loop;
  // retry is the explicit button.
  useEffect(() => {
    if (!designImageUrl) return;
    if (regenerating || mockupLoading || mockupError || mockups[activePlacement])
      return;
    void renderMockupFor(activePlacement);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    designImageUrl,
    productId,
    colorName,
    activePlacement,
    regenerating,
    mockupLoading,
    mockupError,
    mockups,
  ]);

  function handleColorChange(name: string) {
    if (name === colorName) return;
    // Supersede any in-flight mockup fetch the moment the tap lands (#71) —
    // its stale result must not overwrite this newer selection.
    mockupReq.invalidate();
    setColorName(name);
    // A new color invalidates both placements' mockups.
    setMockups({ front: null, back: null });
    setMockupError(false);
    setMockupLoading(false);
  }

  function handleProductChange(newProductId: string) {
    if (newProductId === productId) return;
    const newProduct = getBlank(newProductId);
    if (!newProduct) return;
    mockupReq.invalidate();
    setProductId(newProductId);
    // Keep the color when the new product offers it; otherwise reset per the
    // §3 precedence (URL > pinned backdrop > White > first) right here — not
    // colors[0] — so the swatch selection and the mockup fetch never spend a
    // frame on a color the precedence wouldn't pick.
    setColorName((c) =>
      newProduct.colors.some((col) => col.name === c)
        ? c
        : resolveDefaultColor({
            urlColor: initialUrl.color,
            pinnedColor,
            palette: newProduct.colors,
          }).color
    );
    // Keep the size only if the new product offers it; otherwise back to
    // unselected (#60 — never silently carry an unavailable size).
    setSize((s) => (s && newProduct.sizes.includes(s) ? s : null));
    // Reset to front: the new product may not support back, and back
    // renders are product-specific. Keep backImageId (a thread source id).
    setActivePlacement("front");
    setBackPickerOpen(false);
    setMockups({ front: null, back: null });
    setMockupError(false);
    setMockupLoading(false);
    // URL follows via the replaceState sync effect.
  }

  function switchPlacement(placement: Placement) {
    if (placement === activePlacement) return;
    // A placement tap always registers, even mid-fetch (#71) — the stale
    // fetch is superseded, never awaited.
    mockupReq.invalidate();
    setActivePlacement(placement);
    setMockupError(false);
    setMockupLoading(false);
    if (placement === "back" && !backImageId) {
      // Lazy-load the source picker the first time Back is opened.
      void openBackPicker();
    }
  }

  async function openBackPicker() {
    setBackPickerOpen(true);
    if (backGroups || !designId) return;
    try {
      const { groups } = await getBackDesignSources(designId);
      setBackGroups(groups);
    } catch (err) {
      console.error("getBackDesignSources failed:", err);
      setBackGroups([]);
    }
  }

  function chooseBackSource(id: string) {
    setBackPickerOpen(false);
    // Re-picking the current source is a no-op — clearing state for it
    // would strand the hero with no mockup and nothing to re-fire.
    if (id === backImageId) return;
    mockupReq.invalidate();
    setBackImageId(id);
    // New back source invalidates the back mockup only. Its instant-layer
    // artwork too — the previous pick's artwork would be misleading.
    setMockups((m) => ({ ...m, back: null }));
    setLastArtwork((m) => ({ ...m, back: null }));
    setMockupError(false);
    setMockupLoading(false);
  }

  async function handleCheckout() {
    if (!designId || !size) return;
    setCheckingOut(true);
    try {
      const { url, needsAuth } = await createCheckoutSession({
        designId,
        size,
        color: colorName,
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
      setCheckingOut(false);
    }
  }

  async function handleAddToCart() {
    if (!designId || !size) return;
    setAddingToCart(true);
    try {
      await addToCart({
        designId,
        size,
        color: colorName,
        productId,
        ...(backActive ? { back: backImageId! } : {}),
      });
      router.push("/cart");
    } catch {
      setAddingToCart(false);
    }
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
  // Instant preview (#57): what the hero shows right now — artwork on a
  // shirt-colored silhouette immediately, exact mockup crossfaded in on top.
  const display = resolveHeroDisplay({
    renderStatus: renderState.status,
    artworkUrl: designImageUrl,
    lastArtworkUrl: lastArtwork[activePlacement],
    mockupUrl: activeMockup,
    mockupLoading,
    mockupError,
    loadedMockupUrl,
  });
  const sizes = product?.sizes ?? [];
  const sizeLabel = product?.sizeLabel ?? "Size";
  // Product price + shipping → grand total, from the same helper the checkout
  // choke point charges, so the displayed total matches the Stripe total.
  // Gated on size — price depends on it (2XL upcharge).
  const breakdown = size && pricing ? computeOrderTotal(pricing.total) : null;

  return (
    <div className="min-h-screen flex flex-col items-center py-6 md:py-12 px-4 pb-40 md:pb-12">
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

      <div className="w-full max-w-2xl grid md:grid-cols-2 gap-6 md:gap-8">
        {/* Hero column: placement toggle, mockup, scale slider, retry. Height
            capped on phones (§1) so the purchase controls below stay reachable. */}
        <div className="flex flex-col items-center">
          {/* Front / Back toggle (#25) — only when the flag is on and the product
              offers a back placement. Front stays the required default. Hidden
              until a back is in play (#61): with no back chosen the offer is the
              explicit "Add a back design" button in the purchase controls, not
              this view switcher. */}
          {showBackToggle && (!!backImageId || activePlacement === "back") && (
            <div className="flex flex-col items-center gap-1 mb-4 md:mb-6">
              <div className="inline-flex rounded-lg border-2 border-border overflow-hidden">
                {(["front", "back"] as const).map((pl) => (
                  <button
                    key={pl}
                    onClick={() => switchPlacement(pl)}
                    className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
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
            <div className="w-64 md:w-80 flex flex-col items-center gap-3 max-h-[50vh] md:max-h-[60vh] overflow-y-auto">
              <p className="text-sm text-text-muted text-center">
                Pick an image to print on the back.
              </p>
              {backGroups === null ? (
                <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              ) : backGroups.length === 0 ? (
                <p className="text-sm text-text-faint text-center">
                  No images yet. <Link href={`/design?id=${designId}`} className="underline">Add one in the designer.</Link>
                </p>
              ) : (
                backGroups.map((group) => (
                  <div key={group.id} className="w-full">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted mb-1.5">
                      {group.label}
                    </h3>
                    <div className="grid grid-cols-3 gap-2 w-full">
                      {group.images.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => chooseBackSource(s.id)}
                          className={`aspect-square min-h-11 rounded-md overflow-hidden border-2 bg-checkerboard ${
                            s.id === backImageId
                              ? "border-accent"
                              : "border-border hover:border-accent"
                          }`}
                        >
                          <img
                            src={s.imageUrl}
                            alt={`${group.label} option`}
                            className="w-full h-full object-contain"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => activeMockup && !mockupLoading && setLightboxOpen(true)}
              className={`w-64 h-80 max-h-[50vh] md:max-h-none md:w-80 md:h-96 rounded-lg shadow-lg overflow-hidden relative ${
                activeMockup && !mockupLoading ? "cursor-zoom-in" : ""
              }`}
            >
              {display.showError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-alt z-20 px-4 text-center">
                  <span className="text-sm text-text-muted">
                    Couldn&rsquo;t render the preview.
                  </span>
                  <span className="text-xs text-text-faint">
                    Use “Try again” below.
                  </span>
                </div>
              )}

              {/* Instant layer (#57): the design artwork centered on a flat
                  panel of the selected shirt color, shown immediately on any
                  product/color/placement change while the exact Printful
                  mockup renders. */}
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ backgroundColor: colorHex }}
              >
                {display.artworkUrl && (
                  <img
                    src={display.artworkUrl}
                    alt=""
                    className="object-contain max-h-[70%]"
                    style={{ width: `${Math.round(scale * 62)}%` }}
                  />
                )}
              </div>

              {/* Exact Printful mockup — crossfades in over the instant layer
                  once its image bytes arrive. The mockup has a white studio
                  background baked in; mix-blend-multiply over the light
                  backdrop maps those white pixels to the backdrop color so
                  the shirt doesn't sit in a stark white box. `isolate` keeps
                  the blend off the instant layer beneath. */}
              {display.mockupUrl && (
                <div
                  key={display.mockupUrl}
                  className={`absolute inset-0 isolate transition-opacity duration-300 ${
                    display.mockupVisible ? "opacity-100" : "opacity-0"
                  }`}
                  style={{ backgroundColor: mockupBackdrop(colorHex) }}
                >
                  <img
                    src={display.mockupUrl}
                    alt={`Your design on a ${colorName} ${productName}`}
                    onLoad={() => setLoadedMockupUrl(display.mockupUrl)}
                    className="w-full h-full object-contain mix-blend-multiply"
                  />
                </div>
              )}

              {display.pendingExact && (
                <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
                  <span
                    className={`inline-flex items-center gap-2 text-xs ${
                      isDarkShirt(colorHex) ? "text-white/80" : "text-black/60"
                    }`}
                  >
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {regenerating ? "Preparing…" : "Final preview loading…"}
                  </span>
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

          {/* Preview-render recovery. Buying is gated on size only (§8 Q1) —
              these retry the hero, they never block checkout. */}
          {renderState.status === "error" && (
            <Button
              onClick={() => setRenderNonce((n) => n + 1)}
              variant="secondary"
              className="mt-4"
            >
              Try again
            </Button>
          )}
          {renderState.status !== "error" && mockupError && (
            <Button
              onClick={() => renderMockupFor(activePlacement)}
              variant="secondary"
              className="mt-4"
              disabled={regenerating}
            >
              Retry preview
            </Button>
          )}
          {mockupError && (
            <p className="text-sm text-negative text-center mt-2">
              Couldn&apos;t render the preview.
            </p>
          )}
        </div>

        {/* Purchase controls (§1: scroll region on phones, right column on
            desktop) */}
        <div className="w-full space-y-5">
          {/* Product selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Product</label>
            <div className="flex gap-2 md:gap-3">
              {ACTIVE_BLANKS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    productTouched.current = true;
                    handleProductChange(p.id);
                  }}
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
          </div>

          <ColorPicker
            colors={colors}
            value={colorName}
            onChange={(name) => {
              colorTouched.current = true;
              handleColorChange(name);
            }}
            note={
              pinnedColor && colorName === pinnedColor
                ? "Designer's pick"
                : undefined
            }
          />
          <SizePicker sizes={sizes} value={size} onChange={setSize} label={sizeLabel} />

          {/* Back-design offer (#61) — same affordance as the /d buy panel.
              Opens the back-source picker in the hero; once a back is chosen
              the Front/Back toggle + the price line below take over. */}
          {showBackToggle && !backImageId && activePlacement === "front" && (
            <button
              onClick={() => {
                switchPlacement("back");
                // The picker renders in the hero — on phones that's above
                // the purchase controls, so bring it into view.
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="block min-h-11 text-sm underline text-text-muted hover:text-foreground"
            >
              Add a back design (+${BACK_PLACEMENT_UPCHARGE.toFixed(2)})
            </button>
          )}

          {/* Pricing (§8 Q4: full breakdown here; the mobile sticky bar repeats
              only the total) */}
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

          {/* Desktop checkout — mobile uses the sticky bar */}
          {!size && (
            <p className="hidden md:block text-sm text-text-muted text-center">
              Choose a size
            </p>
          )}
          <Button
            onClick={handleCheckout}
            disabled={checkingOut || !size}
            className="hidden md:block w-full"
            size="lg"
          >
            {checkingOut ? "Redirecting…" : "Order"}
          </Button>
          {cartShown && (
            <Button
              onClick={handleAddToCart}
              disabled={addingToCart || !size}
              variant="secondary"
              className="hidden md:block w-full"
              size="lg"
            >
              {addingToCart ? "Adding…" : "Add to cart"}
            </Button>
          )}
          <div className="text-center">
            <Link
              href={`/design?id=${designId}`}
              className="text-sm text-text-muted hover:text-foreground hover:underline"
            >
              Refine design
            </Link>
          </div>
        </div>
      </div>

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
            className="relative max-w-[90vw] max-h-[90vh] overflow-hidden cursor-zoom-in isolate rounded-lg"
            style={{ backgroundColor: mockupBackdrop(colorHex) }}
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
              className="max-w-[90vw] max-h-[90vh] object-contain mix-blend-multiply transition-transform duration-200"
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

      {/* Mobile sticky checkout bar — total lives here (§8 Q4); the full
          breakdown is in the scroll region above. Safe-area aware. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 md:hidden bg-background border-t border-border px-4 pt-3 space-y-2"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {!size && (
          <p className="text-sm text-text-muted text-center">Choose a size</p>
        )}
        <Button
          onClick={handleCheckout}
          disabled={checkingOut || !size}
          className="w-full"
          size="lg"
        >
          {checkingOut
            ? "Redirecting…"
            : breakdown
              ? `Order — $${breakdown.total.toFixed(2)}`
              : "Order"}
        </Button>
        {cartShown && (
          <Button
            onClick={handleAddToCart}
            disabled={addingToCart || !size}
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
