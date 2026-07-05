import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { createOrder } from "@/lib/printful";
import { generateOrderName } from "@/lib/ai";
import {
  handleStripeCheckoutCompleted,
  type StripeSessionData,
} from "@/lib/webhook-handlers";
import { toStripeSessionData } from "@/lib/stripe-session";
import { sendOrderConfirmation, sendOwnerOrderAlert } from "@/lib/email";
import { sendPostOrderEmails, createDefaultOrderEmailDeps } from "@/lib/order-emails";
import { getDesignDisplayImageUrl, getDesignImageById } from "@/lib/design-images";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    console.error("Stripe webhook signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log(`Stripe webhook received: ${event.type} (${event.id})`);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["total_details.breakdown.discounts.discount"],
    });

    let sessionData: StripeSessionData;
    try {
      sessionData = await toStripeSessionData(fullSession, {
        retrievePromotionCode: async (id) =>
          (await stripe.promotionCodes.retrieve(id)).code ?? null,
      });
    } catch (err) {
      console.error(`Stripe event ${event.id}:`, err);
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
    }
    const orderId = sessionData.metadata.orderId;

    try {
      const result = await handleStripeCheckoutCompleted(sessionData, {
        db,
        createPrintfulOrder: createOrder,
        generateOrderName,
        resolveDesignImageUrl: getDesignDisplayImageUrl,
        resolveImageUrlById: async (imageId) =>
          (await getDesignImageById(imageId))?.imageUrl ?? null,
      });
      console.log(`Stripe event ${event.id}: order ${orderId} → ${result.action}`);

      // Send confirmation + owner alert (fire-and-forget; helper swallows errors)
      if (result.action === "submitted" || result.action === "paid" || result.action === "paid_printful_failed") {
        await sendPostOrderEmails(
          orderId,
          createDefaultOrderEmailDeps(db, { sendOrderConfirmation, sendOwnerOrderAlert })
        );
      }
    } catch (err) {
      console.error(`Stripe event ${event.id}: handler error:`, err);
      return NextResponse.json({ error: "Processing failed" }, { status: 400 });
    }
  }

  return NextResponse.json({ received: true });
}
