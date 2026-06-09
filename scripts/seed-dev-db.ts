/**
 * Seed the dev DB to a known state for repeatable E2E + manual testing
 * (CI/CD roadmap Phase 2). Idempotent — re-running overwrites the same fixed
 * rows. Creates a test user that owns a design with a primary image, so flows
 * that need an existing design (/order, /cart, /preview) can run without
 * generating one (which needs live API keys).
 *
 * Guarded: refuses to run unless DATABASE_URL points at a dev/preview Turso, so
 * it can never seed (or clobber) prod.
 *
 *   npx tsx scripts/seed-dev-db.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL ?? "";
// Allow only obviously-non-prod targets. prod is `prntd-...` without `-dev`/
// `-preview`; local file DBs (file:) are fine too.
const isSafe =
  url.startsWith("file:") ||
  url.includes("prntd-dev") ||
  url.includes("prntd-preview");
if (!isSafe) {
  console.error(
    `Refusing to seed: DATABASE_URL does not look like a dev/preview DB.\n  host: ${url}`
  );
  process.exit(1);
}

const USER_ID = "e2e-seed-user";
const DESIGN_ID = "e2e-seed-design";
const IMAGE_ID = "e2e-seed-image";
// A placeholder that loads in a browser — enough for UI/flow E2E. Real
// fulfillment is short-circuited by PRINTFUL_DRY_RUN in test runs.
const IMAGE_URL = "https://placehold.co/1024x1024/png";

(async () => {
  const c = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  await c.execute({
    sql: `INSERT INTO user (id, email, name, email_verified, created_at, updated_at)
          VALUES (?, ?, ?, 1, unixepoch(), unixepoch())
          ON CONFLICT(id) DO UPDATE SET email = excluded.email`,
    args: [USER_ID, "e2e-seed@prntd.test", "E2E Seed"],
  });

  await c.execute({
    sql: `INSERT INTO design (id, user_id, status, primary_image_id, generation_count, generation_cost, created_at, updated_at)
          VALUES (?, ?, 'draft', ?, 1, 0, unixepoch(), unixepoch())
          ON CONFLICT(id) DO UPDATE SET primary_image_id = excluded.primary_image_id`,
    args: [DESIGN_ID, USER_ID, IMAGE_ID],
  });

  await c.execute({
    sql: `INSERT INTO design_image (id, design_id, aspect_ratio, image_url, is_approved, is_hidden, created_at)
          VALUES (?, ?, '1:1', ?, 0, 0, unixepoch())
          ON CONFLICT(id) DO UPDATE SET image_url = excluded.image_url`,
    args: [IMAGE_ID, DESIGN_ID, IMAGE_URL],
  });

  console.log("seeded dev DB:");
  console.log("  user   :", USER_ID, "(e2e-seed@prntd.test)");
  console.log("  design :", DESIGN_ID, "→ /order?id=" + DESIGN_ID + "&product=bella-canvas-3001&color=Black&size=M");
  console.log("  image  :", IMAGE_ID);
})();
