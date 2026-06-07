/**
 * Real-DB test harness (#28). Spins up a fresh in-memory libSQL and creates
 * every table straight from `schema.ts` — no migration files, so the test DB
 * always matches the live schema. This is what mocked tests can't do: a
 * column rename or SQL/Drizzle mismatch surfaces here instead of passing
 * against a hand-built mock.
 *
 * Each createTestDb() is an isolated `:memory:` database. The DDL is derived
 * once per process and replayed per database.
 */
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { db as appDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";

let ddl: Promise<string[]> | null = null;

function deriveDdl(): Promise<string[]> {
  if (!ddl) {
    ddl = (async () => {
      const empty = await generateSQLiteDrizzleJson({});
      const current = await generateSQLiteDrizzleJson(
        schema as unknown as Record<string, unknown>
      );
      return generateSQLiteMigration(empty, current);
    })();
  }
  return ddl;
}

export async function createTestDb(): Promise<typeof appDb> {
  const client = createClient({ url: ":memory:" });
  for (const statement of await deriveDdl()) {
    await client.execute(statement);
  }
  return drizzle(client, { schema }) as unknown as typeof appDb;
}
