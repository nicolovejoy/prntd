"use server";

import { headers } from "next/headers";
import { eq, and, inArray } from "drizzle-orm";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  cartItem as cartItemTable,
  order as orderTable,
  orderItem as orderItemTable,
  design as designTable,
  conversationImage as conversationImageTable,
} from "@/lib/db/schema";
import {
  getBlank,
  getVariantId,
  productSupportsPlacement,
  resolveOrderVariant,
} from "@/lib/blanks";
import { computePrice, computeCartTotal, estimateShipping } from "@/lib/pricing";
import { multiPlacementEnabled } from "@/lib/blanks";
import {
  resolveDesignDisplayImageUrls,
  resolveImagesByIds,
} from "@/lib/design-images";
import { resolveBuyableImage } from "@/lib/buyable-image";
import {
  assertPrimaryNotHidden,
  assertUsablePlacementImage,
} from "@/lib/back-sources";
import { resolveBuyPageFront } from "@/lib/placement-pins";
import { estimateOrderCosts } from "@/lib/printful";
import { stripe } from "@/lib/stripe";
import { abandonSessionlessOrder } from "@/lib/order-checkout";
import { buildCartCheckoutSessionParams } from "@/lib/checkout";
import { cartLineStillValid } from "@/lib/cart-line-check";
import { cartOrderStoreProductId } from "@/lib/cart-attribution";
import { requireMirrorProduct } from "@/lib/model-b-writes";
import { CART_LINE_UNAVAILABLE } from "@/lib/action-copy";
import {
  isValidCartQuantity,
  CART_LINE_MIN_QUANTITY,
  CART_LINE_MAX_QUANTITY,
  cartLineEdit,
  cartLineEditHref,
} from "@/lib/cart-line-edit";

// Indicative destination for the cart's shipping estimate. Hosted Stripe
// Checkout can't recompute shipping after the buyer enters their address, so we
// quote bundled shipping at cart time against a representative US address; that
// quoted amount is what gets charged (#26 B2/B4).
const QUOTE_RECIPIENT = {
  countryCode: "US",
  stateCode: "CA",
  zip: "90001",
  city: "Los Angeles",
};

export type CartLine = {
  id: string;
  designId: string;
  productId: string;
  productName: string;
  size: string;
  color: string;
  placements: Record<string, string> | null;
  hasBack: boolean;
  quantity: number;
  unitPrice: number;
  imageUrl: string | null;
  /** The back design's artwork, when the line has one (#282). */
  backImageUrl: string | null;
  /** The line would not be accepted if added now (an image it pins is no
   * longer something this user may order or print): the cart marks it and
   * checkout refuses until it is removed. */
  unavailable: boolean;
  /** The image detail page link that re-opens this line for editing (#282); null when the line has no front pin. */
  editHref: string | null;
};

export type CartView = {
  items: CartLine[];
  itemSubtotal: number;
  shipping: number;
  total: number;
};

/** Current session user id (anonymous or real), or null. */
async function currentUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

/**
 * Add a line to the current user's cart (#26). Works for anonymous guests — the
 * cart re-parents to their account on sign-in.
 *
 * Two entry shapes, one per surface:
 *  - `designId` (/preview): requires the caller own the design (#251, same
 *    check as createCheckoutSession) — without `front` this entry trusts the
 *    design's CURRENT primary image as the front, so without the check any
 *    design id (public on any published image via getImagePage's
 *    sourceDesignId) could cart a stranger's private artwork. /preview always
 *    sends `front` (#269), the image it is showing; the primary is only the
 *    fallback when `front` is absent. A `front` is guarded the same way
 *    `back` is (#138), so a front pin grants no reach a back pin didn't
 *    already have. A cross-owner add must go through
 *    `frontImageId` instead.
 *  - `frontImageId` (image detail page, #146): the image detail page's image. The front
 *    placement is pinned to that EXACT image, mirroring buyPublishedDesign —
 *    the design's primary can change after the add, and the buyer must get
 *    the image they tapped, not the seller's current display image. The
 *    line's designId is derived from the image server-side (never trusted
 *    from the client), and the image must pass `resolveBuyableImage`, the
 *    gate buyPublishedDesign uses: published and not admin-hidden for anyone,
 *    or the buyer's own unpublished image with a live conversation of theirs.
 *    A forged private, hidden or placement-render id throws. An anonymous
 *    guest may cart their own image (guests have carts; checkout gates
 *    sign-in). `front` on this entry is the page's swap
 *    (#138 slice 3), under the same rule as buyPublishedDesign: another
 *    image may take the front only when `back` is the page image, and it
 *    clears the same guard as the back.
 *
 * A back image is honored only when MULTI_PLACEMENT_ENABLED, guarded the same
 * way at this choke point.
 *
 * No revalidatePath here, nor in removeCartItem/clearCart: nothing renders cart
 * data on the server. /cart is a client page that calls getCart() itself and
 * the header count calls getCartCount(), so the only thing the revalidation
 * bought was a RefreshAll on the navigation Next appends to every server
 * action.
 */
export async function addToCart(params: {
  /** The design to cart (/preview path). Ignored when frontImageId is set. */
  designId?: string;
  /** The image detail page's image (image detail page, #146): the line's designId
   * derives from it, and it is pinned as the front unless `front` swaps it
   * to the back. */
  frontImageId?: string;
  /** Front pick. On the designId path (/preview, #138) any guarded image.
   * On the frontImageId path (image detail page, #138 slice 3) a swap only: accepted when
   * `back` is the page image, refused otherwise. */
  front?: string;
  productId: string;
  size: string;
  color: string;
  /** Source design_image id to print on the back (#25), if any. */
  back?: string;
}): Promise<{ ok: boolean; count: number }> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Unauthorized");

  if (params.frontImageId) {
    // Image detail page path: the shared validation chain, then insert what it resolved.
    const next = await resolveLineInput(
      { ...params, frontImageId: params.frontImageId },
      userId
    );
    await db.insert(cartItemTable).values({ userId, ...next });
    return { ok: true, count: await getCartCount() };
  }

  // Reject an unfulfillable product/size/color before it can reach checkout.
  const { product } = resolveOrderVariant({
    productId: params.productId,
    size: params.size,
    color: params.color,
  });

  if (!params.designId) throw new Error("designId or frontImageId required");
  const designId = params.designId;
  let frontId: string | null;
  // Owner check (#251), mirroring createCheckoutSession: this entry is the
  // design-id one (the former /preview path), which only ever operates on
  // the viewer's own design. Without this check, a design id — public on any
  // published image via getImagePage's sourceDesignId — let any caller cart
  // the design's CURRENT primary image, private or not, with no ownership
  // check at all. A cross-owner add must go through frontImageId instead,
  // which resolveBuyableImage gates (published and visible, or the buyer's
  // own unpublished image through a live conversation of theirs).
  const design = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!design || design.userId !== userId) {
    throw new Error("Design not found");
  }
  if (params.front) {
    // Explicit front pick (#138) — same choke-point guard as the back.
    await assertUsablePlacementImage(params.front, designId, userId, "front");
    frontId = params.front;
  } else {
    frontId = design.primaryImageId ?? null;
    // The implicit primary is trusted as the front; an admin-hidden image
    // must not print (owner ruling, 2026-10-05).
    if (frontId) await assertPrimaryNotHidden(frontId);
  }

  const backId = multiPlacementEnabled() && params.back ? params.back : null;
  if (backId) {
    // Fulfillment drops a placement the blank can't print — a paid-for back
    // would silently vanish.
    if (!productSupportsPlacement(product, "back")) {
      throw new Error("This product has no back print area");
    }
    // Same choke-point guard as createCheckoutSession (#72): the user's own
    // images or published Shop images, never an admin-hidden one. The guard
    // deliberately gives the design id no weight (see canUseAsPlacementSource).
    await assertUsablePlacementImage(backId, designId, userId);
  }
  const placements: Record<string, string> | null = frontId
    ? { front: frontId, ...(backId ? { back: backId } : {}) }
    : null;

  await db.insert(cartItemTable).values({
    userId,
    designId,
    productId: params.productId,
    size: params.size,
    color: params.color,
    placements,
  });

  return { ok: true, count: await getCartCount() };
}

/**
 * The validated row an image-detail-page add or edit writes (#282): the same
 * chain `addToCart`'s `frontImageId` entry has always run (catalog variant,
 * `resolveBuyableImage` on the page image, the back's print area and guard,
 * the swap rule), returned as the columns to write. Throws on any refusal;
 * writes nothing.
 */
async function resolveLineInput(
  params: {
    frontImageId: string;
    front?: string;
    back?: string;
    productId: string;
    size: string;
    color: string;
  },
  userId: string
): Promise<{
  designId: string;
  productId: string;
  size: string;
  color: string;
  placements: Record<string, string>;
}> {
  // Reject an unfulfillable product/size/color before it can reach checkout.
  const { product } = resolveOrderVariant({
    productId: params.productId,
    size: params.size,
    color: params.color,
  });
  // Pin the exact image. Same gate as buyPublishedDesign — derive the line's
  // designId from the image and reject anything the buyer may not order from
  // the page (see resolveBuyableImage).
  const buyable = await resolveBuyableImage(params.frontImageId, userId);
  if (!buyable.ok) {
    throw new Error(
      buyable.reason === "not-found" ? "Image not found" : "Image is not available"
    );
  }
  const designId = buyable.designId;
  let frontId = params.frontImageId;
  const backId = multiPlacementEnabled() && params.back ? params.back : null;
  if (backId) {
    // Fulfillment drops a placement the blank can't print — a paid-for back
    // (after an image detail page swap, the page image itself) would silently vanish.
    if (!productSupportsPlacement(product, "back")) {
      throw new Error("This product has no back print area");
    }
    // Same choke-point guard as createCheckoutSession (#72): the user's own
    // images or published Shop images, never an admin-hidden one. designId is
    // the SELLER's design for a published image and the user's own for their
    // unpublished one; the guard deliberately gives either no weight (see
    // canUseAsPlacementSource).
    await assertUsablePlacementImage(backId, designId, userId);
  }
  // The image detail page swap (#138 slice 3): checked against the back that will actually
  // be pinned, so a back dropped by the flag also refuses the override.
  const swappedFront = resolveBuyPageFront({
    pageImageId: params.frontImageId,
    front: params.front,
    back: backId,
  });
  if (swappedFront !== params.frontImageId) {
    await assertUsablePlacementImage(swappedFront, designId, userId, "front");
    frontId = swappedFront;
  }
  return {
    designId,
    productId: params.productId,
    size: params.size,
    color: params.color,
    placements: { front: frontId, ...(backId ? { back: backId } : {}) },
  };
}

/**
 * Save the image detail page's panel back onto an existing cart line (#282,
 * one buy surface slice 5). The same validation as an add, then ONE
 * owner-scoped UPDATE: a line id from another cart, or a line removed since
 * the panel opened, matches no row and is reported as data (`not-found`), so
 * the panel can say so (production masks thrown errors). Quantity is left as
 * it is: the stepper on the cart page owns it.
 */
export async function updateCartItem(params: {
  id: string;
  frontImageId: string;
  front?: string;
  back?: string;
  productId: string;
  size: string;
  color: string;
}): Promise<{ ok: true } | { ok: false; reason: "not-found" }> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Unauthorized");
  const next = await resolveLineInput(params, userId);
  const updated = await db
    .update(cartItemTable)
    .set(next)
    .where(and(eq(cartItemTable.id, params.id), eq(cartItemTable.userId, userId)))
    .returning({ id: cartItemTable.id });
  return updated.length === 1 ? { ok: true } : { ok: false, reason: "not-found" };
}

/** 1 to 12 (Nico, 2026-10-01). Owner-scoped like removeCartItem. */
export async function setCartItemQuantity(
  id: string,
  quantity: number
): Promise<{ ok: true } | { ok: false; reason: "not-found" }> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Unauthorized");
  if (!isValidCartQuantity(quantity)) {
    throw new Error(
      `Quantity must be between ${CART_LINE_MIN_QUANTITY} and ${CART_LINE_MAX_QUANTITY}`
    );
  }
  const updated = await db
    .update(cartItemTable)
    .set({ quantity })
    .where(and(eq(cartItemTable.id, id), eq(cartItemTable.userId, userId)))
    .returning({ id: cartItemTable.id });
  return updated.length === 1 ? { ok: true } : { ok: false, reason: "not-found" };
}

/**
 * The image detail page asks before turning edit mode on for a `line` in its
 * URL: only the viewer's own line qualifies. Null otherwise, and the page
 * opens in plain buy mode.
 */
export async function getEditableCartLine(
  id: string
): Promise<{ id: string; quantity: number } | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const row = await db.query.cartItem.findFirst({
    where: and(eq(cartItemTable.id, id), eq(cartItemTable.userId, userId)),
    columns: { id: true, quantity: true },
  });
  return row ?? null;
}

export async function removeCartItem(id: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Unauthorized");
  // Scope the delete to the owner so an id from another cart can't be removed.
  await db
    .delete(cartItemTable)
    .where(and(eq(cartItemTable.id, id), eq(cartItemTable.userId, userId)));
}

export async function clearCart(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await db.delete(cartItemTable).where(eq(cartItemTable.userId, userId));
}

export async function getCartCount(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const rows = await db.query.cartItem.findMany({
    where: eq(cartItemTable.userId, userId),
    columns: { id: true },
  });
  return rows.length;
}

/**
 * The full cart for display + checkout: each line priced via computePrice, plus
 * the order-level bundled shipping (live Printful quote, flat fallback) and the
 * grand total. Skips a row whose product is no longer in the catalog.
 */
export async function getCart(): Promise<CartView> {
  const userId = await currentUserId();
  if (!userId) return { items: [], itemSubtotal: 0, shipping: 0, total: 0 };

  const rows = await db.query.cartItem.findMany({
    where: eq(cartItemTable.userId, userId),
  });

  const imageMap = await resolveDesignDisplayImageUrls(
    rows.map((r) => r.designId)
  );
  // Pinned fronts and backs resolve in one call. A line with a pinned front
  // (the image detail page path, #146) shows the pinned image,
  // not the design's current display image — they can differ, and the pin is
  // what gets printed. /preview lines pin the primary, so this is a no-op
  // for them.
  const pinIds = rows
    .flatMap((r) => [r.placements?.front, r.placements?.back])
    .filter((v): v is string => Boolean(v));
  const pinnedById = await resolveImagesByIds(pinIds);

  // Which pinned image is the line's page image (cart-line-edit.ts): the one
  // linked to the line's conversation as an OUTPUT. Seed rows are excluded: a
  // swapped Shop line whose front pick is a seed of the seller's conversation
  // would otherwise count as linked, open on the pick (no swap), and Save would
  // move design_id to the pick's conversation. One query for every line's pins.
  const links =
    pinIds.length > 0
      ? await db
          .select({
            designId: conversationImageTable.designId,
            imageId: conversationImageTable.imageId,
          })
          .from(conversationImageTable)
          .where(
            and(
              inArray(conversationImageTable.designId, rows.map((r) => r.designId)),
              inArray(conversationImageTable.imageId, pinIds),
              eq(conversationImageTable.role, "output")
            )
          )
      : [];
  const linked = new Set(links.map((l) => `${l.designId}:${l.imageId}`));

  const items: CartLine[] = [];
  for (const r of rows) {
    const product = getBlank(r.productId);
    if (!product) continue; // discontinued / unknown — drop from view
    const hasBack = !!r.placements?.back;
    const pinnedFront = r.placements?.front
      ? pinnedById.get(r.placements.front)?.imageUrl ?? null
      : null;
    const unitPrice = computePrice(0, r.productId, r.size, { back: hasBack }).total;
    const edit = cartLineEdit(
      { placements: r.placements ?? null },
      (imageId) => linked.has(`${r.designId}:${imageId}`)
    );
    items.push({
      id: r.id,
      designId: r.designId,
      productId: r.productId,
      productName: product.name,
      size: r.size,
      color: r.color,
      placements: r.placements ?? null,
      hasBack,
      quantity: r.quantity,
      unitPrice,
      imageUrl: pinnedFront ?? imageMap.get(r.designId) ?? null,
      backImageUrl: r.placements?.back
        ? pinnedById.get(r.placements.back)?.imageUrl ?? null
        : null,
      unavailable: false, // set below, all lines at once
      editHref: edit
        ? cartLineEditHref(
            r.id,
            { productId: r.productId, size: r.size, color: r.color },
            edit
          )
        : null,
    });
  }

  // Re-check every line as if it were added now. The lines are independent, so
  // the checks run together instead of one round trip after another.
  const valid = await Promise.all(
    items.map((i) =>
      cartLineStillValid(
        {
          designId: i.designId,
          productId: i.productId,
          size: i.size,
          color: i.color,
          placements: i.placements,
        },
        userId
      )
    )
  );
  items.forEach((i, n) => {
    i.unavailable = !valid[n];
  });

  const shipping = await quoteCartShipping(items);
  const { item, shipping: ship, total } = computeCartTotal(
    items.flatMap((i) => Array(i.quantity).fill(i.unitPrice)),
    shipping
  );

  return { items, itemSubtotal: item, shipping: ship, total };
}

/**
 * Turn the cart into an order and a Stripe Checkout session (#26 B4). The auth
 * gate lives here: anonymous guests get { needsAuth } and sign in first (the
 * cart re-parents to them on sign-in, so it survives). Writes the order +
 * order_item rows and charges N product lines + one bundled shipping line;
 * the cart itself is cleared by the webhook on payment (#38). Every line is
 * re-checked first (`cartLineStillValid`); any stale line refuses the whole
 * checkout with `{ error }` and writes nothing. If creating the Stripe session
 * throws (including building its params), the order is marked abandoned
 * (`abandonSessionlessOrder`), the error is re-thrown, and the cart is left as
 * it was.
 */
export async function checkoutCart(): Promise<{
  url: string | null;
  needsAuth?: boolean;
  error?: string;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) {
    return { url: null, needsAuth: true };
  }
  const userId = session.user.id;

  const view = await getCart();
  if (view.items.length === 0) return { url: null };

  // Every line is re-checked as if it were added now (getCart marks each one):
  // a line validated at add time can have gone stale since (the owner
  // unpublished the image, an admin hid it). One stale line refuses the whole
  // checkout before anything is written; the cart is left as it is so the
  // buyer can remove the line. Returned as data, not thrown, so the message
  // survives production's masking of server-action errors.
  if (view.items.some((i) => i.unavailable)) {
    return { url: null, error: CART_LINE_UNAVAILABLE };
  }

  // Order-level row: money + linkage only (Phase 1c). designId mirrors the
  // first line as header linkage; what was bought lives in order_item.
  // Price split is order-level (shipping once). Order + items commit together
  // (#37) — a crash between the two inserts would otherwise leave an order
  // with no lines at all. The id is pre-generated so both statements can be
  // built before the batch.
  const head = view.items[0];
  const orderId = crypto.randomUUID();

  // Shop attribution (#289 item 2). `order.store_product_id` is a header
  // column, but a cart can hold lines from several compositions, so the order
  // records one only when every published line's front image shares the same
  // mirror product (`cartOrderStoreProductId`); a mixed cart, or one of the
  // buyer's own unpublished work, books null. Per-line attribution would need
  // an order_item column. Only the front counts: the Shop sells the front. An
  // unpublished image is never given a mirror lookup (a stale draft mirror
  // left by an unpublish must not attach itself, as in buyPublishedDesign),
  // and a published front with no mirror throws rather than booking an order
  // with no composition. This runs before the batch, so a throw writes nothing.
  const mirrorByImage = new Map<string, string>();
  const attributionLines: Array<{ published: boolean; storeProductId: string | null }> = [];
  for (const i of view.items) {
    const frontId = i.placements?.front;
    if (!frontId) {
      attributionLines.push({ published: false, storeProductId: null });
      continue;
    }
    const buyable = await resolveBuyableImage(frontId, userId);
    if (!buyable.ok || !buyable.published) {
      attributionLines.push({ published: false, storeProductId: null });
      continue;
    }
    let mirrorId = mirrorByImage.get(frontId);
    if (!mirrorId) {
      mirrorId = await requireMirrorProduct(db, frontId);
      mirrorByImage.set(frontId, mirrorId);
    }
    attributionLines.push({ published: true, storeProductId: mirrorId });
  }
  const storeProductId = cartOrderStoreProductId(attributionLines);

  await db.batch([
    db.insert(orderTable).values({
      id: orderId,
      userId,
      designId: head.designId,
      storeProductId,
      totalPrice: view.total,
      itemPrice: view.itemSubtotal,
      shippingPrice: view.shipping,
    }),
    db.insert(orderItemTable).values(
      view.items.map((i) => ({
        orderId,
        designId: i.designId,
        productId: i.productId,
        size: i.size,
        color: i.color,
        placements: i.placements,
        quantity: i.quantity,
        itemPrice: i.unitPrice,
      }))
    ),
  ]);

  let checkoutSession: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    checkoutSession = await stripe.checkout.sessions.create(
      buildCartCheckoutSessionParams({
        orderId,
        designId: head.designId,
        lineItems: view.items.map((i) => ({
          name: i.productName,
          description: `${i.color} / ${i.size}${i.hasBack ? " · front + back" : ""}`,
          imageUrl: i.imageUrl,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
        })),
        shippingPrice: view.shipping,
        cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/cart`,
        appUrl: process.env.NEXT_PUBLIC_APP_URL!,
      })
    );
  } catch (err) {
    // The order and lines are already written. Mark the order abandoned so it
    // does not linger as a session-less pending order (#289), and re-throw the
    // Stripe error unchanged. The cart is untouched, so the buyer can retry.
    await abandonSessionlessOrder(orderId);
    throw err;
  }

  await db
    .update(orderTable)
    .set({ stripeSessionId: checkoutSession.id })
    .where(eq(orderTable.id, orderId));

  // The cart is NOT cleared here (#38): backing out of Stripe returns to the
  // cancel URL /cart, which must still hold the items. The webhook clears the
  // purchased lines on checkout.session.completed.

  return { url: checkoutSession.url };
}

/**
 * Bundled shipping for the whole cart — one live Printful estimate for all the
 * lines at a representative US destination, so the 2nd+ item's cheaper shipping
 * shows up. Falls back to the flat per-order estimate if the quote is
 * unavailable (dry-run, error, or no resolvable variants).
 */
async function quoteCartShipping(items: CartLine[]): Promise<number> {
  if (items.length === 0) return 0;

  const quoteItems: { variantId: number; quantity: number }[] = [];
  for (const i of items) {
    const product = getBlank(i.productId);
    if (!product) continue;
    const variantId = getVariantId(product, i.color, i.size);
    if (variantId) quoteItems.push({ variantId, quantity: i.quantity });
  }

  if (quoteItems.length > 0) {
    const est = await estimateOrderCosts({
      recipient: QUOTE_RECIPIENT,
      items: quoteItems,
    });
    if (est) return est.shipping;
  }

  // Fallback: flat per-order shipping (count-aware, but flat today).
  return estimateShipping(items.reduce((n, i) => n + i.quantity, 0));
}
