"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { getListingMockup } from "../actions";
import { PublishedImageView } from "./published-image-view";
import { BuyPanel } from "./buy-panel";
import { getBlank, DEFAULT_BLANK_ID } from "@/lib/blanks";
import { isDarkShirt, mockupBackdrop, resolveHeroDisplay } from "@/lib/instant-preview";
import { createLatestWins } from "@/lib/latest-wins";
import type { PurchaseDefaults } from "@/lib/purchase-defaults";

/**
 * Owns the product/color selection shared by the hero and `BuyPanel` (#135
 * slice 1) — they're siblings under `page.tsx` (separated by the title/
 * naming block, passed through as `children` so its JSX stays authored in
 * the server page), and `PublishedImageView` also serves the owner's
 * backdrop-picker mode, so buy logic doesn't belong there. `BuyPanel` stays
 * the single source of truth for its own expanded/product/color state; this
 * wrapper just mirrors it (via BuyPanel's report effects) to know what to
 * render a mockup for, and stays mounted as one instance across the hero
 * swap (same position in both returned trees) so BuyPanel's internal state
 * (size, back design, expanded) survives it.
 *
 * Collapsed: renders `PublishedImageView` unchanged — artwork on its pinned
 * backdrop, no mockup fetch, page stays cheap for browsers. Expanded: swaps
 * to the layered hero — instant artwork-on-shirt-color immediately, the
 * Printful mockup (`getListingMockup`, front-only, scale 1.0, anchored to
 * THIS listed image) crossfaded in, matching /preview's pattern
 * (`resolveHeroDisplay` + `mix-blend-multiply` over `mockupBackdrop`).
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
  /** Mobile-only floating back arrow (breadcrumbTrail's `up`), rendered over
   * the hero exactly as it was in page.tsx before the wrapper existed. */
  backHref?: string;
  backLabel?: string;
  /** The title/naming/attribution block — rendered between the hero and
   * `BuyPanel`, matching the page's original visual order. */
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [productId, setProductId] = useState(DEFAULT_BLANK_ID);
  const [colorName, setColorName] = useState(
    initialBackgroundColor ?? "White"
  );

  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [mockupLoading, setMockupLoading] = useState(false);
  const [mockupError, setMockupError] = useState(false);
  const [loadedMockupUrl, setLoadedMockupUrl] = useState<string | null>(null);
  // Latest-wins (#71's pattern): a fast color/product tap supersedes any
  // in-flight fetch so a stale response can't overwrite a newer selection.
  const mockupReq = useRef(createLatestWins()).current;

  // Fetch (or re-fetch) the exact mockup whenever the hero is showing and
  // the product/color selection changes. No-op while collapsed — the whole
  // point is the page stays fetch-free until the buyer opts in.
  useEffect(() => {
    if (!expanded) return;
    const token = mockupReq.begin();
    setMockupLoading(true);
    setMockupError(false);
    setMockupUrl(null);
    getListingMockup({ imageId, productId, colorName })
      .then((result) => {
        if (!mockupReq.isCurrent(token)) return;
        setMockupUrl(result.mockupUrl);
      })
      .catch((err) => {
        console.error("getListingMockup failed:", err);
        if (mockupReq.isCurrent(token)) setMockupError(true);
      })
      .finally(() => {
        if (mockupReq.isCurrent(token)) setMockupLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, imageId, productId, colorName]);

  const backArrow = backHref && (
    <Link
      href={backHref}
      aria-label={`Back to ${backLabel}`}
      className="sm:hidden absolute top-2 left-2 z-10 inline-flex items-center justify-center w-10 h-10 rounded-full bg-black/45 text-white backdrop-blur-sm"
    >
      <span aria-hidden>←</span>
    </Link>
  );

  const product = getBlank(productId);
  const colorHex =
    product?.colors.find((c) => c.name === colorName)?.value ?? "#ffffff";
  const productName = product?.name ?? "shirt";
  // Always "ready": unlike /preview there's no placement re-render to wait
  // on — this page prints the exact listed image, fixed.
  const display = resolveHeroDisplay({
    renderStatus: "ready",
    artworkUrl: imageUrl,
    lastArtworkUrl: imageUrl,
    mockupUrl,
    mockupLoading,
    mockupError,
    loadedMockupUrl,
  });

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
          // Fixed-height hero container (a /preview convention) so the
          // instant-layer → mockup crossfade never reflows the page — only
          // the one-time collapsed → expanded swap does, which already
          // reveals the picker stack below.
          <div className="w-full h-72 sm:h-80 md:h-96 rounded-lg overflow-hidden border border-border relative">
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ backgroundColor: colorHex }}
            >
              {display.artworkUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={display.artworkUrl}
                  alt=""
                  className="object-contain max-h-[80%] max-w-[80%]"
                />
              )}
            </div>

            {display.mockupUrl && (
              <div
                key={display.mockupUrl}
                className={`absolute inset-0 isolate transition-opacity duration-300 ${
                  display.mockupVisible ? "opacity-100" : "opacity-0"
                }`}
                style={{ backgroundColor: mockupBackdrop(colorHex) }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={display.mockupUrl}
                  alt={`This design on a ${colorName} ${productName}`}
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
                  Rendering exact preview…
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {children}

      <BuyPanel
        imageId={imageId}
        isLoggedIn={isLoggedIn}
        preferredColor={initialBackgroundColor}
        remembered={remembered}
        backEnabled={backEnabled}
        cartEnabled={cartEnabled}
        startAction={startAction}
        onExpandedChange={setExpanded}
        onProductChange={setProductId}
        onColorChange={setColorName}
      />
    </>
  );
}
