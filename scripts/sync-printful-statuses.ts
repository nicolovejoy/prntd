/**
 * One-time script to sync order statuses from Printful.
 *
 * Fetches all Printful orders and updates our DB to match their current status.
 * Run with: npx tsx scripts/sync-printful-statuses.ts
 *
 * Requires DATABASE_URL, DATABASE_AUTH_TOKEN, and PRINTFUL_API_KEY env vars.
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, isNotNull } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

const db = drizzle(
  createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  }),
  { schema }
);

const PRINTFUL_API = "https://api.printful.com";

async function printfulFetch(path: string) {
  const res = await fetch(`${PRINTFUL_API}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Printful ${res.status}: ${await res.text()}`);
  return res.json();
}

// Map Printful statuses to our statuses
function mapPrintfulStatus(printfulStatus: string): string | null {
  switch (printfulStatus) {
    case "fulfilled":
      return "shipped";
    case "canceled":
    case "failed":
      return null; // don't update canceled orders
    case "pending":
    case "waiting":
    case "inprocess":
      return "submitted";
    default:
      return null;
  }
}

async function main() {
  // Get all our orders that have a printfulOrderId
  const orders = await db
    .select({
      id: schema.order.id,
      status: schema.order.status,
      printfulOrderId: schema.order.printfulOrderId,
    })
    .from(schema.order)
    .where(isNotNull(schema.order.printfulOrderId));

  console.log(`Found ${orders.length} orders with Printful IDs`);

  let updated = 0;
  let skipped = 0;

  for (const order of orders) {
    if (!order.printfulOrderId) continue;

    try {
      const data = await printfulFetch(`/orders/${order.printfulOrderId}`);
      const pfOrder = data.result;
      const pfStatus = pfOrder.status;

      const newStatus = mapPrintfulStatus(pfStatus);

      if (!newStatus || newStatus === order.status) {
        console.log(`  ${order.id.slice(0, 8)} — ${order.status} (Printful: ${pfStatus}) — skip`);
        skipped++;
        continue;
      }

      // Extract tracking info if shipped
      let trackingNumber: string | null = null;
      let trackingUrl: string | null = null;
      if (newStatus === "shipped" && pfOrder.shipments?.length > 0) {
        const shipment = pfOrder.shipments[0];
        trackingNumber = shipment.tracking_number ?? null;
        trackingUrl = shipment.tracking_url ?? null;
      }

      await db
        .update(schema.order)
        .set({
          status: newStatus as "pending" | "paid" | "submitted" | "shipped" | "delivered",
          ...(trackingNumber && { trackingNumber }),
          ...(trackingUrl && { trackingUrl }),
          updatedAt: new Date(),
        })
        .where(eq(schema.order.id, order.id));

      console.log(`  ${order.id.slice(0, 8)} — ${order.status} → ${newStatus} (Printful: ${pfStatus})${trackingNumber ? ` tracking: ${trackingNumber}` : ""}`);
      updated++;
    } catch (err) {
      console.error(`  ${order.id.slice(0, 8)} — error: ${err}`);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch(console.error);
