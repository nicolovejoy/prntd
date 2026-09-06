// One-off: verify the Model B tables exist on the target DB. `listing` became
// `image_publication` in migration 0013 (composition slice 5).
// Usage: DATABASE_URL=... DATABASE_AUTH_TOKEN=... npx tsx scripts/check-model-b-tables.ts
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL required");

async function main() {
  const client = createClient({ url: url!, authToken });
  const res = await client.execute(
    "select name from sqlite_master where type='table' and name in ('image','conversation_image','image_publication','placement_render') order by name"
  );
  console.log("host:", new URL(url!.replace("libsql://", "https://")).host);
  console.log("tables:", res.rows.map((r) => r.name).join(", ") || "NONE");
  if (res.rows.length !== 4) {
    console.error("MISSING tables — expected 4, got", res.rows.length);
    process.exit(1);
  }
  console.log("OK");
}

main();
