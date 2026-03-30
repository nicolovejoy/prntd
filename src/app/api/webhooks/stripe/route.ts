import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { order as orderTable, user as userTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createOrder } from "@/lib/printful";
import {
  handleStripeCheckoutCompleted,
  type StripeSessionData,
} from "@/lib/webhook-handlers";
import { sendOrderConfirmation } from "@/lib/email";

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
    const fullSession = await stripe.checkout.sessions.retrieve(session.id);
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

    const sessionData: StripeSessionData = {
      id: fullSession.id,
      metadata: { orderId, designId },
      paymentIntentId,
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
      });
      console.log(`Stripe event ${event.id}: order ${orderId} → ${result.action}`);

      // Send confirmation email (fire-and-forget)
      if (result.action === "submitted" || result.action === "paid" || result.action === "paid_printful_failed") {
        try {
          const orderWithUser = await db
            .select({ email: userTable.email, size: orderTable.size, color: orderTable.color, quality: orderTable.quality, totalPrice: orderTable.totalPrice })
            .from(orderTable)
            .innerJoin(userTable, eq(orderTable.userId, userTable.id))
            .where(eq(orderTable.id, orderId))
            .then((rows) => rows[0]);

          if (orderWithUser) {
            await sendOrderConfirmation({
              to: orderWithUser.email,
              orderId,
              size: orderWithUser.size,
              color: orderWithUser.color,
              quality: orderWithUser.quality,
              total: orderWithUser.totalPrice,
            });
            console.log(`Order ${orderId}: confirmation email sent to ${orderWithUser.email}`);
          }
        } catch (emailErr) {
          console.error(`Order ${orderId}: failed to send confirmation email:`, emailErr);
        }
      }
    } catch (err) {
      console.error(`Stripe event ${event.id}: handler error:`, err);
      return NextResponse.json({ error: "Processing failed" }, { status: 400 });
    }
  }

  return NextResponse.json({ received: true });
}
