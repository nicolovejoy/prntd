/**
 * One-off: purge orphaned e2e rows left in prntd-dev/prntd-preview when a spec
 * timed out before its finally{} cleanup ran. Matches the throwaway organizer
 * accounts (e2e-org-*@prntd.test) + seeded designs (id like e2e-%) and removes
 * their stores/products/designs/sessions/accounts/user. Same never-prod guard
 * as e2e/helpers/db.ts. Run: `npx tsx --env-file=.env.local scripts/cleanup-e2e-leftovers.ts`
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL ?? "";
const isSafe =
  url.startsWith("file:") ||
  url.includes("prntd-dev") ||
  url.includes("prntd-preview");
if (!isSafe) {
  throw new Error(`Refusing to run against a non-dev DB: ${url}`);
}
const c = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

async function main() {
  // Throwaway organizer accounts the compose spec creates.
  const users = await c.execute({
    sql: "SELECT id, email FROM user WHERE email LIKE 'e2e-org-%@prntd.test'",
    args: [],
  });
  const ids = users.rows.map((r) => r.id as string);
  console.log(`Found ${ids.length} leftover e2e user(s):`, users.rows.map((r) => r.email));

  for (const id of ids) {
    await c.execute({ sql: "DELETE FROM product WHERE owner_id = ?", args: [id] });
    await c.execute({ sql: "DELETE FROM store WHERE owner_id = ?", args: [id] });
    // Seeded designs are owned by these users; drop their images first (FK).
    const designs = await c.execute({
      sql: "SELECT id FROM design WHERE user_id = ?",
      args: [id],
    });
    const dids = designs.rows.map((r) => r.id as string);
    for (const did of dids) {
      await c.execute({ sql: "DELETE FROM cart_item WHERE design_id = ?", args: [did] });
      await c.execute({ sql: "DELETE FROM design_image WHERE design_id = ?", args: [did] });
      await c.execute({ sql: "DELETE FROM design WHERE id = ?", args: [did] });
    }
    await c.execute({ sql: "DELETE FROM session WHERE user_id = ?", args: [id] });
    await c.execute({ sql: "DELETE FROM account WHERE user_id = ?", args: [id] });
    await c.execute({ sql: "DELETE FROM user WHERE id = ?", args: [id] });
  }

  // Any stray seeded designs not tied to a surviving user (e.g. anon-owned
  // designs the cart spec seeds). Drop dependents first — cart_item + order
  // FK to design, and design_image too — before the design rows themselves.
  await c.execute({
    sql: "DELETE FROM cart_item WHERE design_id LIKE 'e2e-%'",
    args: [],
  });
  await c.execute({
    sql: "DELETE FROM \"order\" WHERE design_id LIKE 'e2e-%'",
    args: [],
  });
  const orphanImgs = await c.execute({
    sql: "DELETE FROM design_image WHERE design_id LIKE 'e2e-%'",
    args: [],
  });
  const orphanDesigns = await c.execute({
    sql: "DELETE FROM design WHERE id LIKE 'e2e-%'",
    args: [],
  });
  console.log(
    `Cleaned ${ids.length} user(s); removed ${orphanImgs.rowsAffected} stray design_image + ${orphanDesigns.rowsAffected} stray design rows.`
  );
}

main().then(() => process.exit(0));
