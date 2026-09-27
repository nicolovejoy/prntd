"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { computePrice } from "@/lib/pricing";
import { createStripeCheckoutForOrder } from "@/lib/order-checkout";
import {
  multiPlacementEnabled,
  DEFAULT_BLANK_ID,
  getBlank,
  productSupportsPlacement,
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
    // Fulfillment drops a placement the blank can't print, so a back on a
    // blank without one would charge +$8 for nothing. /preview keeps a picked
    // back across a garment switch, so this state is reachable from the UI.
    // Same check as buyPublishedDesign and addToCart; an unknown product
    // falls through to resolveOrderVariant's own refusal.
    const blank = getBlank(resolvedProductId);
    if (blank && !productSupportsPlacement(blank, "back")) {
      throw new Error("This product has no back print area");
    }
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
