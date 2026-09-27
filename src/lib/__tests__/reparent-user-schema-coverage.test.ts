/**
 * Schema-driven backstop for reparentUserData (src/lib/reparent-user.ts).
 *
 * Since better-auth 1.6, a failed delete of the anon user (e.g. because a
 * table still has a row pointing at it) is logged and swallowed, not thrown
 * — sign-up succeeds anyway, so nothing but a test would notice a table left
 * behind. That integration test (reparent-user.integration.test.ts) proves
 * the CURRENT list of tables re-parents correctly; this test proves the list
 * is COMPLETE by walking schema.ts itself with drizzle's getTableConfig and
 * finding every table with a foreign key to user.id, so adding a new
 * user-owned table without also adding it to reparent-user.ts fails here
 * with the table's name, not silently.
 */
import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "@/lib/db/schema";

// The tables reparentUserData actually moves. Keep this in sync BY HAND with
// src/lib/reparent-user.ts's db.batch — that's the whole point of the test:
// a table added to schema.ts with a user FK, and forgotten in reparent-user.ts,
// makes the first assertion below fail naming that table.
const REPARENTED_TABLES = new Set([
  "design",
  "order",
  "cart_item",
  "store",
  "product",
  "image",
  "image_generation",
]);

// Tables better-auth owns outright: it deletes these itself as part of
// removing the anon user, so they never go through reparentUserData.
const BETTER_AUTH_OWNED_TABLES = new Set(["session", "account"]);

function tablesWithForeignKeyToUserId(): string[] {
  const found: string[] = [];
  for (const value of Object.values(schema)) {
    if (!value || typeof value !== "object") continue;
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as SQLiteTable);
    } catch {
      continue; // not a drizzle table (schema.ts also exports plain types)
    }
    const referencesUserId = config.foreignKeys.some((fk) => {
      const ref = fk.reference();
      return ref.foreignColumns.some((column) => {
        let foreignTableConfig: ReturnType<typeof getTableConfig>;
        try {
          foreignTableConfig = getTableConfig(column.table as SQLiteTable);
        } catch {
          return false;
        }
        return foreignTableConfig.name === "user" && column.name === "id";
      });
    });
    if (referencesUserId) found.push(config.name);
  }
  return found;
}

describe("reparentUserData schema coverage", () => {
  it("finds at least one table with a user_id/owner_id foreign key (sanity check on the probe itself)", () => {
    expect(tablesWithForeignKeyToUserId().length).toBeGreaterThan(0);
  });

  it("accounts for every table with a foreign key to user.id", () => {
    const tables = tablesWithForeignKeyToUserId();
    const unaccounted = tables.filter(
      (name) =>
        !REPARENTED_TABLES.has(name) && !BETTER_AUTH_OWNED_TABLES.has(name)
    );

    expect(
      unaccounted,
      `These tables have a foreign key to user.id but are handled neither by ` +
        `reparentUserData (src/lib/reparent-user.ts) nor by better-auth's own ` +
        `cleanup (session, account): ${unaccounted.join(", ")}. Since ` +
        `better-auth 1.6, a row left behind here only logs a failed anon-user ` +
        `delete instead of failing sign-up, so a guest's data in this table ` +
        `is silently stranded under the deleted-in-spirit anon user. Add it ` +
        `to reparentUserData's db.batch and to REPARENTED_TABLES above.`
    ).toEqual([]);
  });

  it("keeps REPARENTED_TABLES from drifting stale (a name that no longer has a user FK)", () => {
    const tables = new Set(tablesWithForeignKeyToUserId());
    const stale = [...REPARENTED_TABLES].filter((name) => !tables.has(name));
    expect(
      stale,
      `REPARENTED_TABLES lists a table with no foreign key to user.id: ${stale.join(", ")}. ` +
        `Update the list in this file to match schema.ts.`
    ).toEqual([]);
  });
});
