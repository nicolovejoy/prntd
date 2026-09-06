/**
 * Read-only: print the stored DesignSpec + prompt for the most recent
 * generated images, so #206 can tell "brief returned clarify → fallbackSpec"
 * from "brief committed to a weak interpretation".
 *
 * Prints no secrets. Safe on any target.
 *
 *   node --env-file=.env.local --import tsx scripts/read-design-specs.ts [limit=8]
 *   DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) \
 *     npx tsx scripts/read-design-specs.ts 8
 */
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";

const limit = Number(process.argv[2] ?? 8);
const db = drizzle(
  createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  })
);

async function main() {
  const host = new URL(process.env.DATABASE_URL!).host;
  console.log(`target: ${host}`);
  const r = await db.run(sql`
    SELECT i.id, i.operation, i.prompt, i.design_spec_json, i.created_at,
           ci.design_id
    FROM image i
    JOIN conversation_image ci ON ci.image_id = i.id AND ci.role = 'output'
    WHERE i.operation IS NOT NULL
    ORDER BY i.created_at DESC
    LIMIT ${limit}
  `);
  for (const row of r.rows) {
    const msgs = await db.run(sql`
      SELECT content FROM chat_message
      WHERE design_id = ${row.design_id} AND role = 'user'
      ORDER BY created_at ASC
    `);
    const said = msgs.rows.map((m) => String(m.content).slice(0, 120));
    console.log("─".repeat(72));
    console.log(`image ${row.id}  ${new Date(Number(row.created_at)).toISOString()}  op=${row.operation}`);
    console.log(`user turns: ${JSON.stringify(said)}`);
    console.log(`prompt    : ${String(row.prompt ?? "").slice(0, 200)}`);
    console.log(`spec      : ${row.design_spec_json ?? "(null)"}`);
  }
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  if (cause) console.error("cause:", cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
});
