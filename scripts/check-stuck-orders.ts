import { createClient } from "@libsql/client";

async function main() {
  const client = createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN!,
  });

  const res = await client.execute(
    `SELECT id, status, size, color, product_id, printful_order_id, stripe_session_id, total_price, created_at
     FROM "order"
     WHERE status = 'pending'
     ORDER BY created_at DESC`
  );

  console.log(`Stuck pending orders: ${res.rows.length}`);
  console.log(JSON.stringify(res.rows, null, 2));
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
