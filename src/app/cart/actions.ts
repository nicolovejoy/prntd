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
import { revalidatePath } from "next/cache";
import {
  getBlank,
  getVariantId,
  resolveOrderVariant,
} from "@/lib/blanks";
import { computePrice, computeCartTotal, estimateShipping } from "@/lib/pricing";
import { multiPlacementEnabled } from "@/lib/blanks";
import { resolveDesignDisplayImageUrls } from "@/lib/design-images";
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
 * cart re-parents to their account on sign-in. Resolves the front placement
 * from the design's pinned primary image (same as createCheckoutSession), and
 * honors a back image only when MULTI_PLACEMENT_ENABLED.
 */
export async function addToCart(params: {
  designId: string;
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

  const design = await db.query.design.findFirst({
    where: eq(designTable.id, params.designId),
  });
  const frontId = design?.primaryImageId ?? null;
  const backId = multiPlacementEnabled() && params.back ? params.back : null;
  const placements: Record<string, string> | null = frontId
    ? { front: frontId, ...(backId ? { back: backId } : {}) }
    : null;

  await db.insert(cartItemTable).values({
    userId,
    designId: params.designId,
    productId: params.productId,
    size: params.size,
    color: params.color,
    placements,
  });

  revalidatePath("/cart");
  return { ok: true, count: await getCartCount() };
}

export async function removeCartItem(id: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Unauthorized");
  // Scope the delete to the owner so an id from another cart can't be removed.
  await db
    .delete(cartItemTable)
    .where(and(eq(cartItemTable.id, id), eq(cartItemTable.userId, userId)));
  revalidatePath("/cart");
}

export async function clearCart(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await db.delete(cartItemTable).where(eq(cartItemTable.userId, userId));
  revalidatePath("/cart");
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

  const items: CartLine[] = [];
  for (const r of rows) {
    const product = getBlank(r.productId);
    if (!product) continue; // discontinued / unknown — drop from view
    const hasBack = !!r.placements?.back;
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
      imageUrl: imageMap.get(r.designId) ?? null,
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
 * order_item rows, charges N product lines + one bundled shipping line, then
 * clears the cart.
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

  // Order-level row. designId/size/color/productId mirror the first line for
  // back-compat with single-item display code; the authoritative per-item data
  // lives in order_item. Price split is order-level (shipping once).
  const head = view.items[0];
  const [newOrder] = await db
    .insert(orderTable)
    .values({
      userId,
      designId: head.designId,
      productId: head.productId,
      size: head.size,
      color: head.color,
      totalPrice: view.total,
      itemPrice: view.itemSubtotal,
      shippingPrice: view.shipping,
    })
    .returning();

  await db.insert(orderItemTable).values(
    view.items.map((i) => ({
      orderId: newOrder.id,
      designId: i.designId,
      productId: i.productId,
      size: i.size,
      color: i.color,
      placements: i.placements,
      quantity: i.quantity,
      itemPrice: i.unitPrice,
    }))
  );

  const checkoutSession = await stripe.checkout.sessions.create(
    buildCartCheckoutSessionParams({
      orderId: newOrder.id,
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
    .where(eq(orderTable.id, newOrder.id));

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
