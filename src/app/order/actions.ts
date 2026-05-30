"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable, order as orderTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { computePrice } from "@/lib/pricing";
import { buildCheckoutSessionParams } from "@/lib/checkout";
import { resolveOrderVariant, DEFAULT_PRODUCT_ID } from "@/lib/products";
import { getDesignDisplayImageUrl } from "@/lib/design-images";

export async function calculatePrice(
  designId: string,
  productId?: string,
  size?: string
) {
  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) throw new Error("Design not found");

  return computePrice(found.generationCost, productId, size);
}

export async function createCheckoutSession(params: {
  designId: string;
  size: string;
  color: string;
  productId?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, params.designId),
  });

  if (!found || found.userId !== session.user.id) {
    throw new Error("Design not found");
  }

  const resolvedProductId = params.productId ?? DEFAULT_PRODUCT_ID;
  const pricing = await calculatePrice(params.designId, resolvedProductId, params.size);

  // Pin the order to the design's current primary image so post-order
  // regenerations don't mutate what this customer's records show.
  // primary_image_id is the source of truth post Step 5; falls back to
  // null on any design without a primary set (rare — only designs that
  // never produced a source image).
  const pinnedImageId = found.primaryImageId ?? null;
  const checkoutImageUrl = await getDesignDisplayImageUrl(params.designId);

  return createStripeCheckoutForOrder({
    userId: session.user.id,
    designId: params.designId,
    productId: resolvedProductId,
    size: params.size,
    color: params.color,
    totalPrice: pricing.total,
    placements: pinnedImageId ? { front: pinnedImageId } : null,
    checkoutImageUrl,
    cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/order?id=${params.designId}&size=${encodeURIComponent(params.size)}&color=${encodeURIComponent(params.color)}&product=${resolvedProductId}`,
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
  totalPrice: number;
  placements: { front: string } | null;
  checkoutImageUrl: string | null;
  cancelUrl: string;
}): Promise<{ url: string | null }> {
  // Validate product/size/color before taking money — rejects an
  // unknown/discontinued product or a combo with no fulfillable variant.
  const { product } = resolveOrderVariant({
    productId: params.productId,
    size: params.size,
    color: params.color,
  });
  const productName = product.name;

  const [newOrder] = await db
    .insert(orderTable)
    .values({
      userId: params.userId,
      designId: params.designId,
      productId: params.productId,
      size: params.size,
      color: params.color,
      totalPrice: params.totalPrice,
      placements: params.placements,
    })
    .returning();

  const checkoutSession = await stripe.checkout.sessions.create(
    buildCheckoutSessionParams({
      orderId: newOrder.id,
      designId: params.designId,
      productName,
      color: params.color,
      size: params.size,
      totalPrice: params.totalPrice,
      imageUrl: params.checkoutImageUrl,
      cancelUrl: params.cancelUrl,
      appUrl: process.env.NEXT_PUBLIC_APP_URL!,
    })
  );

  await db
    .update(orderTable)
    .set({ stripeSessionId: checkoutSession.id })
    .where(eq(orderTable.id, newOrder.id));

  return { url: checkoutSession.url };
}
