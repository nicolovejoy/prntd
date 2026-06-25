/**
 * Direct DB access for E2E tests, against the same dev/preview Turso the app
 * under test uses. Lets a spec seed a design owned by the anonymous user the
 * browser just minted (designs are owner-scoped, so a guest can only order
 * its own), and clean up after itself.
 */
import { createClient, type Client } from "@libsql/client";

let cached: Client | null = null;

function db(): Client {
  if (cached) return cached;
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    throw new Error("DATABASE_URL not set — e2e needs the dev/preview DB");
  }
  // Same guard as scripts/seed-dev-db.ts: never touch prod.
  const isSafe =
    url.startsWith("file:") ||
    url.includes("prntd-dev") ||
    url.includes("prntd-preview");
  if (!isSafe) {
    throw new Error(`Refusing to run e2e against a non-dev DB: ${url}`);
  }
  cached = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  return cached;
}

/**
 * Resolve the user id behind a Better-Auth session cookie. The cookie value
 * is `<token>.<signature>`; the session table stores the bare token.
 */
export async function userIdForSessionCookie(
  cookieValue: string
): Promise<string> {
  const token = decodeURIComponent(cookieValue).split(".")[0];
  const res = await db().execute({
    sql: "SELECT user_id FROM session WHERE token = ?",
    args: [token],
  });
  const userId = res.rows[0]?.user_id;
  if (typeof userId !== "string") {
    throw new Error("No session row found for the browser's session cookie");
  }
  return userId;
}

const PLACEHOLDER_IMAGE = "https://placehold.co/1024x1024/png";

/** Seed a draft design (with a primary image) owned by `userId`. */
export async function seedDesign(userId: string, key: string): Promise<string> {
  const designId = `e2e-${key}`;
  const imageId = `e2e-${key}-img`;
  const c = db();
  await c.execute({
    sql: `INSERT INTO design (id, user_id, status, primary_image_id, generation_count, generation_cost, created_at, updated_at)
          VALUES (?, ?, 'draft', ?, 1, 0, unixepoch(), unixepoch())
          ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, primary_image_id = excluded.primary_image_id`,
    args: [designId, userId, imageId],
  });
  await c.execute({
    sql: `INSERT INTO design_image (id, design_id, aspect_ratio, image_url, is_approved, is_hidden, created_at)
          VALUES (?, ?, '1:1', ?, 0, 0, unixepoch())
          ON CONFLICT(id) DO UPDATE SET image_url = excluded.image_url`,
    args: [imageId, designId, PLACEHOLDER_IMAGE],
  });
  return designId;
}

/** Remove everything a spec seeded (cart items first — FK to design). */
export async function cleanupDesigns(designIds: string[]): Promise<void> {
  if (designIds.length === 0) return;
  const c = db();
  const placeholders = designIds.map(() => "?").join(",");
  await c.execute({
    sql: `DELETE FROM cart_item WHERE design_id IN (${placeholders})`,
    args: designIds,
  });
  await c.execute({
    sql: `DELETE FROM design_image WHERE design_id IN (${placeholders})`,
    args: designIds,
  });
  await c.execute({
    sql: `DELETE FROM design WHERE id IN (${placeholders})`,
    args: designIds,
  });
}

/**
 * Remove the stores + products an organizer spec built through the UI.
 * Products first (FK to store + design), then stores. Scoped by owner so a
 * spec only deletes its own account's rows.
 */
export async function cleanupStoresAndProducts(ownerId: string): Promise<void> {
  if (!ownerId) return;
  const c = db();
  await c.execute({
    sql: "DELETE FROM product WHERE owner_id = ?",
    args: [ownerId],
  });
  await c.execute({
    sql: "DELETE FROM store WHERE owner_id = ?",
    args: [ownerId],
  });
}

/**
 * Remove the throwaway account a spec signed up. Session + account rows FK to
 * user, so they go first. Call AFTER the user's designs/stores/products are
 * cleaned (those also FK to user).
 */
export async function cleanupUser(userId: string): Promise<void> {
  if (!userId) return;
  const c = db();
  await c.execute({ sql: "DELETE FROM session WHERE user_id = ?", args: [userId] });
  await c.execute({ sql: "DELETE FROM account WHERE user_id = ?", args: [userId] });
  await c.execute({ sql: "DELETE FROM user WHERE id = ?", args: [userId] });
}
