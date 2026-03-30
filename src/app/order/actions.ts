"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable, order as orderTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { computePrice } from "@/lib/pricing";

export async function calculatePrice(designId: string, quality: "standard" | "premium") {
  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) throw new Error("Design not found");

  return computePrice(quality, found.generationCost);
}

export async function createCheckoutSession(params: {
  designId: string;
  size: string;
  color: string;
  quality: "standard" | "premium";
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, params.designId),
  });

  if (!found || found.userId !== session.user.id) {
    throw new Error("Design not found");
  }

  const pricing = await calculatePrice(params.designId, params.quality);

  // Create order record
  const [newOrder] = await db
    .insert(orderTable)
    .values({
      userId: session.user.id,
      designId: params.designId,
      size: params.size,
      color: params.color,
      quality: params.quality,
      totalPrice: pricing.total,
    })
    .returning();

  // Create Stripe checkout session
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    shipping_address_collection: {
      allowed_countries: ["US"],
    },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `PRNTD Custom T-Shirt (${params.quality})`,
            description: `${params.color} / ${params.size}`,
            images: found.currentImageUrl ? [found.currentImageUrl] : [],
          },
          unit_amount: Math.round(pricing.total * 100),
        },
        quantity: 1,
      },
    ],
    metadata: {
      orderId: newOrder.id,
      designId: params.designId,
    },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/order/confirm?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/order?id=${params.designId}&size=${encodeURIComponent(params.size)}&color=${encodeURIComponent(params.color)}&quality=${params.quality}`,
  });

  // Store Stripe session ID
  await db
    .update(orderTable)
    .set({ stripeSessionId: checkoutSession.id })
    .where(eq(orderTable.id, newOrder.id));

  return { url: checkoutSession.url };
}
