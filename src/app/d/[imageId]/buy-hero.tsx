"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { getListingMockup, getListingBackMockup } from "../actions";
import { PublishedImageView } from "./published-image-view";
import { BuyPanel, type BackPick, type BuyPanelHandle } from "./buy-panel";
import { SideMockup } from "@/components/side-mockup";
import { FullscreenViewer } from "@/components/fullscreen-viewer";
import { getBlank, productSupportsPlacement } from "@/lib/blanks";
import {
  resolveHeroDisplay,
  sidesLayout,
  type Side,
} from "@/lib/instant-preview";
import { createLatestWins } from "@/lib/latest-wins";
import { BACK_PLACEMENT_UPCHARGE } from "@/lib/pricing";
import {
  resolveDefaultColor,
  resolveProductAndSize,
  type PurchaseDefaults,
} from "@/lib/purchase-defaults";
import { buyPagePlacements } from "@/lib/placement-pins";

/**
 * One side's mockup fetch state. `key` names the selection (product, color,
 * source, retry count) the slot was filled for — null is an empty slot. The
 * key is what lets the back effect tell "already fetched for this pick"
 * from "stale, fetched for a different pick" without a second fetch, and
 * what makes "the front has settled" a fact about the CURRENT selection
 * rather than whatever the last render happened to hold.
 */
type SideSlot = {
  key: string | null;
  mockupUrl: string | null;
  loading: boolean;
  error: boolean;
  /** URL of the mockup image the browser finished loading (onLoad). Kept
   * across fetches: a cached URL coming back identical needs no fade. */
  loadedMockupUrl: string | null;
};

const EMPTY_SLOT: SideSlot = {
  key: null,
  mockupUrl: null,
  loading: false,
  error: false,
  loadedMockupUrl: null,
};

/**
 * Holds the product/color/front/back selection shared by the hero and
 * `BuyPanel` (#135 slice 1, #167, #138 slice 3) — they're siblings under
 * `page.tsx` (separated by the title/naming block, passed through as
 * `children` so its JSX stays authored in the server page), and
 * `PublishedImageView` also serves the owner's backdrop-picker mode, so buy
 * logic doesn't belong there. `BuyPanel` stays the single source of truth
 * for its own expanded/product/color/back/swap state. This wrapper starts
 * from the same values (it replays the panel's precedence over the link's
 * `initialPicks`, so a link that opens expanded fetches the right mockup on
 * the first render) and then follows the panel through its report effects, to
 * know what to render mockups for. It stays mounted as one instance across
 * the collapsed → expanded hero change (same position in both returned trees)
 * so BuyPanel's internal state (size, back design, swap, expanded) survives it.
 *
 * Collapsed: renders `PublishedImageView` unchanged — artwork on its pinned
 * backdrop, no mockup fetch, page stays cheap for browsers. Expanded: the
 * shirt as an object (#167 decision 1) — the front as a layered hero
 * (`SideMockup`: instant artwork-on-shirt-color, the Printful mockup
 * crossfaded in) and, once the buyer picks a back design in the panel, a
 * smaller back tile below it rendering the real back mockup; tapping the
 * tile swaps which side is large. With no back picked the tile slot offers
 * "Add a back design", which opens the panel's picker. Tapping the hero opens
 * `FullscreenViewer` (#285) with a second `SideMockup` fed by the same slots,
 * so a mockup that lands while it is open appears in place.
 *
 * The hero follows the placement pins, not the page (#138 slice 3): after
 * the buyer swaps in the panel, the front renders their pick
 * (`getListingMockup` with `frontImageId`) and the back tile renders this
 * page's image. `BuyPanel` reports both sides; this wrapper only renders.
 *
 * Fetch order: the back mockup is requested only after the front's fetch has
 * settled (resolved or failed), never concurrently. A failed side shows its
 * error in place with a retry; errors never auto-refire. The one exception
 * is a front Retry while the back is still in flight — that starts a front
 * request beside the back one, which is harmless (two Printful tasks) and
 * not worth resetting the back for.
 */
export function BuyHero({
  imageId,
  imageUrl,
  alt,
  initialBackgroundColor,
  canEdit,
  isLoggedIn,
  remembered,
  backEnabled,
  cartEnabled,
  startAction,
  initialPicks,
  editingLine,
  backHref,
  backLabel,
  children,
}: {
  imageId: string;
  imageUrl: string;
  alt: string;
  initialBackgroundColor: string | null;
  canEdit: boolean;
  isLoggedIn: boolean;
  remembered?: PurchaseDefaults | null;
  backEnabled?: boolean;
  cartEnabled?: boolean;
  startAction?: ReactNode;
  /** Picks carried by the link (#278), forwarded to `BuyPanel`. The hero
   * seeds its own mirror of them so a link that opens expanded requests the
   * right mockup on the first render instead of the default one first. */
  initialPicks?: {
    expanded: boolean;
    productId: string | null;
    size: string | null;
    color: string | null;
    back: BackPick | null;
    swapped: boolean;
  };
  /** Forwarded to BuyPanel (#282). */
  editingLine?: { id: string } | null;
  /** Mobile-only floating back arrow (breadcrumbTrail's `up`), rendered over
   * the hero exactly as it was in page.tsx before the wrapper existed. */
  backHref?: string;
  backLabel?: string;
  /** The title/naming/attribution block — rendered between the hero and
   * `BuyPanel`, matching the page's original visual order. */
  children?: ReactNode;
}) {
  // The initial values replay BuyPanel's own precedence (link > remembered >
  // static; link > pinned backdrop > White) so the hero's first fetch is for
  // the shirt the panel starts on. The panel's report effects keep them in
  // line afterwards.
  const [expanded, setExpanded] = useState(initialPicks?.expanded ?? false);
  const [productId, setProductId] = useState(
    () =>
      resolveProductAndSize({
        urlProduct: initialPicks?.productId ?? null,
        urlSize: initialPicks?.size ?? null,
        remembered: remembered ?? null,
      }).productId
  );
  const [colorName, setColorName] = useState(
    () =>
      resolveDefaultColor({
        urlColor: initialPicks?.color ?? null,
        pinnedColor: initialBackgroundColor,
        palette: getBlank(productId)?.colors ?? [],
      }).color
  );
  const initialSides = buyPagePlacements({
    page: { id: imageId, imageUrl },
    added: backEnabled ? (initialPicks?.back ?? null) : null,
    swapped: !!initialPicks?.swapped,
  });
  const [back, setBack] = useState<BackPick | null>(initialSides.back);
  // The front pin: this page's image until the buyer swaps (#138 slice 3).
  const [front, setFront] = useState<BackPick>(initialSides.front);
  // Which side the buyer last made large. Only meaningful with a back
  // picked; reset when the back goes so a later pick starts as the tile.
  const [prominent, setProminent] = useState<Side>("front");
  // The side the full-window viewer (#285) is showing; null is closed.
  // Independent of `prominent`: switching sides in the viewer leaves the
  // page's own hero and tile where they were.
  const [viewerSide, setViewerSide] = useState<Side | null>(null);

  const [slots, setSlots] = useState<Record<Side, SideSlot>>({
    front: EMPTY_SLOT,
    back: EMPTY_SLOT,
  });
  // Bumped by the in-panel Retry; part of the side's selection key, so a
  // retry reads as a new selection and nothing else re-fires on an error.
  const [retryNonce, setRetryNonce] = useState<Record<Side, number>>({
    front: 0,
    back: 0,
  });
  // Latest-wins (#71's pattern), one per side: a fast color/product tap
  // supersedes any in-flight fetch so a stale response can't overwrite a
  // newer selection. Separate tokens — a shared one would let the back's
  // begin() supersede the front's fetch.
  const reqs = useRef({
    front: createLatestWins(),
    back: createLatestWins(),
  }).current;

  const panelRef = useRef<BuyPanelHandle>(null);
  const panelWrapRef = useRef<HTMLDivElement>(null);

  function patchSlot(side: Side, patch: Partial<SideSlot>) {
    setSlots((s) => ({ ...s, [side]: { ...s[side], ...patch } }));
  }

  function handleBackChange(next: BackPick | null) {
    setBack(next);
    if (!next) setProminent("front");
  }

  function retry(side: Side) {
    setRetryNonce((n) => ({ ...n, [side]: n[side] + 1 }));
  }

  const frontKey = `${productId}|${colorName}|${front.id}|${retryNonce.front}`;
  const backKey = back
    ? `${productId}|${colorName}|${back.id}|${retryNonce.back}`
    : null;

  // Front: fetch (or re-fetch) the exact mockup whenever the hero is showing
  // and the product/color selection changes. No-op while collapsed — the
  // whole point is the page stays fetch-free until the buyer opts in.
  useEffect(() => {
    if (!expanded) return;
    const token = reqs.front.begin();
    setSlots((s) => ({
      ...s,
      front: { ...s.front, key: frontKey, mockupUrl: null, loading: true, error: false },
    }));
    getListingMockup({
      imageId,
      productId,
      colorName,
      // Only after a swap — the unswapped call is unchanged.
      ...(front.id !== imageId ? { frontImageId: front.id } : {}),
    })
      .then((result) => {
        if (!reqs.front.isCurrent(token)) return;
        patchSlot("front", { mockupUrl: result.mockupUrl });
      })
      .catch((err) => {
        console.error("getListingMockup failed:", err);
        if (reqs.front.isCurrent(token)) patchSlot("front", { error: true });
      })
      .finally(() => {
        if (reqs.front.isCurrent(token)) patchSlot("front", { loading: false });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, imageId, frontKey]);

  // Back: strictly after the front. The slot's key says what it was filled
  // for — a mismatch means the selection moved on (product, color, pick or
  // retry), so the stale back is dropped at once rather than shown against
  // the new front, and the fetch waits until the front for THIS selection
  // has settled (loaded or failed). A slot already keyed to the current
  // selection is left alone, which is what stops an error from re-firing
  // and a front retry from re-rendering a healthy back.
  useEffect(() => {
    if (!expanded) return;
    const slot = slots.back;
    if (backKey === null || !back) {
      if (slot.key !== null) {
        reqs.back.invalidate();
        setSlots((s) => ({ ...s, back: EMPTY_SLOT }));
      }
      return;
    }
    if (slot.key === backKey) return;
    if (slot.key !== null) {
      reqs.back.invalidate();
      setSlots((s) => ({ ...s, back: EMPTY_SLOT }));
      return;
    }
    const frontSettled = slots.front.key === frontKey && !slots.front.loading;
    if (!frontSettled) return;

    const token = reqs.back.begin();
    setSlots((s) => ({
      ...s,
      back: { ...s.back, key: backKey, mockupUrl: null, loading: true, error: false },
    }));
    getListingBackMockup({
      imageId,
      backImageId: back.id,
      productId,
      colorName,
    })
      .then((result) => {
        if (!reqs.back.isCurrent(token)) return;
        patchSlot("back", { mockupUrl: result.mockupUrl });
      })
      .catch((err) => {
        console.error("getListingBackMockup failed:", err);
        if (reqs.back.isCurrent(token)) patchSlot("back", { error: true });
      })
      .finally(() => {
        if (reqs.back.isCurrent(token)) patchSlot("back", { loading: false });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, imageId, backKey, frontKey, slots]);

  function openBackPicker() {
    panelRef.current?.openBackPicker();
    // The picker opens inside the panel below the fold on a phone; bring it
    // into view. Optional call: jsdom has no scrollIntoView.
    panelWrapRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
    });
  }

  const backArrow = backHref && (
    <Link
      href={backHref}
      aria-label={`Back to ${backLabel}`}
      className="sm:hidden absolute top-2 left-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-foreground bg-background text-foreground"
    >
      <span aria-hidden>←</span>
    </Link>
  );

  const product = getBlank(productId);
  const colorHex =
    product?.colors.find((c) => c.name === colorName)?.value ?? "#ffffff";
  const productName = product?.name ?? "shirt";

  const layout = sidesLayout({
    hasBack: !!back,
    prominent,
    // The add-back tile only makes sense when the blank actually has a back
    // placement to print on.
    backOffered:
      !!backEnabled && !!product && productSupportsPlacement(product, "back"),
  });
  // Two panels on screen at once — the Front/Back pill only means something
  // when there's a counterpart to distinguish it from.
  const twoSided = layout.tile.kind === "side";

  // Always "ready": there's no placement re-render to wait on — this page
  // prints the exact picked images, fixed.
  function displayFor(side: Side) {
    const slot = slots[side];
    const artwork = side === "front" ? front.imageUrl : (back?.imageUrl ?? null);
    return resolveHeroDisplay({
      renderStatus: "ready",
      artworkUrl: artwork,
      lastArtworkUrl: artwork,
      mockupUrl: slot.mockupUrl,
      mockupLoading: slot.loading,
      mockupError: slot.error,
      loadedMockupUrl: slot.loadedMockupUrl,
    });
  }

  function errorFor(side: Side) {
    return slots[side].error
      ? {
          message: "Couldn't render the preview.",
          retryLabel: "Retry preview",
          onRetry: () => retry(side),
        }
      : null;
  }

  function altFor(side: Side) {
    // "This design" names the page's image wherever it sits (the back, after
    // a swap); anything else is named by its side.
    const id = side === "front" ? front.id : back?.id;
    const label =
      id === imageId
        ? "This design"
        : side === "front"
          ? "Front design"
          : "Back design";
    return `${label} on a ${colorName} ${productName}`;
  }

  // A back that goes away while the viewer is on it falls back to the front.
  const shownSide: Side =
    viewerSide === "back" && !back ? "front" : (viewerSide ?? "front");

  const tileSize = "w-1/3 max-w-[8rem] aspect-[4/5]";
  // Hoisted so the narrowing survives into the tile's callbacks below.
  const tileSide = layout.tile.kind === "side" ? layout.tile.side : null;

  return (
    <>
      <div className="relative">
        {backArrow}
        {!expanded ? (
          <PublishedImageView
            imageId={imageId}
            imageUrl={imageUrl}
            alt={alt}
            initialBackgroundColor={initialBackgroundColor}
            canEdit={canEdit}
          />
        ) : (
          <div className="space-y-2">
            {/* Fixed-height hero so the instant-layer
                → mockup crossfade never reflows the page — only the one-time
                collapsed ↔ expanded swap does, which already reveals the
                picker stack below. Tapping the hero opens the viewer (#285) on
                the hero's side; the tile below swaps prominence instead
                (#167). */}
            <SideMockup
              side={layout.hero}
              variant="hero"
              display={displayFor(layout.hero)}
              colorHex={colorHex}
              alt={altFor(layout.hero)}
              pendingLabel="Rendering exact preview…"
              onMockupLoad={(url) =>
                patchSlot(layout.hero, { loadedMockupUrl: url })
              }
              error={errorFor(layout.hero)}
              onSelect={() => setViewerSide(layout.hero)}
              selectLabel={`View larger: ${altFor(layout.hero)}`}
              showSideLabel={twoSided}
              className="w-full h-72 sm:h-80 md:h-96 border border-border"
              testId="side-hero"
            />

            {tileSide && (
              <SideMockup
                side={tileSide}
                variant="tile"
                display={displayFor(tileSide)}
                colorHex={colorHex}
                alt={altFor(tileSide)}
                pendingLabel="Rendering exact preview…"
                onMockupLoad={(url) =>
                  patchSlot(tileSide, { loadedMockupUrl: url })
                }
                error={errorFor(tileSide)}
                onSelect={() => setProminent(tileSide)}
                selectLabel={
                  tileSide === "back" ? "Show back large" : "Show front large"
                }
                showSideLabel={twoSided}
                className={`${tileSize} border border-border`}
                testId="side-tile"
              />
            )}

            {layout.tile.kind === "add-back" && (
              <button
                type="button"
                data-testid="add-back-tile"
                onClick={openBackPicker}
                className={`${tileSize} rounded-lg border border-dashed border-border px-2 text-xs text-text-muted hover:border-border-hover hover:text-foreground transition-colors`}
              >
                Add a back design (+${BACK_PLACEMENT_UPCHARGE.toFixed(2)})
              </button>
            )}
          </div>
        )}
      </div>

      {children}

      <div ref={panelWrapRef}>
        <BuyPanel
          ref={panelRef}
          imageId={imageId}
          imageUrl={imageUrl}
          isLoggedIn={isLoggedIn}
          preferredColor={initialBackgroundColor}
          remembered={remembered}
          backEnabled={backEnabled}
          cartEnabled={cartEnabled}
          startAction={startAction}
          initialPicks={initialPicks}
          editingLine={editingLine}
          onExpandedChange={setExpanded}
          onProductChange={setProductId}
          onColorChange={setColorName}
          onBackChange={handleBackChange}
          onFrontChange={setFront}
        />
      </div>

      {expanded && viewerSide && (
        <FullscreenViewer
          label={`${productName} preview`}
          onClose={() => setViewerSide(null)}
          options={
            back
              ? [
                  { key: "front", label: "Front" },
                  { key: "back", label: "Back" },
                ]
              : undefined
          }
          activeKey={shownSide}
          onSelect={(key) => setViewerSide(key === "back" ? "back" : "front")}
        >
          <SideMockup
            side={shownSide}
            variant="hero"
            display={displayFor(shownSide)}
            colorHex={colorHex}
            alt={altFor(shownSide)}
            pendingLabel="Rendering exact preview…"
            onMockupLoad={(url) => patchSlot(shownSide, { loadedMockupUrl: url })}
            error={errorFor(shownSide)}
            showSideLabel={false}
            className="h-full w-full"
            testId="viewer-side"
          />
        </FullscreenViewer>
      )}
    </>
  );
}
