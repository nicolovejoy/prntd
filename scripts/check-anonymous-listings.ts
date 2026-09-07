/**
 * Read-only audit: published listings whose image is owned by a guest
 * (Better-Auth anonymous plugin) account.
 *
 * Publishing was gated behind a real account after it was found that the
 * guest funnel's `if (!session)` check let anonymous users publish to the
 * public feed. That gate stops FUTURE publishes; this script reports what
 * already exists so it can be hidden or left alone deliberately.
 *
 * Writes nothing. Safe to run against prod. Hide anything it finds from
 * /admin/published rather than deleting rows.
 *
 *   DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io \
 *   DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) \
 *   npx tsx scripts/check-anonymous-listings.ts
 */
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  if (!url) throw new Error("DATABASE_URL is required");

  const host = new URL(url.replace("libsql://", "https://")).host;
  console.log(`target: ${host}`);

  const client = createClient({ url, authToken });
  try {
    const { rows } = await client.execute(`
      select l.image_id, l.title, l.is_hidden, l.published_at,
             u.id as owner_id, u.is_anonymous
      from listing l
      join image i on i.id = l.image_id
      join user u on u.id = i.owner_id
      where u.is_anonymous = 1
      order by l.published_at desc
    `);

    const total = await client.execute("select count(*) as n from listing");
    console.log(`listings total: ${total.rows[0].n}`);
    console.log(`listings owned by a guest account: ${rows.length}`);

    for (const r of rows) {
      const when = new Date(Number(r.published_at) * 1000).toISOString();
      const hidden = r.is_hidden ? " [hidden]" : "";
      console.log(`  ${r.image_id}  ${when}  ${r.title ?? "(untitled)"}${hidden}`);
      console.log(`    /admin/published — owner ${r.owner_id}`);
    }

    if (rows.length === 0) console.log("nothing to do.");
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
