// Restore deleted designs by copying their rows from a backup Turso branch
// into a target DB (design, chat_message, design_image, image,
// conversation_image, listing, placement_render). R2 objects are untouched —
// deleteDesign never removes them, so the copied rows resolve immediately.
//
// Dry-run by default (prints per-table row counts); --apply performs the
// inserts. INSERT OR IGNORE throughout, so re-runs are idempotent and rows
// already present in the target are never overwritten.
//
// Usage:
//   SOURCE_DATABASE_URL=... SOURCE_DATABASE_AUTH_TOKEN=... \
//   TARGET_DATABASE_URL=... TARGET_DATABASE_AUTH_TOKEN=... \
//   npx tsx scripts/restore-designs-from-backup.ts [--apply] <design-id-or-prefix>...
import { createClient } from "@libsql/client";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const idArgs = args.filter((a) => a !== "--apply");

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;
if (!sourceUrl || !targetUrl) throw new Error("SOURCE_DATABASE_URL and TARGET_DATABASE_URL required");
if (idArgs.length === 0) throw new Error("pass at least one design id (or unambiguous prefix)");

const source = createClient({ url: sourceUrl, authToken: process.env.SOURCE_DATABASE_AUTH_TOKEN });
const target = createClient({ url: targetUrl, authToken: process.env.TARGET_DATABASE_AUTH_TOKEN });

function host(url: string) {
  return new URL(url.replace("libsql://", "https://")).host;
}

async function resolveDesignId(prefix: string): Promise<string> {
  const res = await source.execute({ sql: "select id from design where id like ?", args: [`${prefix}%`] });
  if (res.rows.length === 0) throw new Error(`no design in source matching '${prefix}'`);
  if (res.rows.length > 1) throw new Error(`ambiguous prefix '${prefix}': ${res.rows.map((r) => r.id).join(", ")}`);
  return String(res.rows[0].id);
}

async function copyTable(table: string, sql: string, sqlArgs: string[]) {
  const res = await source.execute({ sql, args: sqlArgs });
  const { columns, rows } = res;
  let inserted = 0;
  if (apply && rows.length > 0) {
    const insert = `insert or ignore into ${table} (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`;
    for (const row of rows) {
      const r = await target.execute({ sql: insert, args: columns.map((c) => row[c] ?? null) });
      inserted += r.rowsAffected;
    }
  }
  console.log(`  ${table}: ${rows.length} in backup${apply ? `, ${inserted} inserted` : ""}`);
}

async function restoreDesign(id: string) {
  const designRes = await source.execute({ sql: "select * from design where id = ?", args: [id] });
  if (designRes.rows.length === 0) throw new Error(`design ${id} not in source`);

  const owner = await target.execute({ sql: "select id from user where id = ?", args: [designRes.rows[0].user_id] });
  if (owner.rows.length === 0) {
    throw new Error(`design ${id}: owner ${designRes.rows[0].user_id} not found in target — restore the user first`);
  }

  const existing = await target.execute({ sql: "select id from design where id = ?", args: [id] });
  if (existing.rows.length > 0) console.log(`  note: design ${id} already exists in target; missing rows still fill in`);

  await copyTable("design", "select * from design where id = ?", [id]);
  await copyTable("chat_message", "select * from chat_message where design_id = ?", [id]);
  await copyTable("design_image", "select * from design_image where design_id = ?", [id]);
  // image rows: source_design_id mirrors the output link, but id-reuse means the
  // design_image id is the authoritative join — cover both.
  await copyTable(
    "image",
    "select * from image where source_design_id = ? or id in (select id from design_image where design_id = ?)",
    [id, id]
  );
  await copyTable("conversation_image", "select * from conversation_image where design_id = ?", [id]);
  await copyTable(
    "listing",
    "select * from listing where image_id in (select id from design_image where design_id = ?)",
    [id]
  );
  await copyTable("placement_render", "select * from placement_render where design_id = ?", [id]);
}

async function main() {
  console.log(`source: ${host(sourceUrl!)}`);
  console.log(`target: ${host(targetUrl!)}`);
  console.log(apply ? "mode: APPLY" : "mode: dry-run (pass --apply to write)");
  for (const arg of idArgs) {
    const id = await resolveDesignId(arg);
    console.log(`\ndesign ${id}:`);
    await restoreDesign(id);
  }
  console.log("\ndone");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
