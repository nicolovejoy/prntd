// @vitest-environment node
/**
 * Migration 0013 (composition slice 5 + #191 step 2) against a real libSQL,
 * driven by the REAL migrator. The 0006 test replays SQL files
 * statement-by-statement; that is the wrong instrument here, because this
 * migration's safety property lives in how `drizzle-kit migrate` runs it:
 * `drizzle-orm/libsql/migrator` hands every pending statement to
 * `client.migrate()` as ONE batch and rolls the whole batch back — the
 * `__drizzle_migrations` row included — if any statement fails. The guard
 * table at the top of 0013 relies on exactly that, so the guard cases below
 * have to go through `migrate()` (the same code path `npm run db:migrate`
 * takes), not through a hand-rolled loop.
 *
 * Setup: 0000–0012 replayed statement-by-statement (the pre-slice-5 shape,
 * which the schema-derived test-db.ts can never build), the migrator's own
 * `__drizzle_migrations` ledger stamped at 0012's journal `when`, and a
 * migrations folder truncated at 0013 — so the migrator applies exactly 0013
 * whatever lands after it (the 0006 test's "target by number, not position"
 * rule, carried over to the migrator route).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");
const TARGET = /^0013_/;

type Journal = {
  version: string;
  dialect: string;
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
};

function readJournal(): Journal {
  return JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")
  ) as Journal;
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Statement-by-statement replay, as the 0006 test does — for the PRE-0013 chain only. */
async function apply(client: Client, file: string) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) await client.execute(trimmed);
  }
}

/**
 * A migrations folder the migrator will read that ends at 0013: the real
 * journal truncated after the 0013 entry, plus the SQL files it names. Keeps
 * this test pinned to 0013 when 0014+ exist.
 */
function migrationsFolderEndingAt0013(): string {
  const journal = readJournal();
  const end = journal.entries.findIndex((e) => TARGET.test(e.tag));
  if (end === -1) throw new Error("no 0013 entry in drizzle/meta/_journal.json");
  const dir = mkdtempSync(join(tmpdir(), "prntd-migration-0013-"));
  mkdirSync(join(dir, "meta"));
  const entries = journal.entries.slice(0, end + 1);
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2)
  );
  for (const e of entries) {
    copyFileSync(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  }
  return dir;
}

async function tableNames(client: Client): Promise<string[]> {
  const res = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  return res.rows.map((r) => String(r.name));
}

/** table_xinfo, not table_info: VIRTUAL generated columns are hidden from table_info. */
async function columns(client: Client, table: string): Promise<string[]> {
  const res = await client.execute(`PRAGMA table_xinfo(\`${table}\`)`);
  return res.rows.map((r) => String(r.name));
}

async function ledgerCount(client: Client): Promise<number> {
  const res = await client.execute(
    "SELECT count(*) AS n FROM __drizzle_migrations"
  );
  return Number(res.rows[0].n);
}

/**
 * Pre-0013 fixture, in the shapes the drops care about:
 *  - an organizer product (store_id + design_id) whose front is the SAME image
 *    as the mirror's — it must be deleted, or the new unique index collides;
 *  - a loose organizer product (design_id, no store);
 *  - the mirror (Shop composition) for img1, with a title and listed_at;
 *  - the listing row for img1 with the frozen sellable copies;
 *  - a Shop order pointing at the mirror, with its line and a ledger row.
 */
async function seed(client: Client) {
  const run = (sql: string) => client.execute(sql);
  await run(
    "INSERT INTO `user` (`id`, `email`, `name`, `email_verified`, `created_at`, `updated_at`) VALUES ('u', 'u@example.com', 'U', 0, 0, 0)"
  );
  await run(
    "INSERT INTO `design` (`id`, `user_id`, `status`, `created_at`, `updated_at`) VALUES ('d', 'u', 'draft', 0, 0)"
  );
  await run(
    "INSERT INTO `store` (`id`, `owner_id`, `slug`, `name`, `status`, `created_at`, `updated_at`) VALUES ('s', 'u', 'club', 'Club', 'live', 0, 0)"
  );
  await run(
    `INSERT INTO \`product\` (\`id\`, \`owner_id\`, \`store_id\`, \`design_id\`, \`blank_id\`, \`placements\`, \`price\`, \`status\`, \`position\`, \`created_at\`, \`updated_at\`)
     VALUES ('org', 'u', 's', 'd', 'bella-canvas-3001', '{"front":"img1"}', 25, 'listed', 0, 0, 0)`
  );
  await run(
    `INSERT INTO \`product\` (\`id\`, \`owner_id\`, \`design_id\`, \`blank_id\`, \`placements\`, \`status\`, \`position\`, \`created_at\`, \`updated_at\`)
     VALUES ('loose', 'u', 'd', 'bella-canvas-3001', '{"front_large":"img9"}', 'draft', 0, 0, 0)`
  );
  await run(
    `INSERT INTO \`product\` (\`id\`, \`owner_id\`, \`placements\`, \`status\`, \`position\`, \`title\`, \`listed_at\`, \`created_at\`, \`updated_at\`)
     VALUES ('mir', 'u', '{"front":"img1"}', 'listed', 0, 'Kept Title', 5, 0, 0)`
  );
  await run(
    `INSERT INTO \`listing\` (\`image_id\`, \`published_at\`, \`is_hidden\`, \`title\`, \`background_color\`, \`created_at\`)
     VALUES ('img1', 5, 0, 'Frozen Title', 'Navy', 0)`
  );
  await run(
    `INSERT INTO \`order\` (\`id\`, \`user_id\`, \`design_id\`, \`total_price\`, \`status\`, \`store_product_id\`, \`created_at\`)
     VALUES ('o', 'u', 'd', 24.12, 'paid', 'mir', 0)`
  );
  await run(
    `INSERT INTO \`order_item\` (\`id\`, \`order_id\`, \`design_id\`, \`product_id\`, \`size\`, \`color\`, \`placements\`, \`quantity\`, \`item_price\`, \`created_at\`)
     VALUES ('oi', 'o', 'd', 'bella-canvas-3001', 'M', 'Black', '{"front":"img1"}', 1, 19.43, 0)`
  );
  await run(
    `INSERT INTO \`ledger_entry\` (\`id\`, \`order_id\`, \`type\`, \`amount\`, \`currency\`, \`description\`, \`created_at\`)
     VALUES ('l', 'o', 'sale', 24.12, 'USD', 'sale', 0)`
  );
}

describe("migration 0013 — composition slice 5 drops, through the real migrator", () => {
  let client: Client;
  let folder: string;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    const files = migrationFiles();
    const target = files.find((f) => TARGET.test(f))!;
    expect(target).toMatch(TARGET);
    for (const f of files.slice(0, files.indexOf(target))) {
      await apply(client, f);
    }

    // The migrator's own ledger, created exactly as drizzle-orm/libsql/migrator
    // creates it, with one row stamped at 0012's journal `when`. The migrator
    // applies every journal entry whose `when` is greater — with the folder
    // truncated at 0013, that is 0013 alone.
    await client.execute(
      'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)'
    );
    const journal = readJournal();
    const prev = journal.entries.find((e) => /^0012_/.test(e.tag));
    if (!prev) throw new Error("no 0012 entry in the journal");
    await client.execute({
      sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
      args: ["seeded-0012", prev.when],
    });
    expect(await ledgerCount(client)).toBe(1);

    folder = migrationsFolderEndingAt0013();
    await seed(client);
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  const runMigrator = () =>
    migrate(drizzle(client), { migrationsFolder: folder });

  it("applies clean: drops, rename, recreate, unique index, and the ledger row", async () => {
    await runMigrator();

    const tables = await tableNames(client);
    for (const gone of ["store", "product_offering", "listing", "__slice5_guard", "__new_product"]) {
      expect(tables).not.toContain(gone);
    }
    expect(tables).toContain("image_publication");
    expect(tables).toContain("product");

    // The visibility grant, reduced to exactly its four columns, row intact.
    expect(await columns(client, "image_publication")).toEqual([
      "image_id",
      "published_at",
      "is_hidden",
      "created_at",
    ]);
    const pub = await client.execute("SELECT * FROM `image_publication`");
    expect(pub.rows).toHaveLength(1);
    expect(pub.rows[0].image_id).toBe("img1");
    expect(pub.rows[0].published_at).toBe(5);
    expect(pub.rows[0].is_hidden).toBe(0);

    // order.store_id gone; store_product_id still joins the composition.
    expect(await columns(client, "order")).not.toContain("store_id");
    const joined = await client.execute(
      'SELECT p.`title` FROM `order` o JOIN `product` p ON p.`id` = o.`store_product_id` WHERE o.`id` = \'o\''
    );
    expect(joined.rows.map((r) => r.title)).toEqual(["Kept Title"]);

    // product: organizer columns gone, generated front_image_id present, only
    // the Shop composition survives, its fields intact.
    const productCols = await columns(client, "product");
    expect(productCols).not.toContain("store_id");
    expect(productCols).not.toContain("design_id");
    expect(productCols).toContain("front_image_id");
    const products = await client.execute(
      "SELECT `id`, `title`, `listed_at`, `placements`, `front_image_id`, `status` FROM `product`"
    );
    expect(products.rows).toHaveLength(1);
    expect(products.rows[0]).toMatchObject({
      id: "mir",
      title: "Kept Title",
      listed_at: 5,
      placements: '{"front":"img1"}',
      front_image_id: "img1",
      status: "listed",
    });

    const idx = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'product_front_image_unique'"
    );
    expect(idx.rows).toHaveLength(1);
    await expect(
      client.execute(
        `INSERT INTO \`product\` (\`id\`, \`owner_id\`, \`placements\`, \`status\`, \`position\`, \`created_at\`, \`updated_at\`)
         VALUES ('dup', 'u', '{"front":"img1"}', 'listed', 0, 0, 0)`
      )
    ).rejects.toThrow(/UNIQUE/i);

    const fk = await client.execute("PRAGMA foreign_key_check");
    expect(fk.rows).toEqual([]);

    // The order's line and ledger row are untouched.
    expect((await client.execute("SELECT count(*) AS n FROM `order_item`")).rows[0].n).toBe(1);
    expect((await client.execute("SELECT count(*) AS n FROM `ledger_entry`")).rows[0].n).toBe(1);

    expect(await ledgerCount(client)).toBe(2);
  });

  async function expectUntouched() {
    const tables = await tableNames(client);
    expect(tables).toContain("store");
    expect(tables).toContain("listing");
    expect(tables).toContain("product_offering");
    expect(tables).not.toContain("image_publication");
    expect(tables).not.toContain("__slice5_guard");
    const org = await client.execute("SELECT `id` FROM `product` WHERE `id` = 'org'");
    expect(org.rows).toHaveLength(1);
    expect(await columns(client, "order")).toContain("store_id");
    expect(await columns(client, "product")).toContain("design_id");
    // No 0013 row: the batch — ledger insert included — rolled back.
    expect(await ledgerCount(client)).toBe(1);
  }

  it("guard: an order carrying store_id rejects the whole migration and leaves the DB untouched", async () => {
    await client.execute(
      `INSERT INTO \`order\` (\`id\`, \`user_id\`, \`design_id\`, \`total_price\`, \`status\`, \`store_id\`, \`store_product_id\`, \`created_at\`)
       VALUES ('o2', 'u', 'd', 29.69, 'paid', 's', 'org', 0)`
    );

    await expect(runMigrator()).rejects.toThrow(/CHECK|constraint/i);
    await expectUntouched();
  });

  it("guard: an order whose store_product_id is an organizer product rejects the same way", async () => {
    // No store_id anywhere — only the join catches this one.
    await client.execute(
      `INSERT INTO \`order\` (\`id\`, \`user_id\`, \`design_id\`, \`total_price\`, \`status\`, \`store_product_id\`, \`created_at\`)
       VALUES ('o3', 'u', 'd', 29.69, 'paid', 'org', 0)`
    );

    await expect(runMigrator()).rejects.toThrow(/CHECK|constraint/i);
    await expectUntouched();
  });
});
