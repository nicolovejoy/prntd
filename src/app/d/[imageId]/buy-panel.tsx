"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import Link from "next/link";
import { Button, InlineNotice } from "@/components/ui";
import { SizePicker, ColorPicker } from "@/components/product-options";
import { ACTIVE_BLANKS, getBlank } from "@/lib/blanks";
import {
  computePrice,
  computeOrderTotal,
  BACK_PLACEMENT_UPCHARGE,
} from "@/lib/pricing";
import {
  resolveDefaultColor,
  resolveProductAndSize,
  type PurchaseDefaults,
} from "@/lib/purchase-defaults";
import { buyPageHref, withBuyPagePicks } from "@/lib/buy-page-picks";
import type { BackSourceGroup } from "@/lib/back-sources";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import { buyPagePlacements, type PlacementPick } from "@/lib/placement-pins";
import { addToCart } from "@/app/cart/actions";
import { buyPublishedDesign, getBuyPageBackSources } from "../actions";
import { MONO_LABEL } from "./mono-label";
import { useReportBuyPanelPicks } from "./buy-panel-picks-context";
import { ADD_TO_CART_FAILED, CHECKOUT_FAILED } from "@/lib/action-copy";

/** An image on one side of the shirt: the source image id and its artwork
 * URL. Named for its first use (the back pick); the swap (#138 slice 3)
 * reports the front in the same shape. */
export type BackPick = PlacementPick;

export type BuyPanelHandle = {
  /** Open the back-design picker (fetching its groups on first open). */
  openBackPicker: () => void;
};

/**
 * Buy UI on `/d/[imageId]`, for a published image and for the owner's own
 * unpublished one (the page decides, `img.canOrder`; the server re-checks).
 * Collapsed by default (#128): two peer
 * CTAs under the image — "Order" (no price: the total depends on options
 * not yet picked) and the remix action passed in as
 * `startAction`. Tapping Order expands the picker stack in place
 * (product/size/color/back-design, and price once a size is picked); buy
 * stays gated on size only. Cancel under the CTAs collapses it again.
 * With a back picked the buyer can swap the two sides (#138 slice 3): the
 * picked image goes on the front and this page's image on the back. That is
 * the only front change this page offers (no front picker, §1 of
 * docs/buy-flow-front-swap-plan.md), and the server enforces the same rule.
 * Signed-out users see the same collapse; the sign-in gate applies at the
 * buy CTA inside the expanded stack, as before. Price is computed
 * client-side at generationCost 0 — the buyer never incurs generation cost —
 * so it updates instantly without a server round-trip.
 */
export function BuyPanel({
  ref,
  imageId,
  imageUrl,
  isLoggedIn,
  preferredColor,
  remembered,
  backEnabled = false,
  cartEnabled = false,
  startAction,
  initialPicks,
  onExpandedChange,
  onProductChange,
  onColorChange,
  onBackChange,
  onFrontChange,
}: {
  /** Imperative handle (#167): lets the hero's add-a-back tile open this
   * panel's picker without lifting the picker state out of the panel. The
   * picker only renders in the expanded stack, and the tile is only visible
   * while expanded, so the handle assumes expanded. */
  ref?: Ref<BuyPanelHandle>;
  imageId: string;
  /** This page's image URL — the Front row's thumbnail, and what the front
   * reports while not swapped. */
  imageUrl?: string;
  isLoggedIn: boolean;
  /** The design's pinned backdrop color; pre-selected when this product carries it. */
  preferredColor?: string | null;
  /** Last-purchase defaults (#44); null for guests/first purchase. */
  remembered?: PurchaseDefaults | null;
  /** Multi-placement flag && signed-in (#25/#72 on /d). The server action
   * re-checks both — this only controls the affordance. */
  backEnabled?: boolean;
  /** CART_ENABLED (#146). Add to cart needs the flag and a size; no auth
   * gate — guests have carts (the auth gate stays at checkout). */
  cartEnabled?: boolean;
  /** Peer CTA rendered next to Order while collapsed and kept below the
   * stack once expanded (the StartFromImage remix action). */
  startAction?: ReactNode;
  /** Picks carried by the link (#278): the panel starts from them and keeps
   * the address bar in step, so a reload, the sign-in detour and a return
   * from Stripe all come back to the same shirt. Precedence: link >
   * remembered > static. */
  initialPicks?: {
    expanded: boolean;
    productId: string | null;
    size: string | null;
    color: string | null;
    back: BackPick | null;
    swapped: boolean;
  };
  /** Mirrors this panel's expanded/product/color state up to a wrapper
   * (#135 slice 1: the Order-expand hero swap needs to know what to render
   * a mockup for). This panel stays the source of truth for its own state —
   * these are report-only, fired on mount and every change via effects, so
   * callers that don't pass them see byte-identical behavior. */
  onExpandedChange?: (expanded: boolean) => void;
  onProductChange?: (productId: string) => void;
  onColorChange?: (color: string) => void;
  /** What is on the back, or null (#167: the hero renders a back tile for
   * it). After a swap that is this page's image. Same report-only contract
   * as the three above. */
  onBackChange?: (back: BackPick | null) => void;
  /** What is on the front (#138 slice 3): this page's image, or the back
   * pick after a swap. Same report-only contract. */
  onFrontChange?: (front: BackPick) => void;
}) {
  // Progressive disclosure (#128): the picker stack stays hidden until the
  // visitor taps Order.
  const [expanded, setExpanded] = useState(initialPicks?.expanded ?? false);
  // Precedence is link > remembered (#44) > static default (#278).
  const [productId, setProductId] = useState(
    () =>
      resolveProductAndSize({
        urlProduct: initialPicks?.productId ?? null,
        urlSize: initialPicks?.size ?? null,
        remembered: remembered ?? null,
      }).productId
  );
  const product = getBlank(productId);
  const sizes = product?.sizes ?? [];
  const colors = product?.colors ?? [];

  // No silent size (#60): a link's or remembered size pre-selects a *visible*
  // chip the buyer can change; with neither the CTA stays disabled until a
  // pick.
  const [size, setSize] = useState<string | null>(
    () =>
      resolveProductAndSize({
        urlProduct: initialPicks?.productId ?? null,
        urlSize: initialPicks?.size ?? null,
        remembered: remembered ?? null,
      }).size
  );
  // The pinned backdrop color IS defaulted (the design is displayed on it),
  // but labeled below so it's not a silent pick. A color the link names wins
  // over the pinned one; the note shows whenever the selected color equals the
  // pinned one, however it got selected.
  const [color, setColor] = useState<string>(
    () =>
      resolveDefaultColor({
        urlColor: initialPicks?.color ?? null,
        pinnedColor: preferredColor ?? null,
        palette: colors,
      }).color
  );
  // Whether the buyer chose the colour (a swatch tap, or the link named one).
  // Only an unchosen colour is a default, so only it follows a backdrop that
  // gets pinned under a mounted panel (publishing the image from this page).
  const [colorChosen, setColorChosen] = useState(!!initialPicks?.color);
  const [seenPreferredColor, setSeenPreferredColor] = useState(preferredColor);
  if (preferredColor !== seenPreferredColor) {
    setSeenPreferredColor(preferredColor);
    if (!colorChosen) {
      setColor(
        resolveDefaultColor({
          urlColor: null,
          pinnedColor: preferredColor ?? null,
          palette: colors,
        }).color
      );
    }
  }
  const pinnedColorApplied =
    !!preferredColor &&
    color === preferredColor &&
    colors.some((c) => c.name === preferredColor);
  // Whether the buyer chose a garment: the link named one, they switched
  // product, or they picked a size (which is a pick on this garment). Only
  // then does the sign-in link carry `product`; otherwise the product is the
  // static default and a returning customer's remembered one should win
  // after sign-in.
  const [productChosen, setProductChosen] = useState(!!initialPicks?.productId);
  const [loading, setLoading] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);
  // One line under the CTAs when Order or Add to cart fails. The thrown
  // message is a Next.js digest in production, so the copy is our own.
  const [notice, setNotice] = useState<string | null>(null);

  // Report state up to the wrapper (#135 slice 1). Fires on mount too, so a
  // wrapper always has the current product/color/expanded before the buyer
  // ever taps Order.
  useEffect(() => {
    onExpandedChange?.(expanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);
  useEffect(() => {
    onProductChange?.(productId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  useEffect(() => {
    onColorChange?.(color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  // Back design (#25 on /d): picked source image, the picker's open state,
  // and its groups (null until first fetched — one fetch per page view).
  const [back, setBack] = useState<BackPick | null>(
    () => (backEnabled ? (initialPicks?.back ?? null) : null)
  );
  const [backPickerOpen, setBackPickerOpen] = useState(false);
  // Cancel unmounts the focused button; hand focus to the control that
  // re-expands the panel instead of dropping it on <body> (#278 review).
  const expandButton = useRef<HTMLButtonElement>(null);
  const refocusExpand = useRef(false);
  useEffect(() => {
    if (!expanded && refocusExpand.current) {
      refocusExpand.current = false;
      expandButton.current?.focus();
    }
  }, [expanded]);
  const [backGroups, setBackGroups] = useState<BackSourceGroup[] | null>(null);
  // Swap (#138 slice 3): the pick on the front, this page's image on the
  // back. Only meaningful with a pick; picking or removing one resets it.
  const [swapped, setSwapped] = useState(
    () => backEnabled && !!initialPicks?.back && !!initialPicks.swapped
  );
  const sides = buyPagePlacements({
    page: { id: imageId, imageUrl: imageUrl ?? "" },
    added: back,
    swapped,
  });
  // Swapping an image with itself (the page image picked as its own back,
  // via Shop) changes nothing, so it isn't offered.
  const canSwap = !!back && back.id !== imageId;

  // × on the pick, on whichever row it sits. Named for that row.
  const removePick = (
    <button
      onClick={() => {
        setBack(null);
        setSwapped(false);
        setBackPickerOpen(false);
      }}
      aria-label={swapped ? "Remove front design" : "Remove back design"}
      className="w-11 h-11 flex items-center justify-center rounded-md border border-border text-text-muted hover:border-border-hover"
    >
      ×
    </button>
  );

  // Keyed on ids: `sides` is rebuilt every render, and an id names one
  // image, so the report fires exactly when a side's image changes.
  useEffect(() => {
    onBackChange?.(sides.back);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sides.back?.id]);
  useEffect(() => {
    onFrontChange?.(sides.front);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sides.front.id]);

  // Set the moment a navigation away starts (checkout, add to cart): a late
  // state change must not rewrite history after that (#101).
  const navigatingAway = useRef(false);

  // Keep the picks in the address bar while the panel is open (#278).
  // replaceState, not router.replace: a router.replace next to a server-action
  // call gets cancelled. Nothing is written while collapsed, so a browsing
  // visitor's URL stays the bare page, and a collapsed mount leaves the URL
  // exactly as it found it.
  //
  // Limit: replaceState is not seen by Next's router, which keeps its own URL
  // for this entry. A later `router.refresh()` on this page (the owner
  // renaming the title, for one) can put the address bar back to the URL the
  // page was loaded with, without the picks. The panel's state is unaffected.
  useEffect(() => {
    if (!expanded || navigatingAway.current) return;
    const next =
      window.location.pathname +
      withBuyPagePicks(window.location.search, {
        order: true,
        product: productId,
        size,
        color,
        back: back?.id ?? null,
        swap: swapped && !!back,
      });
    if (next === window.location.pathname + window.location.search) return;
    window.history.replaceState(window.history.state, "", next);
  }, [expanded, productId, size, color, back, swapped]);

  // Tell the page what the open panel holds (#278 slice 4), so the links to
  // this conversation's other images carry the same shirt. Null while
  // collapsed, so a browsing visitor's links stay plain. Product and colour go
  // up only once chosen: an untouched default is not a pick, so a sibling
  // opened from it takes its own pinned backdrop. The cleanup clears the
  // report when the panel unmounts.
  const reportPicks = useReportBuyPanelPicks();
  useEffect(() => {
    reportPicks(
      expanded
        ? {
            product: productChosen ? productId : null,
            size,
            color: colorChosen ? color : null,
            back: back?.id ?? null,
            swap: swapped && !!back,
          }
        : null
    );
    return () => reportPicks(null);
  }, [
    reportPicks,
    expanded,
    productChosen,
    productId,
    size,
    colorChosen,
    color,
    back,
    swapped,
  ]);

  // Back from hosted Stripe can restore this page from the back/forward cache
  // with its state as it was when the buyer left: the button on "Redirecting…"
  // and the URL sync switched off. A persisted pageshow means exactly that, so
  // hand the panel back.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      navigatingAway.current = false;
      setLoading(false);
      setAddingToCart(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Cancel (the buyer closing the panel) takes the picks back out, so a reload
  // does not reopen a panel they closed. `from` and `line` stay. This runs
  // from the click, not from the sync effect: only that transition removes
  // picks, never a mount.
  function removePicksFromUrl() {
    const next =
      window.location.pathname +
      withBuyPagePicks(window.location.search, {
        order: false,
        product: null,
        size: null,
        color: null,
        back: null,
        swap: false,
      });
    if (next === window.location.pathname + window.location.search) return;
    window.history.replaceState(window.history.state, "", next);
  }

  function openBackPicker() {
    setBackPickerOpen(true);
    if (backGroups !== null) return;
    getBuyPageBackSources(imageId)
      .then(({ groups }) => setBackGroups(groups))
      .catch(() => setBackGroups([]));
  }

  useImperativeHandle(ref, () => ({ openBackPicker }));

  // Switching product can invalidate the current size/color. Size resets to
  // unselected (never silently re-picked); an invalidated color resets per
  // the §3 precedence — pinned backdrop when the new palette has it, else
  // White, else first — never a carryover from the old palette.
  function handleProduct(id: string) {
    const next = getBlank(id);
    if (!next) return;
    setProductId(id);
    setProductChosen(true);
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

  // No number before a size is picked (owner rule, 2026-09-08): the total
  // depends on it. The Design line stays the front-only price; a picked back
  // design adds its own line. A swap never moves the price.
  const priced = size
    ? {
        front: computePrice(0, productId, size).total,
        ...computeOrderTotal(
          computePrice(0, productId, size, { back: !!sides.back }).total
        ),
      }
    : null;
  // The front travels only when it isn't this page's image — the common
  // request stays byte-identical to the pre-swap shape.
  const frontOverride =
    sides.front.id !== imageId ? sides.front.id : undefined;

  // Sign-in returns to this page with the same shirt open (#278). Built from
  // state, not from the address bar, so it is right even before the first
  // URL sync has run. `product` is left out until the buyer has chosen a
  // garment (see `productChosen`).
  const signInHref = `/sign-in?next=${encodeURIComponent(
    buyPageHref(imageId, {
      order: true,
      product: productChosen ? productId : null,
      size,
      color,
      back: back?.id ?? null,
      swap: swapped && !!back,
    })
  )}`;

  async function handleBuy() {
    if (!size) return;
    navigatingAway.current = true;
    setLoading(true);
    setNotice(null);
    try {
      const { url, needsAuth } = await buyPublishedDesign({
        imageId,
        productId,
        size,
        color,
        backImageId: sides.back?.id,
        ...(frontOverride ? { frontImageId: frontOverride } : {}),
      });
      if (needsAuth) {
        window.location.href = signInHref;
        return;
      }
      if (url) window.location.href = url;
    } catch {
      navigatingAway.current = false;
      setNotice(CHECKOUT_FAILED);
      setLoading(false);
    }
  }

  async function handleAddToCart() {
    if (!size) return;
    navigatingAway.current = true;
    setAddingToCart(true);
    setNotice(null);
    try {
      // A sessionless visitor gets an anonymous session first — guests have
      // carts (the guest funnel re-parents on sign-in); the auth gate stays
      // at checkout. No-op when any session already exists.
      await ensureGuestSession();
      await addToCart({
        // Pin the exact image (#146): the server derives the design from it
        // and rejects anything not published or owned by the buyer. After a
        // swap it rides on the back and `front` names the pick (#138 slice 3).
        frontImageId: imageId,
        productId,
        size,
        color,
        ...(sides.back ? { back: sides.back.id } : {}),
        ...(frontOverride ? { front: frontOverride } : {}),
      });
      // A hard navigation to the cart, not router.push: a concurrent header
      // action can swallow a client-side push (see CLAUDE.md, Runtime gotchas).
      window.location.href = "/cart";
    } catch {
      navigatingAway.current = false;
      setNotice(ADD_TO_CART_FAILED);
      setAddingToCart(false);
    }
  }

  // Add to cart is gated on the flag and a picked size. No
  // auth gate — guests have carts; sign-in is required only at checkout.
  const addToCartButton = cartEnabled ? (
    <Button
      onClick={handleAddToCart}
      disabled={addingToCart || !size}
      variant="secondary"
      size="lg"
      className="w-full"
      data-testid="add-to-cart"
    >
      {addingToCart ? "Adding…" : "Add to cart"}
    </Button>
  ) : null;

  // A text link, not a third button; collapses the panel back to the artwork
  // (#278). Never disabled.
  const cancelButton = (
    <button
      type="button"
      onClick={() => {
        setBackPickerOpen(false);
        refocusExpand.current = true;
        setExpanded(false);
        removePicksFromUrl();
      }}
      className="w-full min-h-11 text-sm underline text-text-muted hover:text-foreground"
    >
      Cancel
    </button>
  );

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
        {loading
          ? "Redirecting…"
          : priced
            ? `Order — $${priced.total.toFixed(2)}`
            : "Order"}
      </Button>
      {addToCartButton}
      {cancelButton}
      {notice && <InlineNotice message={notice} className="text-center" />}
    </div>
  ) : (
    <div className="space-y-1.5">
      {cartEnabled && !size && (
        <p className="text-sm text-text-muted text-center">Choose a size</p>
      )}
      <Link href={signInHref} className="block">
        <Button size="lg" className="w-full">
          Sign in to buy
        </Button>
      </Link>
      {addToCartButton}
      {cancelButton}
      {notice && <InlineNotice message={notice} className="text-center" />}
    </div>
  );

  if (!expanded) {
    return (
      <div className="space-y-2">
        <Button
          size="lg"
          className="w-full"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          ref={expandButton}
          data-testid="order-expand"
        >
          Order
        </Button>
        {startAction}
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5 border-t border-border pt-4 sm:pt-5">
      {ACTIVE_BLANKS.length > 1 && (
        <div>
          <label className={`block ${MONO_LABEL} mb-2`}>Product</label>
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
        onChange={(s) => {
          setSize(s);
          setProductChosen(true);
        }}
        label={product?.sizeLabel ?? "Size"}
      />
      <ColorPicker
        colors={colors}
        value={color}
        onChange={(name) => {
          setColorChosen(true);
          setColor(name);
        }}
        note={
          pinnedColorApplied
            ? `Shown in ${preferredColor} — designer's pick`
            : undefined
        }
      />

      {backEnabled && (
        <div>
          <p className={`${MONO_LABEL} mb-2`}>Front &amp; back</p>
          {back && sides.back ? (
            <div className="space-y-2">
              {/* Front row (#138 slice 3): no Change — this page has no
                  front picker, only the swap below. The row is what tells
                  the buyer which image is on the front after a swap. */}
              <div className="flex items-center gap-3" data-testid="side-row-front">
                <span className="w-10 text-sm text-text-muted">Front</span>
                <SideThumb url={sides.front.imageUrl} alt="Front design" />
                {/* While swapped the pick is on the front: its × comes with
                    it. Removing it puts this page's image back on the front
                    with no back (buyPagePlacements). */}
                {swapped && (
                  <>
                    <div className="flex-1" />
                    {removePick}
                  </>
                )}
              </div>
              <div className="flex items-center gap-3" data-testid="side-row-back">
                <span className="w-10 text-sm text-text-muted">Back</span>
                <SideThumb url={sides.back.imageUrl} alt="Back design" />
                {/* Change replaces the pick through the back picker. Hidden
                    while swapped: on the front it would be a front picker,
                    which this page doesn't offer (swap only). */}
                {!swapped && (
                  <>
                    <div className="flex-1 text-sm">
                      <button
                        onClick={openBackPicker}
                        className="min-h-11 text-text-muted underline"
                      >
                        Change
                      </button>
                    </div>
                    {removePick}
                  </>
                )}
              </div>
              {canSwap && (
                <button
                  onClick={() => {
                    setSwapped((s) => !s);
                    setBackPickerOpen(false);
                  }}
                  // A toggle: announce which way round the shirt is now.
                  aria-pressed={swapped}
                  className="block min-h-11 text-sm underline text-text-muted hover:text-foreground"
                >
                  <span aria-hidden>⇅ </span>Swap front and back
                </button>
              )}
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
                    <h3 className={`${MONO_LABEL} mb-1.5`}>{group.label}</h3>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {group.images.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            setBack({ id: s.id, imageUrl: s.imageUrl });
                            // A new pick always starts on the back: the
                            // picker only ever fills the back.
                            setSwapped(false);
                            setBackPickerOpen(false);
                          }}
                          className={`aspect-square min-h-11 rounded-md overflow-hidden border-2 bg-surface-well ${
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

      {priced && (
        <div className="border-t border-border pt-4">
          <p className={`${MONO_LABEL} mb-2`}>Price</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Design</span>
              <span>${priced.front.toFixed(2)}</span>
            </div>
            {back && (
              <div className="flex justify-between">
                <span className="text-text-muted">Back design</span>
                <span>+${BACK_PLACEMENT_UPCHARGE.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-text-muted">Shipping</span>
              <span>${priced.shipping.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-medium border-t border-border pt-2">
              <span>Total</span>
              <span>${priced.total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Desktop: CTA sits inline below the price breakdown. */}
      <div className="hidden md:block">{cta}</div>

      {startAction}

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

/** 44px well holding one side's artwork (#138 slice 3's Front/Back rows). */
function SideThumb({ url, alt }: { url: string; alt: string }) {
  return (
    <div className="w-11 h-11 shrink-0 rounded-md border border-border bg-surface-well overflow-hidden">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="w-full h-full object-contain" />
      )}
    </div>
  );
}
