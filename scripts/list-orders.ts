import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../src/lib/db/schema";

const db = drizzle(
  createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  }),
  { schema }
);

async function main() {
  const rows = await db.query.order.findMany({
    columns: {
      id: true,
      status: true,
      printfulOrderId: true,
      printfulCost: true,
      totalPrice: true,
      archivedAt: true,
    },
  });

  const withPrintful = rows.filter((r) => r.printfulOrderId);
  const withoutPrintful = rows.filter((r) => !r.printfulOrderId);

  console.log("=== Orders with Printful IDs ===");
  for (const r of withPrintful) {
    const cost = r.printfulCost !== null ? `$${r.printfulCost.toFixed(2)}` : "no cost";
    const profit = r.printfulCost !== null ? `profit: $${(r.totalPrice - r.printfulCost).toFixed(2)}` : "";
    const archived = r.archivedAt ? " [ARCHIVED]" : "";
    console.log(`  ${r.id.slice(0, 8)}  ${r.status.padEnd(10)}  PF:${r.printfulOrderId}  revenue: $${r.totalPrice.toFixed(2)}  COGS: ${cost}  ${profit}${archived}`);
  }

  console.log(`\n=== Orders without Printful IDs (${withoutPrintful.length}) ===`);
  for (const r of withoutPrintful) {
    const archived = r.archivedAt ? " [ARCHIVED]" : "";
    console.log(`  ${r.id.slice(0, 8)}  ${r.status.padEnd(10)}  $${r.totalPrice.toFixed(2)}${archived}`);
  }

  console.log(`\nTotal: ${rows.length} orders (${withPrintful.length} with Printful, ${withoutPrintful.length} without)`);
}

main().catch(console.error);
