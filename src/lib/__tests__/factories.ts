/**
 * Shared seed helpers for real-DB integration tests (createTestDb). Kept
 * minimal — only what's duplicated verbatim across test files. Don't force
 * every integration test onto these; add a factory only when a second file
 * needs the exact same shape.
 */
import type { db as appDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";

type Db = typeof appDb;

/** Insert a user row with a deterministic email/name derived from `id`. */
export async function makeUser(db: Db, id: string) {
  await db.insert(schema.user).values({ id, email: `${id}@example.com`, name: id });
}

/** Insert a bare design owned by `userId` and return the row. */
export async function makeDesign(db: Db, userId: string) {
  const [d] = await db.insert(schema.design).values({ userId }).returning();
  return d;
}
