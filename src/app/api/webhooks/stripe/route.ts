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
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    const designId = session.metadata?.designId;

    if (!orderId || !designId) {
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
    }

    // Mark order as paid
    await db
      .update(orderTable)
      .set({ status: "paid" })
      .where(eq(orderTable.id, orderId));

    // Get order and design details
    const foundOrder = await db.query.order.findFirst({
      where: eq(orderTable.id, orderId),
    });
    const foundDesign = await db.query.design.findFirst({
      where: eq(designTable.id, designId),
    });

    if (foundOrder && foundDesign?.currentImageUrl) {
      try {
        // Submit to Printful
        const variantId = TSHIRT_VARIANTS[foundOrder.color]?.[foundOrder.size];
        if (variantId) {
          const printfulOrder = await createOrder({
            designImageUrl: foundDesign.currentImageUrl,
            size: foundOrder.size,
            color: foundOrder.color,
            variantId,
            // TODO: collect shipping address during checkout
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
        }
      } catch (err) {
        console.error("Printful order submission failed:", err);
        // Order stays as "paid" — can retry manually
      }
    }
  }

  return NextResponse.json({ received: true });
}
