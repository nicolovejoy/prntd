"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { SizePicker, ColorPicker } from "@/components/product-options";
import { ACTIVE_BLANKS, DEFAULT_BLANK_ID, getBlank } from "@/lib/blanks";
import {
  computePrice,
  computeOrderTotal,
  BACK_PLACEMENT_UPCHARGE,
} from "@/lib/pricing";
import {
  resolveDefaultColor,
  type PurchaseDefaults,
} from "@/lib/purchase-defaults";
import type { BackSourceGroup } from "@/lib/back-sources";
import { buyPublishedDesign, getBuyPageBackSources } from "../actions";

/**
 * Buy-existing UI on `/d/[imageId]`. Logged-in users pick product/size/color
 * and buy the published design directly (no design step). Signed-out users
 * get a sign-in CTA that returns them here. Price is computed client-side at
 * generationCost 0 — the buyer never incurs generation cost — so it updates
 * instantly without a server round-trip. Phone-first: sticky CTA handled by
 * the page; this is the options block.
 */
export function BuyPanel({
  imageId,
  isLoggedIn,
  preferredColor,
  remembered,
  backEnabled = false,
}: {
  imageId: string;
  isLoggedIn: boolean;
  /** The design's pinned backdrop color; pre-selected when this product carries it. */
  preferredColor?: string | null;
  /** Last-purchase defaults (#44); null for guests/first purchase. */
  remembered?: PurchaseDefaults | null;
  /** Multi-placement flag && signed-in (#25/#72 on /d). The server action
   * re-checks both — this only controls the affordance. */
  backEnabled?: boolean;
}) {
  // Remembered product wins over the static default (#44). No URL params on
  // this surface, so precedence is remembered > static.
  const [productId, setProductId] = useState(
    () => (remembered && getBlank(remembered.blankId) ? remembered.blankId : DEFAULT_BLANK_ID)
  );
  const product = getBlank(productId);
  const sizes = product?.sizes ?? [];
  const colors = product?.colors ?? [];

  // No silent size (#60): a remembered size pre-selects a *visible* chip the
  // buyer can change; with nothing remembered the CTA stays disabled until a
  // pick.
  const [size, setSize] = useState<string | null>(() => {
    const s = remembered?.size;
    return s && (getBlank(productId)?.sizes ?? []).includes(s) ? s : null;
  });
  // The pinned backdrop color IS defaulted (the design is displayed on it),
  // but labeled below so it's not a silent pick.
  const pinnedColorApplied =
    !!preferredColor && colors.some((c) => c.name === preferredColor);
  const [color, setColor] = useState<string>(
    () =>
      resolveDefaultColor({
        urlColor: null,
        pinnedColor: preferredColor ?? null,
        palette: colors,
      }).color
  );
  const [loading, setLoading] = useState(false);

  // Back design (#25 on /d): picked source image, the picker's open state,
  // and its groups (null until first fetched — one fetch per page view).
  const [back, setBack] = useState<{ id: string; imageUrl: string } | null>(
    null
  );
  const [backPickerOpen, setBackPickerOpen] = useState(false);
  const [backGroups, setBackGroups] = useState<BackSourceGroup[] | null>(null);

  function openBackPicker() {
    setBackPickerOpen(true);
    if (backGroups !== null) return;
    getBuyPageBackSources(imageId)
      .then(({ groups }) => setBackGroups(groups))
      .catch(() => setBackGroups([]));
  }

  // Switching product can invalidate the current size/color. Size resets to
  // unselected (never silently re-picked); an invalidated color resets per
  // the §3 precedence — pinned backdrop when the new palette has it, else
  // White, else first — never a carryover from the old palette.
  function handleProduct(id: string) {
    const next = getBlank(id);
    if (!next) return;
    setProductId(id);
    if (size && !next.sizes.includes(size)) setSize(null);
    if (!next.colors.some((c) => c.name === color)) {
      setColor(
        resolveDefaultColor({
          urlColor: null,
          pinnedColor: preferredColor ?? null,
          palette: next.colors,
        }).color
      );
    }
  }

  // Price display before a size is picked uses the base size — S–XL share a
  // price; a 2XL pick updates it live. The Design line stays the front-only
  // price; a picked back design adds its own +$8 line.
  const sizeForPrice = size ?? sizes[0] ?? "M";
  const frontPrice = computePrice(0, productId, sizeForPrice).total;
  const { shipping, total } = computeOrderTotal(
    computePrice(0, productId, sizeForPrice, { back: !!back }).total
  );

  async function handleBuy() {
    if (!size) return;
    setLoading(true);
    try {
      const { url, needsAuth } = await buyPublishedDesign({
        imageId,
        productId,
        size,
        color,
        backImageId: back?.id,
      });
      if (needsAuth) {
        window.location.href = `/sign-in?next=/d/${imageId}`;
        return;
      }
      if (url) window.location.href = url;
    } catch {
      setLoading(false);
    }
  }

  const cta = isLoggedIn ? (
    <div className="space-y-1.5">
      {!size && (
        <p className="text-sm text-text-muted text-center">Choose a size</p>
      )}
      <Button
        onClick={handleBuy}
        disabled={loading || !size}
        size="lg"
        className="w-full"
      >
        {loading ? "Redirecting…" : `Order — $${total.toFixed(2)}`}
      </Button>
    </div>
  ) : (
    <Link href={`/sign-in?next=/d/${imageId}`} className="block">
      <Button size="lg" className="w-full">
        Sign in to buy
      </Button>
    </Link>
  );

  return (
    <div className="space-y-4 sm:space-y-5 border-t border-border pt-4 sm:pt-5">
      {ACTIVE_BLANKS.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-2">Product</label>
          <div className="flex flex-wrap gap-2">
            {ACTIVE_BLANKS.map((p) => (
              <button
                key={p.id}
                onClick={() => handleProduct(p.id)}
                className={`px-3 py-2.5 md:py-1.5 border-2 rounded-md text-sm transition-colors ${
                  productId === p.id
                    ? "border-accent bg-accent text-accent-fg font-medium"
                    : "border-border text-text-muted hover:border-border-hover"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <SizePicker
        sizes={sizes}
        value={size}
        onChange={setSize}
        label={product?.sizeLabel ?? "Size"}
      />
      <ColorPicker
        colors={colors}
        value={color}
        onChange={setColor}
        note={
          pinnedColorApplied
            ? `Shown in ${preferredColor} — designer's pick`
            : undefined
        }
      />

      {backEnabled && (
        <div>
          {back ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={back.imageUrl}
                alt="Back design"
                className="w-11 h-11 rounded-md border border-border bg-checkerboard object-contain"
              />
              <div className="flex-1 text-sm">
                <p>Back design</p>
                <button
                  onClick={openBackPicker}
                  className="text-text-muted underline"
                >
                  Change
                </button>
              </div>
              <button
                onClick={() => {
                  setBack(null);
                  setBackPickerOpen(false);
                }}
                aria-label="Remove back design"
                className="w-11 h-11 flex items-center justify-center rounded-md border border-border text-text-muted hover:border-border-hover"
              >
                ×
              </button>
            </div>
          ) : (
            !backPickerOpen && (
              <button
                onClick={openBackPicker}
                className="min-h-11 text-sm underline text-text-muted hover:text-foreground"
              >
                Add a back design (+${BACK_PLACEMENT_UPCHARGE.toFixed(2)})
              </button>
            )
          )}

          {backPickerOpen && (
            <div className="mt-3 space-y-3 max-h-[50vh] overflow-y-auto border border-border rounded-md p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-text-muted">
                  Pick an image to print on the back.
                </p>
                <button
                  onClick={() => setBackPickerOpen(false)}
                  className="text-sm text-text-muted underline"
                >
                  Cancel
                </button>
              </div>
              {backGroups === null ? (
                <div className="w-8 h-8 mx-auto border-2 border-accent border-t-transparent rounded-full animate-spin" />
              ) : backGroups.length === 0 ? (
                <p className="text-sm text-text-faint">No images available.</p>
              ) : (
                backGroups.map((group) => (
                  <div key={group.id}>
                    <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted mb-1.5">
                      {group.label}
                    </h3>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {group.images.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            setBack({ id: s.id, imageUrl: s.imageUrl });
                            setBackPickerOpen(false);
                          }}
                          className={`aspect-square min-h-11 rounded-md overflow-hidden border-2 bg-checkerboard ${
                            s.id === back?.id
                              ? "border-accent"
                              : "border-border hover:border-accent"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
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
          )}
        </div>
      )}

      <div className="space-y-2 text-sm border-t border-border pt-4">
        <div className="flex justify-between">
          <span className="text-text-muted">Design</span>
          <span>${frontPrice.toFixed(2)}</span>
        </div>
        {back && (
          <div className="flex justify-between">
            <span className="text-text-muted">Back design</span>
            <span>+${BACK_PLACEMENT_UPCHARGE.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-text-muted">Shipping</span>
          <span>${shipping.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-bold border-t border-border pt-2">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </div>

      {/* Desktop: CTA sits inline below the price breakdown. */}
      <div className="hidden md:block">{cta}</div>

      {/* Mobile: CTA pinned to the bottom of the viewport so it's always
          reachable without scrolling the tall image + options column. The
          page reserves matching bottom padding so nothing hides behind it. */}
      <div
        className="md:hidden fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 pt-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {cta}
      </div>
    </div>
  );
}
