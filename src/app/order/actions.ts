"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  order as orderTable,
  orderItem as orderItemTable,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { computePrice, computeOrderTotal } from "@/lib/pricing";
import { buildCheckoutSessionParams } from "@/lib/checkout";
import {
  resolveOrderVariant,
  multiPlacementEnabled,
  DEFAULT_BLANK_ID,
} from "@/lib/blanks";
import {
  getDesignDisplayImageUrl,
  resolveImagesByIds,
} from "@/lib/design-images";
import { assertUsablePlacementImage } from "@/lib/back-sources";

export async function calculatePrice(
  designId: string,
  productId?: string,
  size?: string,
  back?: boolean
) {
  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) throw new Error("Design not found");

  return computePrice(found.generationCost, productId, size, { back });
}

export async function createCheckoutSession(params: {
  designId: string;
  size: string;
  color: string;
  productId?: string;
  /** Source image id to print on the FRONT (#138). Optional: the front has
   * always resolved from the design's primary image, and still does when this
   * is absent, so existing links and the Stripe cancel round-trip are
   * unchanged. Guarded exactly like `back` — a front pin grants no reach a
   * back pin didn't already have. */
  front?: string;
  /** Source design_image id to print on the back (#25). Honored only when
   * MULTI_PLACEMENT_ENABLED; ignored otherwise (defense in depth). */
  back?: string;
}): Promise<{ url: string | null; needsAuth?: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  // Purchase point = the funnel's auth gate. Anonymous guests (and the
  // sessionless) must sign in here; after sign-in the anonymous plugin
  // re-parents their design to the real account and the retried checkout
  // passes the ownership check below.
  if (!session || isAnonymousUser(session.user)) {
    return { url: null, needsAuth: true };
  }

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, params.designId),
  });

  if (!found || found.userId !== session.user.id) {
    throw new Error("Design not found");
  }

  const resolvedProductId = params.productId ?? DEFAULT_BLANK_ID;
  // Only honor a back design when the flag is on — keeps a stray `?back=` param
  // from charging the upcharge / pinning a back while the feature is dark.
  const backImageId = multiPlacementEnabled() ? params.back ?? null : null;
  if (backImageId) {
    await assertUsablePlacementImage(
      backImageId,
      params.designId,
      session.user.id,
      "back"
    );
  }
  // Front pin (#138). Unlike `back` this is NOT flag-gated: the front is a
  // required placement that has always been pinned, so choosing which image
  // fills it is not a multi-placement feature.
  const frontImageId = params.front ?? null;
  if (frontImageId) {
    await assertUsablePlacementImage(
      frontImageId,
      params.designId,
      session.user.id,
      "front"
    );
  }
  const pricing = await calculatePrice(
    params.designId,
    resolvedProductId,
    params.size,
    !!backImageId
  );

  // Pin the order to the front image so post-order regenerations don't mutate
  // what this customer's records show: the buyer's explicit pick (#138) when
  // there is one, otherwise the design's current primary image
  // (primary_image_id is the source of truth post Step 5). Falls back to null
  // on a design with neither — rare, only designs that never produced a
  // source image.
  const pinnedImageId = frontImageId ?? found.primaryImageId ?? null;
  // Stripe line thumbnail follows the pin, not the design's display image —
  // they differ the moment the buyer picks a non-primary front (mirrors the
  // cart-thumbnail fix in #146).
  const checkoutImageUrl = frontImageId
    ? (await resolveImagesByIds([frontImageId])).get(frontImageId)?.imageUrl ??
      null
    : await getDesignDisplayImageUrl(params.designId);

  const placements: Record<string, string> | null = pinnedImageId
    ? { front: pinnedImageId, ...(backImageId ? { back: backImageId } : {}) }
    : null;

  return createStripeCheckoutForOrder({
    userId: session.user.id,
    designId: params.designId,
    productId: resolvedProductId,
    size: params.size,
    color: params.color,
    itemPrice: pricing.total,
    placements,
    checkoutImageUrl,
    cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/preview?id=${params.designId}&size=${encodeURIComponent(params.size)}&color=${encodeURIComponent(params.color)}&product=${resolvedProductId}${frontImageId ? `&front=${frontImageId}` : ""}${backImageId ? `&back=${backImageId}` : ""}`,
  });
}

/**
 * Shared order-creation + Stripe-checkout step for both purchase flows
 * (design-your-own via `createCheckoutSession`, buy-existing via
 * `buyPublishedDesign`). Inserts the order row, creates the Stripe
 * session with `buildCheckoutSessionParams`, persists the session id,
 * and returns the redirect URL. Callers own auth, pricing, image-pinning
 * and the cancel URL; this owns the parts that would otherwise drift.
 */
export async function createStripeCheckoutForOrder(params: {
  userId: string;
  designId: string;
  productId: string;
  size: string;
  color: string;
  /** Product price (computePrice total). Shipping is added here. */
  itemPrice: number;
  /** placement id → source design_image id. `front` is the pinned primary;
   * `back` (#25) is present only for multi-placement orders. */
  placements: Record<string, string> | null;
  checkoutImageUrl: string | null;
  cancelUrl: string;
  /** Organizer-pivot attribution (Phase 3). Set for storefront sales so the
   * order ties back to the store + organizer product; null otherwise. */
  storeId?: string | null;
  storeProductId?: string | null;
}): Promise<{ url: string | null }> {
  // Validate product/size/color before taking money — rejects an
  // unknown/discontinued product or a combo with no fulfillable variant.
  const { product } = resolveOrderVariant({
    productId: params.productId,
    size: params.size,
    color: params.color,
  });
  const productName = product.name;

  // Split the charge: product (the line item promos discount) + shipping
  // (a separate Stripe line, excluded from % promos). Persist both plus the
  // grand total; the webhook later reconciles totalPrice to the actual amount
  // charged (after any discount) from Stripe.
  const { item, shipping, total } = computeOrderTotal(params.itemPrice);

  // Phase 1b/1c: the order_item row is the only record of what was bought —
  // the header carries order-level money and linkage only. Order + item commit
  // together; the id is pre-generated so both inserts build before the batch
  // (the checkoutCart pattern). Single line, quantity 1; itemPrice is the
  // product line (shipping is order-level, not per item).
  const orderId = crypto.randomUUID();
  await db.batch([
    db.insert(orderTable).values({
      id: orderId,
      userId: params.userId,
      designId: params.designId,
      totalPrice: total,
      itemPrice: item,
      shippingPrice: shipping,
      storeId: params.storeId ?? null,
      storeProductId: params.storeProductId ?? null,
    }),
    db.insert(orderItemTable).values({
      orderId,
      designId: params.designId,
      productId: params.productId,
      size: params.size,
      color: params.color,
      placements: params.placements,
      quantity: 1,
      itemPrice: item,
    }),
  ]);

  const checkoutSession = await stripe.checkout.sessions.create(
    buildCheckoutSessionParams({
      orderId,
      designId: params.designId,
      productName,
      color: params.color,
      size: params.size,
      itemPrice: item,
      shippingPrice: shipping,
      imageUrl: params.checkoutImageUrl,
      cancelUrl: params.cancelUrl,
      appUrl: process.env.NEXT_PUBLIC_APP_URL!,
    })
  );

  await db
    .update(orderTable)
    .set({ stripeSessionId: checkoutSession.id })
    .where(eq(orderTable.id, orderId));

  return { url: checkoutSession.url };
}
