import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  order as orderTable,
  orderItem as orderItemTable,
  user as userTable,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handlePrintfulEvent } from "@/lib/webhook-handlers";
import { sendShippingNotification } from "@/lib/email";
import { resolveHeroImages } from "@/lib/order-emails";
import { resolveOrderLines } from "@/lib/order-lines";
import { design as designTable } from "@/lib/db/schema";

// Printful webhook events reference:
// https://developers.printful.com/docs/#tag/Webhooks-API
//
// Printful does not sign webhooks with a secret — they recommend
// verifying by checking the store ID or using IP allowlisting.
// We verify by matching the Printful order ID against our database.

export async function POST(request: NextRequest) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const printfulOrderId = String(payload.data?.order?.id ?? "");
  console.log(`Printful webhook received: ${payload.type} (order ${printfulOrderId})`);

  try {
    const result = await handlePrintfulEvent(payload, { db });
    console.log(`Printful webhook: order ${printfulOrderId} → ${result.action}`);

    // Send shipping email (fire-and-forget)
    if (result.action === "shipped" && result.orderId) {
      try {
        const orderWithUser = await db
          .select({
            email: userTable.email,
            displayName: orderTable.displayName,
            designId: orderTable.designId,
            mockupUrls: designTable.mockupUrls,
          })
          .from(orderTable)
          .innerJoin(userTable, eq(orderTable.userId, userTable.id))
          .leftJoin(designTable, eq(orderTable.designId, designTable.id))
          .where(eq(orderTable.id, result.orderId))
          .then((rows) => rows[0]);

        // Hero comes from the first purchased line (order_item is authoritative
        // since Phase 1c — this path used to read the dropped scalar columns).
        const items = await db.query.orderItem.findMany({
          where: eq(orderItemTable.orderId, result.orderId),
          orderBy: (fields, { asc }) => [asc(fields.createdAt)],
        });
        const [first] = resolveOrderLines(items);

        if (orderWithUser) {
          const images = first
            ? await resolveHeroImages({
                productId: first.blankId,
                color: first.color,
                designId: first.designId,
                placements: first.placements,
                mockupUrls: orderWithUser.mockupUrls ?? null,
              })
            : [];
          await sendShippingNotification({
            to: orderWithUser.email,
            orderId: result.orderId,
            trackingNumber: result.trackingNumber ?? null,
            trackingUrl: result.trackingUrl ?? null,
            displayName: orderWithUser.displayName,
            images,
          });
          console.log(`Order ${result.orderId}: shipping email sent to ${orderWithUser.email}`);
        }
      } catch (emailErr) {
        console.error(`Order ${result.orderId}: failed to send shipping email:`, emailErr);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Printful webhook error: ${message}`);
    const status = message.includes("No order found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
