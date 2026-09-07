"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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
  mockupBackdrop,
  resolveHeroDisplay,
  sidesLayout,
  type Side,
} from "@/lib/instant-preview";
import { SideMockup } from "@/components/side-mockup";
import {
  mockupCacheKey,
  mockupCachePlacementPrefix,
} from "@/lib/mockup-cache";
import { normalizeFrontPin, swapPlacementPins } from "@/lib/placement-pins";

// Discriminated union: the placement render is the single source of
// truth for what a side shows. Drives both the design image and the
// "preparing your design" spinner via derivation, no seq-guard.
type RenderState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; imageUrl: string; aspectRatio: AspectRatio }
  | { status: "error"; message: string };

// Per-side state (#167). Both sides are on screen at once, so nothing in
// the render/mockup pipeline is shared between them.
type PerSide<T> = Record<Side, T>;

function perSide<T>(value: T): PerSide<T> {
  return { front: value, back: value };
}

/** State updater that sets `value` on the named sides and keeps the others. */
function setSides<T>(sides: Side[], value: T) {
  return (prev: PerSide<T>): PerSide<T> => {
    const next = { ...prev };
    for (const side of sides) next[side] = value;
    return next;
  };
}

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
  // Set the moment a navigation away from /preview starts (add-to-cart,
  // checkout). Late async state must not rewrite history after that — see the
  // URL-sync effect below (#101).
  const navigatingAway = useRef(false);

  const [renderStates, setRenderStates] = useState<PerSide<RenderState>>(() =>
    perSide({ status: "idle" })
  );
  // Bumped to re-run that side's placement-render effect (retry after an error).
  const [renderNonce, setRenderNonce] = useState<PerSide<number>>(() => perSide(0));
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
  // Mockup per side. The back is only populated once the user opts in and
  // picks a source image.
  const [mockups, setMockups] = useState<PerSide<string | null>>(() => perSide(null));
  const [mockupLoading, setMockupLoading] = useState<PerSide<boolean>>(() =>
    perSide(false)
  );
  const [mockupError, setMockupError] = useState<PerSide<boolean>>(() => perSide(false));
  // Most recent ready artwork per side — keeps the instant
  // artwork-on-color layer populated while a product/color change
  // re-resolves the placement render (#57).
  const [lastArtwork, setLastArtwork] = useState<PerSide<string | null>>(() =>
    perSide(null)
  );
  // URL of the mockup image the browser has finished loading, per side;
  // drives the crossfade from the instant layer to the exact Printful render.
  const [loadedMockupUrl, setLoadedMockupUrl] = useState<PerSide<string | null>>(() =>
    perSide(null)
  );
  const [hasPrimary, setHasPrimary] = useState<boolean | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [panOrigin, setPanOrigin] = useState({ x: 50, y: 50 });
  const [scale, setScale] = useState(1.0);

  // Multi-placement (#25). Off-by-default flag keeps the back UI dark in
  // prod; when off, no back is ever shown so the whole flow is the
  // single-placement version.
  const [multiPlacement, setMultiPlacement] = useState(false);
  // Which side is large (#167). Only meaningful while a back is in play —
  // `sidesLayout` ignores it otherwise.
  const [prominent, setProminent] = useState<Side>("front");
  // Back source from the URL, captured once on mount (Stripe cancel → back,
  // /order redirects). The URL-sync effect rewrites the query string, so
  // reading it live would race and drop it. A stray `?back=` stays inert
  // while the flag is off (`backActive` gates pricing/checkout; the server
  // gates again at checkout, defense in depth).
  const [backImageId, setBackImageId] = useState<string | null>(() =>
    searchParams.get("back")
  );
  // Front pin (#138): null = the design's primary image, the default that
  // keeps URLs and checkout payloads byte-identical to the pre-picker shape.
  // Captured from the URL once, same as `back`.
  const [frontImageId, setFrontImageId] = useState<string | null>(() =>
    searchParams.get("front")
  );
  // The design's primary image id, loaded with the design row — the front
  // default and the reference "does the pin differ" checks key off.
  const [primaryImageId, setPrimaryImageId] = useState<string | null>(null);
  const [backGroups, setBackGroups] = useState<BackSourceGroup[] | null>(null);
  // Which side the hero source picker is picking for; null = closed.
  const [pickerTarget, setPickerTarget] = useState<Side | null>(null);
  // id → image URL for the Placements-block thumbnails, filled from picker
  // taps and group loads.
  const [sourceUrls, setSourceUrls] = useState<Record<string, string>>({});

  // Client-side cache: "productId:placement:colorName:scale" -> mockup R2 URL
  const mockupCache = useRef<Map<string, string>>(new Map());
  // Latest-wins tokens (#71), one per side: every selection tap supersedes
  // the in-flight mockup fetches it affects, so a stale Printful response —
  // whatever field it was for (color, product, back pick, scale) — can never
  // overwrite the newer selection's state. Replaces per-field ref
  // comparisons, which missed A→B→A sequences. Per side because both sides
  // fetch on this page (#167): with one shared token the back's begin()
  // would supersede the front's fetch.
  const mockupReq = useRef({
    front: createLatestWins(),
    back: createLatestWins(),
  }).current;

  const colors = product?.colors ?? [];
  const frontImageUrl =
    renderStates.front.status === "ready" ? renderStates.front.imageUrl : null;
  // A back may be added here: flag on and the product offers a back placement.
  const showBack =
    multiPlacement && !!product && productSupportsPlacement(product, "back");
  // A back is on screen: offered and picked.
  const backShown = showBack && !!backImageId;
  // Which side is large and what the small slot holds (#167).
  const layout = sidesLayout({ hasBack: backShown, prominent, backOffered: showBack });
  // Two panels on screen at once — the Front/Back pill only means something
  // when there's a counterpart to distinguish it from.
  const twoSided = layout.tile.kind === "side";
  const heroMockup = mockups[layout.hero];
  // What's on the front right now, and whether it's an explicit non-default
  // pin (#138). Only a differing pin travels — into the URL, the checkout
  // payload, and the mockup cache key — so the primary-front common case
  // stays byte-identical to the pre-picker flow.
  const effectiveFrontId = frontImageId ?? primaryImageId;
  const frontPinned = !!frontImageId && frontImageId !== primaryImageId;
  // The source picker renders in place of the hero while open for a side.
  const showSourcePicker = pickerTarget !== null;
  const pickingFor: Side = pickerTarget ?? "back";
  const pickingCurrentId =
    pickingFor === "front" ? effectiveFrontId : backImageId;

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
        setPrimaryImageId(design.primaryImageId);
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
  //
  // Two guards, both because Next turns every history.replaceState into a
  // router ACTION_RESTORE for the URL passed in — so a redundant or late call
  // is a real navigation, not a no-op (the #101 class of bug):
  //   - skip once a navigation away has started, so late-landing async state
  //     (remembered defaults, pinned color, a mockup settling) can't restore
  //     /preview on top of it;
  //   - skip when the URL already matches, which is most renders.
  useEffect(() => {
    if (navigatingAway.current) return;
    const params = new URLSearchParams(window.location.search);
    if (size) params.set("size", size);
    else params.delete("size");
    params.set("color", colorName);
    params.set("product", productId);
    if (backImageId) params.set("back", backImageId);
    else params.delete("back");
    // `front` only when it differs from the primary (#138 open question 4) —
    // a front param means "not the default".
    if (frontPinned) params.set("front", frontImageId!);
    else params.delete("front");
    const next = `${window.location.pathname}?${params.toString()}`;
    if (next === `${window.location.pathname}${window.location.search}`) return;
    // Keep the existing history state rather than clearing it to null.
    window.history.replaceState(window.history.state, "", next);
  }, [size, colorName, productId, backImageId, frontImageId, frontPinned]);

  // Run one side's placement render: mark it loading, apply the result unless
  // the effect that started it has since been cleaned up. Returns the cleanup.
  // Memoized on productId (the only non-stable value it reads, for the cache
  // prefix) so the two render effects can list it as a dependency without
  // re-running every render.
  const runPlacementRender = useCallback(
    (
      side: Side,
      resolve: () => Promise<{ imageUrl: string; aspectRatio: AspectRatio }>
    ) => {
      let canceled = false;
      setRenderStates((s) => ({ ...s, [side]: { status: "loading" } }));
      resolve()
        .then((result) => {
          if (canceled) return;
          setRenderStates((s) => ({
            ...s,
            [side]: {
              status: "ready",
              imageUrl: result.imageUrl,
              aspectRatio: result.aspectRatio,
            },
          }));
          setLastArtwork((m) => ({ ...m, [side]: result.imageUrl }));
          // Fresh placement render invalidates client mockup entries for this
          // product + placement. Server clears DB mockupUrls on insert. Shared
          // prefix builder — a hand-rolled prefix stopped matching when #102
          // version-bumped the keys (#138 defect 1).
          const prefix = mockupCachePlacementPrefix(productId, side);
          for (const key of [...mockupCache.current.keys()]) {
            if (key.startsWith(prefix)) mockupCache.current.delete(key);
          }
          setMockups((m) => ({ ...m, [side]: null }));
          setMockupError((e) => ({ ...e, [side]: false }));
        })
        .catch((err) => {
          if (canceled) return;
          console.error("getOrCreatePlacementRender failed:", err);
          setRenderStates((s) => ({
            ...s,
            [side]: {
              status: "error",
              message: err instanceof Error ? err.message : String(err),
            },
          }));
        });
      return () => {
        canceled = true;
      };
    },
    [productId]
  );

  // Resolve the front's design image for the current (designId, productId,
  // front pin). The server returns either a cached image row or a fresh
  // anchored render. State derives from the in-flight call -- the cleanup
  // cancels stale resolutions.
  useEffect(() => {
    if (!designId || !hasPrimary) return;
    const id = designId;
    // Front passes its pin as the source only when it differs from the
    // primary (#138, §5 cache-key rule) — the default front stays on the
    // no-source path and every warm cache entry stays valid.
    return runPlacementRender("front", () =>
      frontPinned
        ? getOrCreatePlacementRender(id, productId, "front", frontImageId!)
        : getOrCreatePlacementRender(id, productId)
    );
  }, [
    designId,
    productId,
    hasPrimary,
    renderNonce.front,
    frontImageId,
    frontPinned,
    runPlacementRender,
  ]);

  // Same for the back, independently (#167): a front pick must not
  // re-resolve the back and vice versa. With no back on screen nothing is
  // fetched and the side sits idle.
  useEffect(() => {
    if (!designId || !hasPrimary) return;
    if (!backShown || !backImageId) {
      setRenderStates((s) =>
        s.back.status === "idle" ? s : { ...s, back: { status: "idle" } }
      );
      return;
    }
    const id = designId;
    const source = backImageId;
    return runPlacementRender("back", () =>
      getOrCreatePlacementRender(id, productId, "back", source)
    );
  }, [
    designId,
    productId,
    hasPrimary,
    renderNonce.back,
    backImageId,
    backShown,
    runPlacementRender,
  ]);

  // Generate the mockup for one side on demand (called by that side's
  // auto-trigger effect and its retry). Caches per
  // productId:placement:source:color:scale.
  async function renderMockupFor(side: Side) {
    if (!designId) return;
    // Latest-wins (#71), per side: this fetch supersedes any earlier in-flight
    // one for the same side, and only applies its own result if nothing newer
    // has started (or a selection tap invalidated it) by the time it lands.
    const req = mockupReq[side];
    const token = req.begin();

    // Placements render from their picked source; thread it through so the
    // mockup matches the pick and the cache key doesn't collide (#25). Front
    // sends its pin only when it differs from the primary (#138, §5) so the
    // default front keeps today's key shape and every warm entry stays valid.
    const sourceImageId =
      side === "back"
        ? backImageId ?? undefined
        : frontPinned
          ? frontImageId!
          : undefined;
    const scaleKey = Math.round(scale * 100);
    // Shared builder keeps this in lockstep with the server's cache key —
    // entries warmed from design.mockupUrls only hit when formats match.
    const cacheKey = mockupCacheKey({
      productId,
      placementId: side,
      sourceImageId,
      colorName,
      scaleKey,
    });

    const cached = mockupCache.current.get(cacheKey);
    if (cached) {
      // Synchronous, so this call is still the latest by construction.
      setMockups((m) => ({ ...m, [side]: cached }));
      setMockupError((e) => ({ ...e, [side]: false }));
      return;
    }

    setMockupLoading((l) => ({ ...l, [side]: true }));
    setMockupError((e) => ({ ...e, [side]: false }));
    setMockups((m) => ({ ...m, [side]: null }));
    try {
      const result = await generateMockup(
        designId,
        colorName,
        productId,
        scale,
        side,
        sourceImageId
      );
      if (req.isCurrent(token)) {
        mockupCache.current.set(cacheKey, result.mockupUrl);
        setMockups((m) => ({ ...m, [side]: result.mockupUrl }));
      }
    } catch (err) {
      console.error("Mockup generation failed:", err);
      if (req.isCurrent(token)) setMockupError((e) => ({ ...e, [side]: true }));
    } finally {
      if (req.isCurrent(token)) setMockupLoading((l) => ({ ...l, [side]: false }));
    }
  }

  // Auto-trigger the real Printful mockup for the front whenever its render
  // settles (initial load, color/product change, front pick). Self-healing
  // (#71): the full state deps mean any settle into "render ready, no
  // mockup, not loading, no error" re-fires the fetch — a superseded stale
  // resolution can't leave the page stuck mockup-less. mockupError blocks
  // the auto-fire so a persistent failure doesn't loop; retry is the
  // explicit button in the side's panel.
  // Never waits on the back: the front is what the buyer looks at first, so
  // an in-flight back fetch (Printful polling allows up to 55s) must not
  // stall it. The back's own gate (frontMockupSettled, below) ensures the
  // back does not start until the front settles.
  useEffect(() => {
    if (!frontImageUrl) return;
    if (mockupLoading.front || mockupError.front || mockups.front) return;
    void renderMockupFor("front");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    frontImageUrl,
    productId,
    colorName,
    mockupLoading.front,
    mockupError.front,
    mockups.front,
  ]);

  // The front's mockup fetch has settled: fetched, failed, or never going to
  // start because the front render itself failed. "Not loading" alone is
  // also true before the front fetch has started, which would let the back
  // go first and the two overlap.
  const frontMockupSettled =
    !mockupLoading.front &&
    (!!mockups.front || mockupError.front || renderStates.front.status === "error");

  // Fetch the back's mockup once the front has settled (#167). The front
  // (what the buyer sees first) is never slowed by an in-flight back fetch.
  useEffect(() => {
    if (!backShown || renderStates.back.status !== "ready") return;
    if (!frontMockupSettled) return;
    if (mockupLoading.back || mockupError.back || mockups.back) return;
    void renderMockupFor("back");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    backShown,
    renderStates.back.status,
    productId,
    colorName,
    frontMockupSettled,
    mockupLoading.back,
    mockupError.back,
    mockups.back,
  ]);

  // Supersede the named sides' in-flight mockup fetches (#71) and clear
  // their mockup/loading/error state. The stale fetch is never awaited, so
  // nothing else would reset those flags.
  function invalidateMockups(sides: Side[]) {
    for (const side of sides) mockupReq[side].invalidate();
    setMockups(setSides<string | null>(sides, null));
    setMockupError(setSides(sides, false));
    setMockupLoading(setSides(sides, false));
  }

  function handleColorChange(name: string) {
    if (name === colorName) return;
    // Supersede any in-flight mockup fetch the moment the tap lands (#71) —
    // its stale result must not overwrite this newer selection. A new color
    // invalidates both sides' mockups.
    invalidateMockups(["front", "back"]);
    setColorName(name);
  }

  function handleProductChange(newProductId: string) {
    if (newProductId === productId) return;
    const newProduct = getBlank(newProductId);
    if (!newProduct) return;
    invalidateMockups(["front", "back"]);
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
    // Front back to the hero: the new product may not support back, and back
    // renders are product-specific. Keep backImageId (a thread source id).
    setProminent("front");
    setPickerTarget(null);
    // URL follows via the replaceState sync effect.
  }

  // One fetch per page view, shared by both placements' pickers and the
  // Placements-block thumbnails.
  async function loadSourceGroups() {
    if (backGroups || !designId) return;
    try {
      const { groups } = await getBackDesignSources(designId);
      setBackGroups(groups);
      setSourceUrls((m) => {
        const next = { ...m };
        for (const g of groups) for (const img of g.images) next[img.id] = img.imageUrl;
        return next;
      });
    } catch (err) {
      console.error("getBackDesignSources failed:", err);
      setBackGroups([]);
    }
  }

  // Open the hero source picker for a side (#138: front and back share the
  // picker; only its heading differs).
  function openSourcePicker(target: Side) {
    setPickerTarget(target);
    void loadSourceGroups();
  }

  // Resolve a pin restored from the URL (Stripe cancel → back) to a
  // thumbnail URL — picker taps and group loads cover every other path.
  useEffect(() => {
    if (backGroups !== null) return;
    const frontMissing = frontPinned && !sourceUrls[frontImageId!];
    const backMissing = !!backImageId && !sourceUrls[backImageId];
    if (frontMissing || backMissing) void loadSourceGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontPinned, frontImageId, backImageId, backGroups]);

  function chooseSource(target: Side, id: string, imageUrl: string) {
    setPickerTarget(null);
    setSourceUrls((m) => (m[id] ? m : { ...m, [id]: imageUrl }));
    // Re-picking the current source is a no-op — clearing state for it
    // would strand the side with no mockup and nothing to re-fire.
    if (target === "back") {
      if (id === backImageId) return;
      // New back source invalidates the back mockup only. Its instant-layer
      // artwork too — the previous pick's artwork would be misleading. The
      // front stays the hero; the tile shows the back rendering.
      invalidateMockups(["back"]);
      setBackImageId(id);
      setLastArtwork((m) => ({ ...m, back: null }));
    } else {
      if (id === effectiveFrontId) return;
      invalidateMockups(["front"]);
      // Picking the primary back is "no pin" (#138 open question 4).
      setFrontImageId(normalizeFrontPin(id, primaryImageId));
      setLastArtwork((m) => ({ ...m, front: null }));
    }
  }

  function removeBack() {
    if (!backImageId) return;
    invalidateMockups(["back"]);
    setBackImageId(null);
    setPickerTarget(null);
    setProminent("front");
    setLastArtwork((m) => ({ ...m, back: null }));
  }

  // Literal exchange of the two placement ids (§2). Only reachable when both
  // placements are filled, so the price (`hasBack`) is unchanged by
  // construction.
  function handleSwap() {
    if (!backImageId || !effectiveFrontId) return;
    // Both mockups re-render for the traded artwork.
    invalidateMockups(["front", "back"]);
    const next = swapPlacementPins({
      frontImageId: effectiveFrontId,
      backImageId,
      primaryImageId,
    });
    setFrontImageId(next.front);
    setBackImageId(next.back);
    // The artwork trades sides: swap the instant-layer entries so neither
    // side flashes empty.
    setLastArtwork((m) => ({ front: m.back, back: m.front }));
  }

  function openPickerFromControls(target: Side) {
    openSourcePicker(target);
    // The picker renders in the hero — on phones that's above the purchase
    // controls, so bring it into view.
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        // The front pin travels only when it differs from the primary —
        // absent, the server resolves the primary as it always has (#138).
        ...(frontPinned ? { front: frontImageId! } : {}),
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
    navigatingAway.current = true;
    try {
      await addToCart({
        designId,
        size,
        color: colorName,
        productId,
        ...(frontPinned ? { front: frontImageId! } : {}),
        ...(backActive ? { back: backImageId! } : {}),
      });
      // Hard navigation, not router.push (#101). Next's server-action reducer
      // finishes every action by navigating to the canonicalUrl the action was
      // dispatched from. This page always has background actions in flight
      // (mockup render, price), and any one of them landing after a client-side
      // push drags the router straight back to /preview — the cart page had
      // already rendered. A document navigation can't be undone that way.
      window.location.href = "/cart";
    } catch {
      navigatingAway.current = false;
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
  // Instant preview (#57), per side: artwork on a shirt-colored panel
  // immediately, exact mockup crossfaded in on top.
  function sideDisplay(side: Side) {
    const render = renderStates[side];
    return resolveHeroDisplay({
      renderStatus: render.status,
      artworkUrl: render.status === "ready" ? render.imageUrl : null,
      lastArtworkUrl: lastArtwork[side],
      mockupUrl: mockups[side],
      mockupLoading: mockupLoading[side],
      mockupError: mockupError[side],
      loadedMockupUrl: loadedMockupUrl[side],
    });
  }
  // Preview-render recovery, drawn in the side's own panel so a failed back
  // is never hidden behind a healthy front (#167). Buying is gated on size
  // only (§8 Q1) — these retry the preview, they never block checkout.
  function sideError(side: Side) {
    if (renderStates[side].status === "error") {
      return {
        message: "Couldn't render the preview.",
        retryLabel: "Try again",
        onRetry: () => setRenderNonce((n) => ({ ...n, [side]: n[side] + 1 })),
      };
    }
    if (mockupError[side]) {
      return {
        message: "Couldn't render the preview.",
        retryLabel: "Retry preview",
        onRetry: () => void renderMockupFor(side),
      };
    }
    return null;
  }
  function sideAlt(side: Side) {
    return side === "front"
      ? `Your design on a ${colorName} ${productName}`
      : `Your back design on a ${colorName} ${productName}`;
  }
  function sidePendingLabel(side: Side) {
    return renderStates[side].status === "loading"
      ? "Preparing…"
      : "Final preview loading…";
  }
  // The hero opens the lightbox only once its exact mockup is on screen.
  const heroMockupReady = !!heroMockup && !mockupLoading[layout.hero];
  // Tile: about a third of the hero, same 4:5 aspect, over 44px each way.
  const tileSizeClass = "w-20 h-[6.25rem] md:w-24 md:h-[7.5rem]";

  // The small slot under the hero (#167): the other side (tap to make it the
  // hero), the add-a-back entry point, or nothing.
  function renderTile() {
    const tile = layout.tile;
    if (tile.kind === "none") return null;
    if (tile.kind === "add-back") {
      return (
        <button
          type="button"
          data-testid="add-back-tile"
          onClick={() => openSourcePicker("back")}
          className={`${tileSizeClass} rounded-lg border border-dashed border-border px-1 text-center text-xs leading-snug text-text-muted hover:border-text-muted hover:text-foreground transition-colors`}
        >
          Add a back design (+${BACK_PLACEMENT_UPCHARGE.toFixed(2)})
        </button>
      );
    }
    const side = tile.side;
    return (
      <SideMockup
        side={side}
        variant="tile"
        display={sideDisplay(side)}
        colorHex={colorHex}
        alt={sideAlt(side)}
        artworkWidthPct={Math.round(scale * 62)}
        pendingLabel={sidePendingLabel(side)}
        onMockupLoad={(url) => setLoadedMockupUrl((l) => ({ ...l, [side]: url }))}
        error={sideError(side)}
        onSelect={() => setProminent(side)}
        selectLabel={side === "back" ? "Show back large" : "Show front large"}
        showSideLabel={twoSided}
        className={`${tileSizeClass} border border-border`}
        testId="side-tile"
      />
    );
  }
  const sizes = product?.sizes ?? [];
  const sizeLabel = product?.sizeLabel ?? "Size";
  // Product price + shipping → grand total, from the same helper the checkout
  // choke point charges, so the displayed total matches the Stripe total.
  // Gated on size — price depends on it (2XL upcharge).
  const breakdown = size && pricing ? computeOrderTotal(pricing.total) : null;
  // Placements-block thumbnails (#138 §6). Picker taps / group loads resolve
  // by id; the placement's last-shown artwork covers the default front (and
  // any pin whose URL hasn't resolved yet).
  const frontThumb =
    (effectiveFrontId ? sourceUrls[effectiveFrontId] : undefined) ??
    lastArtwork.front;
  const backThumb = backImageId
    ? sourceUrls[backImageId] ?? lastArtwork.back
    : null;

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
        {/* Hero column (#167): the shirt as an object — one side large, the
            other as a tile under it; tapping the tile swaps them. Height
            capped on phones (§1) so the purchase controls below stay
            reachable. */}
        <div className="flex flex-col items-center">
          {/* Source picker (either side, #138) in place of the hero, or the
              hero + tile */}
          {showSourcePicker ? (
            <>
              <div className="w-64 md:w-80 flex flex-col items-center gap-3 max-h-[50vh] md:max-h-[60vh] overflow-y-auto">
                <p className="text-sm text-text-muted text-center">
                  Pick an image to print on the {pickingFor}.
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
                            onClick={() => chooseSource(pickingFor, s.id, s.imageUrl)}
                            className={`aspect-square min-h-11 rounded-md overflow-hidden border-2 bg-checkerboard ${
                              s.id === pickingCurrentId
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
              {/* Outside the scroll region so it stays reachable however long
                  the list is. With the Front/Back toggle gone this is the only
                  way out of a picker opened by mistake. */}
              <button
                type="button"
                onClick={() => setPickerTarget(null)}
                className="min-h-11 mt-2 px-2 text-sm underline text-text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <SideMockup
                side={layout.hero}
                variant="hero"
                display={sideDisplay(layout.hero)}
                colorHex={colorHex}
                alt={sideAlt(layout.hero)}
                artworkWidthPct={Math.round(scale * 62)}
                pendingLabel={sidePendingLabel(layout.hero)}
                onMockupLoad={(url) =>
                  setLoadedMockupUrl((l) => ({ ...l, [layout.hero]: url }))
                }
                error={sideError(layout.hero)}
                onSelect={heroMockupReady ? () => setLightboxOpen(true) : undefined}
                selectLabel="View full size"
                showSideLabel={twoSided}
                className="w-64 h-80 max-h-[50vh] md:max-h-none md:w-80 md:h-96 border border-border"
                testId="side-hero"
              />
              {/* Tile row: same width as the hero so it lines up and never
                  widens the column (no horizontal scroll at 390px). */}
              {layout.tile.kind !== "none" && (
                <div className="w-64 md:w-80 mt-3 flex">{renderTile()}</div>
              )}
            </>
          )}

          {/* Scale slider — keyed off the hero side */}
          {!showSourcePicker && !mockupLoading[layout.hero] && !heroMockup && (
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

          {/* Placements (#138, §6): the two printed sides as peer rows. The
              Front row is always offered — changing the front is not a
              multi-placement feature. The Back row (and Swap) need the flag +
              a back-capable product; "Add a back design" (#61) is the Back
              row's empty state. "Change" opens the hero source picker for
              that placement. */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="w-10 text-sm text-text-muted">Front</span>
              <div className="w-11 h-11 shrink-0 rounded-md border border-border bg-checkerboard overflow-hidden">
                {frontThumb && (
                  <img
                    src={frontThumb}
                    alt="Front design"
                    className="w-full h-full object-contain"
                  />
                )}
              </div>
              <button
                onClick={() => openPickerFromControls("front")}
                className="min-h-11 px-1 text-sm underline text-text-muted hover:text-foreground"
              >
                Change
              </button>
            </div>
            {showBack &&
              (backImageId ? (
                <div className="flex items-center gap-3">
                  <span className="w-10 text-sm text-text-muted">Back</span>
                  <div className="w-11 h-11 shrink-0 rounded-md border border-border bg-checkerboard overflow-hidden">
                    {backThumb && (
                      <img
                        src={backThumb}
                        alt="Back design"
                        className="w-full h-full object-contain"
                      />
                    )}
                  </div>
                  <button
                    onClick={() => openPickerFromControls("back")}
                    className="min-h-11 px-1 text-sm underline text-text-muted hover:text-foreground"
                  >
                    Change
                  </button>
                  <button
                    onClick={removeBack}
                    aria-label="Remove back design"
                    className="w-11 h-11 flex items-center justify-center rounded-md border border-border text-text-muted hover:border-text-muted"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => openPickerFromControls("back")}
                  className="block min-h-11 text-sm underline text-text-muted hover:text-foreground"
                >
                  Add a back design (+${BACK_PLACEMENT_UPCHARGE.toFixed(2)})
                </button>
              ))}
            {showBack && backImageId && effectiveFrontId && (
              <button
                onClick={handleSwap}
                className="block min-h-11 text-sm underline text-text-muted hover:text-foreground"
              >
                ⇅ Swap front and back
              </button>
            )}
          </div>

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
      {lightboxOpen && heroMockup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20"
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
              src={heroMockup}
              alt={sideAlt(layout.hero)}
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
            className="absolute top-4 right-4 text-foreground/70 hover:text-foreground text-3xl leading-none"
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
