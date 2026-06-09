/**
 * Prints the owner of a design row + whether that user is anonymous.
 * Used to verify the guest-funnel claim-on-sign-in (#26 A1): a design created
 * by an anonymous user should re-parent to the real account after sign-up.
 *
 *   npx tsx scripts/check-design-owner.ts <designId>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const designId = process.argv[2];
if (!designId) {
  console.error("usage: tsx scripts/check-design-owner.ts <designId>");
  process.exit(1);
}

(async () => {
  const client = createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  const d = await client.execute({
    sql: "select id, user_id from design where id = ?",
    args: [designId],
  });
  if (d.rows.length === 0) {
    console.log("design not found:", designId);
    return;
  }
  const userId = d.rows[0].user_id as string;
  const u = await client.execute({
    sql: "select id, email, is_anonymous from user where id = ?",
    args: [userId],
  });
  console.log("design:", designId);
  console.log("owner userId:", userId);
  console.log("owner:", u.rows[0] ?? "(user row missing)");
})();
