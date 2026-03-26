import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { order as orderTable, design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createOrder, TSHIRT_VARIANTS } from "@/lib/printful";

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
    const orderId = session.metadata?.orderId;
    const designId = session.metadata?.designId;

    if (!orderId || !designId) {
      console.error(`Stripe event ${event.id}: missing orderId or designId in metadata`);
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
    }

    // Idempotency: check if order is already processed
    const foundOrder = await db.query.order.findFirst({
      where: eq(orderTable.id, orderId),
    });

    if (!foundOrder) {
      console.error(`Stripe event ${event.id}: order ${orderId} not found`);
      return NextResponse.json({ error: "Order not found" }, { status: 400 });
    }

    if (foundOrder.status !== "pending") {
      console.log(`Stripe event ${event.id}: order ${orderId} already ${foundOrder.status}, skipping`);
      return NextResponse.json({ received: true });
    }

    // Mark order as paid
    await db
      .update(orderTable)
      .set({ status: "paid", stripeSessionId: session.id })
      .where(eq(orderTable.id, orderId));

    console.log(`Order ${orderId} marked as paid (Stripe session ${session.id})`);

    // Get design details for Printful submission
    const foundDesign = await db.query.design.findFirst({
      where: eq(designTable.id, designId),
    });

    if (!foundDesign?.currentImageUrl) {
      console.error(`Order ${orderId}: design ${designId} has no image, cannot submit to Printful`);
      return NextResponse.json({ received: true });
    }

    const variantId = TSHIRT_VARIANTS[foundOrder.color]?.[foundOrder.size];
    if (!variantId) {
      console.error(`Order ${orderId}: no variant for ${foundOrder.color} ${foundOrder.size}`);
      return NextResponse.json({ received: true });
    }

    try {
      // TODO: shipping address is not yet collected — Printful will reject this.
      // Once shipping is added to checkout, pass real address here.
      const printfulOrder = await createOrder({
        designImageUrl: foundDesign.currentImageUrl,
        size: foundOrder.size,
        color: foundOrder.color,
        variantId,
        recipientName: "",
        address1: "",
        city: "",
        stateCode: "",
        countryCode: "US",
        zip: "",
      });

      await db
        .update(orderTable)
        .set({
          status: "submitted",
          printfulOrderId: String(printfulOrder.id),
        })
        .where(eq(orderTable.id, orderId));

      // Mark design as ordered
      await db
        .update(designTable)
        .set({ status: "ordered", updatedAt: new Date() })
        .where(eq(designTable.id, designId));

      console.log(`Order ${orderId} submitted to Printful (${printfulOrder.id})`);
    } catch (err) {
      console.error(`Order ${orderId}: Printful submission failed:`, err);
      // Order stays as "paid" — can retry manually
    }
  }

  return NextResponse.json({ received: true });
}
