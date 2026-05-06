import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { createOrder } from "@/lib/printful";
import { generateOrderName } from "@/lib/ai";
import {
  handleStripeCheckoutCompleted,
  type StripeSessionData,
} from "@/lib/webhook-handlers";
import { sendOrderConfirmation, sendOwnerOrderAlert } from "@/lib/email";
import { sendPostOrderEmails, createDefaultOrderEmailDeps } from "@/lib/order-emails";
import { getDesignDisplayImageUrl } from "@/lib/design-images";

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
    const orderId = fullSession.metadata?.orderId;
    const designId = fullSession.metadata?.designId;

    if (!orderId || !designId) {
      console.error(`Stripe event ${event.id}: missing orderId or designId in metadata`);
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
    }

    const shipping = fullSession.collected_information?.shipping_details;
    const paymentIntentId =
      typeof fullSession.payment_intent === "string"
        ? fullSession.payment_intent
        : fullSession.payment_intent?.id ?? null;

    // Extract discount info if a promotion code was applied
    const discountEntry = fullSession.total_details?.breakdown?.discounts?.[0];
    let discount: StripeSessionData["discount"] = null;
    if (discountEntry && discountEntry.amount > 0) {
      const promoCodeId = discountEntry.discount.promotion_code;
      let code = "unknown";
      if (typeof promoCodeId === "string") {
        try {
          const promoCode = await stripe.promotionCodes.retrieve(promoCodeId);
          code = promoCode.code;
        } catch (err) {
          console.error("Failed to retrieve promotion code:", err);
        }
      }
      discount = {
        code,
        amount: discountEntry.amount / 100,
      };
    }

    const sessionData: StripeSessionData = {
      id: fullSession.id,
      metadata: { orderId, designId },
      paymentIntentId,
      amountTotal: fullSession.amount_total,
      discount,
      shipping: shipping
        ? {
            name: shipping.name ?? "",
            address1: shipping.address?.line1 ?? "",
            address2: shipping.address?.line2 ?? "",
            city: shipping.address?.city ?? "",
            state: shipping.address?.state ?? "",
            zip: shipping.address?.postal_code ?? "",
            country: shipping.address?.country ?? "US",
          }
        : null,
    };

    try {
      const result = await handleStripeCheckoutCompleted(sessionData, {
        db,
        createPrintfulOrder: createOrder,
        generateOrderName,
        resolveDesignImageUrl: getDesignDisplayImageUrl,
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
