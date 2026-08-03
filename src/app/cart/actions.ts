"use server";

import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  cartItem as cartItemTable,
  order as orderTable,
  orderItem as orderItemTable,
  design as designTable,
} from "@/lib/db/schema";
import {
  getBlank,
  getVariantId,
  resolveOrderVariant,
} from "@/lib/blanks";
import { computePrice, computeCartTotal, estimateShipping } from "@/lib/pricing";
import { multiPlacementEnabled } from "@/lib/blanks";
import {
  getDesignImageWithOwner,
  resolveDesignDisplayImageUrls,
  resolveImagesByIds,
} from "@/lib/design-images";
import { canUseAsPlacementSource } from "@/lib/design-publish";
import { assertUsableBackImage } from "@/lib/back-sources";
import { estimateOrderCosts } from "@/lib/printful";
import { stripe } from "@/lib/stripe";
import { buildCartCheckoutSessionParams } from "@/lib/checkout";
import { cartEnabled } from "@/lib/flags";

/** Whether the cart UI (nav link, Add-to-cart) should show. Client-readable. */
export async function isCartEnabled(): Promise<boolean> {
  return cartEnabled();
}

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
 *  - `designId` (/preview): the front placement resolves from the design's
 *    pinned primary image (same as createCheckoutSession).
 *  - `frontImageId` (/d, #146): the front placement is pinned to the EXACT
 *    image, mirroring buyPublishedDesign — the design's primary can change
 *    after the add, and the buyer must get the image they tapped, not the
 *    seller's current display image. The line's designId is derived from the
 *    image server-side (never trusted from the client), and the image must
 *    pass canUseAsPlacementSource: the buyer owns it, or it's published and
 *    not admin-hidden. A forged private/hidden image id throws.
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
  /** Exact image to pin as the front placement (/d path, #146). */
  frontImageId?: string;
  productId: string;
  size: string;
  color: string;
  /** Source design_image id to print on the back (#25), if any. */
  back?: string;
}): Promise<{ ok: boolean; count: number }> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Unauthorized");

  // Reject an unfulfillable product/size/color before it can reach checkout.
  resolveOrderVariant({
    productId: params.productId,
    size: params.size,
    color: params.color,
  });

  let designId: string;
  let frontId: string | null;
  if (params.frontImageId) {
    // /d path: pin the exact image. Same guard chain as buyPublishedDesign —
    // resolve the image with its owner, derive the line's designId from it,
    // and reject anything the buyer may not print.
    const image = await getDesignImageWithOwner(params.frontImageId);
    if (!image || !image.designId) throw new Error("Image not found");
    if (
      !canUseAsPlacementSource({
        image,
        imageOwnerId: image.ownerId,
        orderDesignId: image.designId,
        userId,
      })
    ) {
      throw new Error("Image is not available");
    }
    designId = image.designId;
    frontId = params.frontImageId;
  } else {
    if (!params.designId) throw new Error("designId or frontImageId required");
    designId = params.designId;
    const design = await db.query.design.findFirst({
      where: eq(designTable.id, designId),
    });
    frontId = design?.primaryImageId ?? null;
  }

  const backId = multiPlacementEnabled() && params.back ? params.back : null;
  if (backId) {
    // Same choke-point guard as createCheckoutSession (#72): only this
    // thread's images, the user's own designs, or published Shop images. On a
    // /d add designId is the SELLER's design; the guard deliberately gives
    // that no weight (see canUseAsPlacementSource).
    await assertUsableBackImage(backId, designId, userId);
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
  // A line with a pinned front (the /d path, #146) shows the pinned image,
  // not the design's current display image — they can differ, and the pin is
  // what gets printed. /preview lines pin the primary, so this is a no-op
  // for them.
  const pinnedFrontById = await resolveImagesByIds(
    rows.map((r) => r.placements?.front).filter((v): v is string => Boolean(v))
  );

  const items: CartLine[] = [];
  for (const r of rows) {
    const product = getBlank(r.productId);
    if (!product) continue; // discontinued / unknown — drop from view
    const hasBack = !!r.placements?.back;
    const pinnedFront = r.placements?.front
      ? pinnedFrontById.get(r.placements.front)?.imageUrl ?? null
      : null;
    const unitPrice = computePrice(0, r.productId, r.size, { back: hasBack }).total;
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
    });
  }

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
 * the cart itself is cleared by the webhook on payment (#38).
 */
export async function checkoutCart(): Promise<{
  url: string | null;
  needsAuth?: boolean;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) {
    return { url: null, needsAuth: true };
  }
  const userId = session.user.id;

  const view = await getCart();
  if (view.items.length === 0) return { url: null };

  // Order-level row: money + linkage only (Phase 1c). designId mirrors the
  // first line as header linkage; what was bought lives in order_item.
  // Price split is order-level (shipping once). Order + items commit together
  // (#37) — a crash between the two inserts would otherwise leave an order
  // with no lines at all. The id is pre-generated so both statements can be
  // built before the batch.
  const head = view.items[0];
  const orderId = crypto.randomUUID();
  await db.batch([
    db.insert(orderTable).values({
      id: orderId,
      userId,
      designId: head.designId,
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

  const checkoutSession = await stripe.checkout.sessions.create(
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
