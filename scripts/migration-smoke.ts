/**
 * Migration smoke test: snapshot row counts before a migration, then assert
 * nothing was unexpectedly dropped after. Read-only (only counts), so it's safe
 * to run against any target — including prod around a real prod migrate.
 *
 * Enumerates real tables from sqlite_master (ignores sqlite_* and
 * __drizzle_migrations), so it tracks whatever the DB actually has.
 *
 * Target is whatever DATABASE_URL/DATABASE_AUTH_TOKEN resolve to: defaults to
 * .env.local (dev); inline env vars override it (dotenv does not clobber a
 * value already in process.env), matching the db:migrate convention.
 *
 *   # around a dev migration:
 *   npx tsx scripts/migration-smoke.ts before
 *   npm run db:migrate
 *   npx tsx scripts/migration-smoke.ts after
 *
 *   # around a prod migration (inline creds):
 *   DATABASE_URL=libsql://prntd-... DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) \
 *     npx tsx scripts/migration-smoke.ts before
 *   ... migrate ...
 *   DATABASE_URL=... DATABASE_AUTH_TOKEN=... npx tsx scripts/migration-smoke.ts after
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SNAPSHOT = join(tmpdir(), "prntd-migration-counts.json");

type Snapshot = { host: string; counts: Record<string, number> };

function hostOf(url: string): string {
  return url.replace(/^libsql:\/\//, "").split("?")[0].split(".")[0];
}

async function snapshot(): Promise<Snapshot> {
  const url = process.env.DATABASE_URL ?? "";
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  const tables = await client.execute(
    `select name from sqlite_master where type='table'
       and name not like 'sqlite_%' and name not like '__drizzle%'
     order by name`
  );
  const counts: Record<string, number> = {};
  for (const row of tables.rows) {
    const t = String(row.name);
    const r = await client.execute(`select count(*) as c from "${t}"`);
    counts[t] = Number(r.rows[0].c);
  }
  return { host: hostOf(url), counts };
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "before" && mode !== "after") {
    console.error("usage: migration-smoke.ts <before|after>");
    process.exit(2);
  }

  const snap = await snapshot();

  if (mode === "before") {
    writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2));
    console.log(`[before] ${snap.host}: ${Object.keys(snap.counts).length} tables`);
    for (const [t, c] of Object.entries(snap.counts)) console.log(`  ${t} = ${c}`);
    console.log(`\nsnapshot → ${SNAPSHOT}`);
    return;
  }

  // after: compare against the saved before-snapshot
  let before: Snapshot;
  try {
    before = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  } catch {
    console.error(`no before-snapshot at ${SNAPSHOT} — run 'before' first.`);
    process.exit(2);
  }
  if (before.host !== snap.host) {
    console.error(
      `target mismatch: before=${before.host} after=${snap.host}. Same target both runs.`
    );
    process.exit(2);
  }

  const allTables = [...new Set([...Object.keys(before.counts), ...Object.keys(snap.counts)])].sort();
  const dropped: string[] = []; // table existed before, gone after
  const lostRows: string[] = []; // row count decreased

  console.log(`[after] ${snap.host}: before → after`);
  for (const t of allTables) {
    const b = before.counts[t];
    const a = snap.counts[t];
    if (b !== undefined && a === undefined) {
      dropped.push(t);
      console.log(`  ${t}: ${b} → DROPPED`);
    } else if (b === undefined && a !== undefined) {
      console.log(`  ${t}: NEW → ${a}`);
    } else {
      const delta = a - b;
      const flag = delta < 0 ? "  ⚠️ ROWS LOST" : "";
      if (delta < 0) lostRows.push(`${t} (${b} → ${a})`);
      console.log(`  ${t}: ${b} → ${a}${delta ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}${flag}`);
    }
  }

  if (dropped.length || lostRows.length) {
    console.error("\n❌ smoke FAILED — unexpected data loss:");
    if (dropped.length) console.error(`  dropped tables: ${dropped.join(", ")}`);
    if (lostRows.length) console.error(`  rows lost: ${lostRows.join(", ")}`);
    console.error("If this was intentional (a real data migration), confirm and ignore.");
    process.exit(1);
  }
  console.log("\n✅ smoke OK — no tables dropped, no rows lost.");
}

main();
