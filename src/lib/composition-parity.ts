/**
 * Composition parity check, dual mode around migration 0013 (composition
 * slice 5 + organizer-storefront retirement step 2, #191).
 *
 * `scripts/check-composition-read-parity.ts` is the CLI; this module is the
 * logic so it can be typechecked and run against real libSQL databases built
 * from the migration chain (`__tests__/composition-parity.integration.test.ts`).
 *
 * Raw SQL over `@libsql/client`, not Drizzle: the same check has to run on the
 * pre-0013 shape (`listing`, `product.store_id` / `design_id`) and the
 * post-0013 shape (`image_publication`, generated `product.front_image_id`),
 * and Drizzle's schema only knows the latter.
 *
 * The mode is read off `sqlite_master`:
 *
 *   - `image_publication` present  → post-0013: Nico's VERIFY after migrating.
 *   - else `listing` present       → pre-0013: Nico's PRE-CHECK before migrating.
 *   - neither                      → not a prntd database; throws.
 *
 * `scripts/migration-smoke.ts` exits 1 on any dropped table, so it cannot
 * verify a drop migration; this check is the verify step for 0013.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client, Row } from "@libsql/client";

export type CompositionParityMode = "pre-0013" | "post-0013";

export type CompositionParityReport = {
  mode: CompositionParityMode;
  /** Anything here means stop: do not apply (pre) / the migration did not land as written (post). */
  problems: string[];
  /** Informational: what the migration will do, and oddities worth a look that fail nothing. */
  notes: string[];
  counts: Record<string, number>;
};

type Journal = { entries: { tag: string; when: number }[] };

/**
 * A journal entry's `when`. The libSQL migrator marks a migration applied by
 * inserting a `__drizzle_migrations` row whose `created_at` is this value, and
 * skips entries whose `when` is ≤ the newest row — so "0013 has been applied"
 * is "a ledger row with created_at ≥ 0013's when", and a pre-0013 database
 * that is really at 0012 has its newest row AT 0012's when. Read at module
 * load; the module is used only by the script and its tests, both of which
 * run from the repo root.
 */
function journalWhen(prefix: RegExp): number {
  const journal = JSON.parse(
    readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")
  ) as Journal;
  const entry = journal.entries.find((e) => prefix.test(e.tag));
  if (!entry) throw new Error(`drizzle/meta/_journal.json has no ${prefix} entry`);
  return entry.when;
}
export const MIGRATION_0012_WHEN: number = journalWhen(/^0012_/);
export const MIGRATION_0013_WHEN: number = journalWhen(/^0013_/);

/** The visibility grant, reduced: exactly these four columns, in this order, after 0013. */
export const IMAGE_PUBLICATION_COLUMNS = ["image_id", "published_at", "is_hidden", "created_at"];

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Drizzle `mode: "timestamp"` integers are seconds since the epoch. */
function isoFromSeconds(v: unknown): string {
  const n = num(v);
  if (n === null || !Number.isFinite(n)) return String(v);
  return new Date(n * 1000).toISOString();
}

const dash = (v: unknown): string => str(v) ?? "—";

async function tableNames(client: Client): Promise<Set<string>> {
  const res = await client.execute(
    "select name from sqlite_master where type = 'table'"
  );
  return new Set(res.rows.map((r) => String(r.name)));
}

/** table_xinfo, not table_info: VIRTUAL generated columns are hidden from table_info. */
async function columnNames(client: Client, table: string): Promise<string[]> {
  const res = await client.execute(`PRAGMA table_xinfo(\`${table}\`)`);
  return res.rows.map((r) => String(r.name));
}

async function count(client: Client, sql: string): Promise<number> {
  const res = await client.execute(sql);
  return Number(res.rows[0].n);
}

export async function checkCompositionParity(
  client: Client
): Promise<CompositionParityReport> {
  const tables = await tableNames(client);
  if (tables.has("image_publication")) return checkPost(client, tables);
  if (tables.has("listing")) return checkPre(client, tables);
  throw new Error(
    "neither image_publication nor listing exists — not a prntd database (or one older than migration 0005)"
  );
}

/**
 * Shared structural check between the visibility rows and the compositions.
 * The pre-0013 caller passes the surviving mirror rows (store_id and
 * design_id both NULL); the post-0013 caller passes every product row, since
 * that is the only population left.
 */
function structuralProblems(
  visibilityLabel: string,
  visibility: Row[],
  compositions: Row[]
): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];

  const byFront = new Map<string, Row[]>();
  const frontless: string[] = [];
  for (const c of compositions) {
    const front = str(c.front_image_id);
    if (front === null) {
      frontless.push(String(c.id));
      continue;
    }
    const list = byFront.get(front) ?? [];
    list.push(c);
    byFront.set(front, list);
  }

  for (const v of visibility) {
    const imageId = String(v.image_id);
    const found = byFront.get(imageId) ?? [];
    if (found.length === 0) {
      problems.push(
        `${imageId}: published image with no composition — invisible in the Shop, and unbuyable since slice 4`
      );
      continue;
    }
    if (found.length > 1) {
      problems.push(
        `${imageId}: ${found.length} compositions pin it as front (expected 1): ${found.map((c) => c.id).join(", ")}`
      );
      continue;
    }
    const c = found[0];
    const expectedStatus = Number(v.is_hidden) ? "hidden" : "listed";
    if (String(c.status) !== expectedStatus) {
      problems.push(
        `${imageId}: composition ${c.id} is ${c.status}, expected ${expectedStatus} (hidden-state disagrees with ${visibilityLabel}.is_hidden)`
      );
    }
    if (num(c.listed_at) === null) {
      problems.push(
        `${imageId}: composition ${c.id} has no listed_at — the feed sort needs it`
      );
    } else if (num(c.listed_at) !== num(v.published_at)) {
      problems.push(
        `${imageId}: composition listed_at ${num(c.listed_at)} != ${visibilityLabel}.published_at ${num(v.published_at)}`
      );
    }
  }

  const visible = new Set(visibility.map((v) => String(v.image_id)));
  for (const [imageId, rows] of byFront) {
    for (const c of rows) {
      if (String(c.status) !== "draft" && !visible.has(imageId)) {
        problems.push(
          `${imageId}: composition ${c.id} is ${c.status} but the image has no ${visibilityLabel} row — in the Shop with no publish grant`
        );
      }
    }
  }

  if (frontless.length) {
    notes.push(
      `${frontless.length} composition(s) have no front placement slot — allowed by the unique index (NULLs are distinct) but nothing can display them: ${frontless.join(", ")}`
    );
  }

  return { problems, notes };
}

/**
 * PRE-0013: proves the migration will (a) run — its guard and its new unique
 * index cannot fail — and (b) delete only what it is meant to. Mirrors the
 * three data-dependent statements in drizzle/0013_flat_mentor.sql.
 */
async function checkPre(
  client: Client,
  tables: Set<string>
): Promise<CompositionParityReport> {
  for (const t of ["product", "order"]) {
    if (!tables.has(t)) {
      throw new Error(`pre-0013 database is missing table ${t} — not a prntd database`);
    }
  }

  const problems: string[] = [];
  const notes: string[] = [];

  // Scratch tables the migration creates. A leftover from an interrupted run
  // makes its CREATE TABLE fail — a rollback, but one that reads like a bug.
  for (const t of ["__slice5_guard", "__new_product"]) {
    if (tables.has(t)) {
      problems.push(
        `table ${t} already exists — migration 0013 creates it as a scratch table and would fail on CREATE TABLE; drop the leftover by hand first`
      );
    }
  }

  const listings = (
    await client.execute(
      "select image_id, published_at, is_hidden from `listing`"
    )
  ).rows;

  // Malformed placements: json_extract throws on them, so neither the
  // survivors query below nor the migration's CREATE UNIQUE INDEX (which
  // evaluates the generated column for every row, AFTER the drops) can run.
  const badJson = (
    await client.execute(
      "select id from `product` where placements is not null and not json_valid(placements) order by id"
    )
  ).rows;
  if (badJson.length) {
    problems.push(
      `${badJson.length} product row(s) have malformed placements JSON — migration 0013's unique index cannot evaluate them (it would fail after the drops and roll back); fix by hand first: ${badJson
        .map((r) => String(r.id))
        .join(", ")}`
    );
  }

  // Rows that SURVIVE the migration: the Shop compositions (no store, no
  // design). front_image_id here is what the generated column will compute.
  // Skipped when any placements JSON is malformed — json_extract would throw,
  // and the structural pass would then misreport every listing as orphaned.
  const survivors = badJson.length
    ? []
    : (
        await client.execute(
          `select id, status, listed_at, json_extract(placements, '$.front') as front_image_id
             from \`product\`
            where store_id is null and design_id is null`
        )
      ).rows;

  // Rows the migration DELETES: organizer products (test-era only).
  const organizer = (
    await client.execute(
      `select id, store_id, design_id, status, title, created_at
         from \`product\`
        where design_id is not null or store_id is not null
        order by created_at, id`
    )
  ).rows;

  // Guard statement 1: an organizer-storefront sale the drops would orphan.
  const storeOrders = (
    await client.execute(
      "select id, store_id from `order` where store_id is not null order by created_at, id"
    )
  ).rows;
  if (storeOrders.length) {
    problems.push(
      `${storeOrders.length} order(s) carry store_id — migration 0013's guard will refuse to run (dropping order.store_id would orphan an organizer-storefront sale): ${storeOrders
        .map((o) => `${o.id} (store ${o.store_id})`)
        .join(", ")}`
    );
  }

  // Guard statement 2: an order whose composition the DELETE would remove.
  const organizerOrders = (
    await client.execute(
      `select o.id as order_id, o.store_product_id as product_id
         from \`order\` o join \`product\` p on p.id = o.store_product_id
        where p.design_id is not null or p.store_id is not null
        order by o.created_at, o.id`
    )
  ).rows;
  if (organizerOrders.length) {
    problems.push(
      `${organizerOrders.length} order(s) reference an organizer product via store_product_id — migration 0013's guard will refuse to run (its DELETE would remove that product from under the order): ${organizerOrders
        .map((o) => `${o.order_id} → product ${o.product_id}`)
        .join(", ")}`
    );
  }

  // The new unique index: two surviving rows on one front image fail the
  // CREATE UNIQUE INDEX, and with it the whole batch.
  const byFront = new Map<string, string[]>();
  for (const s of survivors) {
    const front = str(s.front_image_id);
    if (front === null) continue;
    byFront.set(front, [...(byFront.get(front) ?? []), String(s.id)]);
  }
  let duplicateFronts = 0;
  for (const [front, ids] of byFront) {
    if (ids.length > 1) {
      duplicateFronts++;
      problems.push(
        `front image ${front} is pinned by ${ids.length} surviving compositions (${ids.join(", ")}) — migration 0013's unique index product_front_image_unique cannot be built; dedupe by hand first`
      );
    }
  }

  if (badJson.length === 0) {
    const structural = structuralProblems("listing", listings, survivors);
    // The structural pass already reports a shared front as "N compositions
    // pin it"; the duplicate-front problem above is the one that names the
    // index. Everything else from it is a read-path defect, not a migration
    // blocker — tagged so the CLI can say so.
    problems.push(
      ...structural.problems
        .filter((p) => !/compositions pin it as front/.test(p))
        .map((p) => `[parity] ${p}`)
    );
    notes.push(...structural.notes);
  }

  if (organizer.length) {
    notes.push(
      `${organizer.length} organizer product row(s) will be DELETED by migration 0013 (design_id or store_id set; test-era — the guard refuses the migration if any order still references one):`
    );
    for (const p of organizer) {
      notes.push(
        `  ${p.id}  store_id=${dash(p.store_id)}  design_id=${dash(p.design_id)}  status=${p.status}  title=${dash(p.title)}  created_at=${isoFromSeconds(p.created_at)}`
      );
    }
  } else {
    notes.push("no organizer product rows — migration 0013's DELETE is a no-op here");
  }

  // Where the migrator thinks this database is. `db:migrate` applies every
  // journal entry newer than the newest ledger row, so a database that is not
  // actually at 0012 gets a wider batch than "just 0013".
  if (tables.has("__drizzle_migrations")) {
    const last = num(
      (await client.execute("select max(created_at) as n from `__drizzle_migrations`")).rows[0].n
    );
    notes.push(
      last === MIGRATION_0012_WHEN
        ? `migrations ledger: newest created_at ${last} = 0012's journal when — db:migrate will apply exactly 0013`
        : `migrations ledger: newest created_at ${last ?? "none"} ≠ 0012's journal when ${MIGRATION_0012_WHEN} — db:migrate applies every journal entry newer than that row, not just 0013`
    );
  } else {
    notes.push(
      "no __drizzle_migrations table — never migrated by drizzle-kit; db:migrate would attempt the whole chain from 0000"
    );
  }

  return {
    mode: "pre-0013",
    problems,
    notes,
    counts: {
      listings: listings.length,
      compositions: survivors.length,
      organizerProducts: organizer.length,
      orders: await count(client, "select count(*) as n from `order`"),
      ordersWithStoreId: storeOrders.length,
      ordersOnOrganizerProducts: organizerOrders.length,
      duplicateFronts,
      malformedPlacements: badJson.length,
    },
  };
}

/**
 * POST-0013: proves the migration landed as written — every drop, the rename
 * and its column set, the generated column, the unique index, the ledger row —
 * and that the surviving rows still agree with each other.
 */
async function checkPost(
  client: Client,
  tables: Set<string>
): Promise<CompositionParityReport> {
  const problems: string[] = [];
  const notes: string[] = [];

  for (const gone of ["store", "product_offering", "listing", "__slice5_guard", "__new_product"]) {
    if (tables.has(gone)) problems.push(`table ${gone} still exists — migration 0013 should have dropped it`);
  }
  for (const t of ["product", "order"]) {
    if (!tables.has(t)) {
      throw new Error(`post-0013 database is missing table ${t} — not a prntd database`);
    }
  }

  const pubCols = await columnNames(client, "image_publication");
  if (JSON.stringify(pubCols) !== JSON.stringify(IMAGE_PUBLICATION_COLUMNS)) {
    problems.push(
      `image_publication columns are [${pubCols.join(", ")}], expected exactly [${IMAGE_PUBLICATION_COLUMNS.join(", ")}]`
    );
  }

  const orderCols = await columnNames(client, "order");
  if (orderCols.includes("store_id")) {
    problems.push("order.store_id still exists — migration 0013 should have dropped it");
  }

  const productCols = await columnNames(client, "product");
  for (const col of ["store_id", "design_id"]) {
    if (productCols.includes(col)) {
      problems.push(`product.${col} still exists — migration 0013 should have dropped it`);
    }
  }
  const hasFrontColumn = productCols.includes("front_image_id");
  if (!hasFrontColumn) {
    problems.push(
      "product.front_image_id is missing — the generated column the readers join on (checked via PRAGMA table_xinfo)"
    );
  }

  const indexes = (await client.execute("PRAGMA index_list(`product`)")).rows;
  const unique = indexes.find((i) => String(i.name) === "product_front_image_unique");
  if (!unique) {
    problems.push("index product_front_image_unique on product is missing");
  } else if (Number(unique.unique) !== 1) {
    problems.push("index product_front_image_unique exists but is not UNIQUE");
  }

  if (!tables.has("__drizzle_migrations")) {
    problems.push(
      "no __drizzle_migrations table — this database has never been migrated by drizzle-kit; 0013 cannot have been applied through it"
    );
  } else {
    const applied = await count(
      client,
      `select count(*) as n from __drizzle_migrations where created_at >= ${MIGRATION_0013_WHEN}`
    );
    if (applied === 0) {
      problems.push(
        `__drizzle_migrations has no row with created_at >= ${MIGRATION_0013_WHEN} (0013's journal when) — the migrator does not consider 0013 applied`
      );
    }
  }

  const publications = (
    await client.execute(
      "select image_id, published_at, is_hidden from `image_publication`"
    )
  ).rows;
  // Every product row is a composition now. Prefer the generated column (its
  // presence is part of what this mode verifies); fall back to the expression
  // so the structural pass still runs when the column is missing.
  const frontExpr = hasFrontColumn
    ? "front_image_id"
    : "json_extract(placements, '$.front') as front_image_id";
  const compositions = (
    await client.execute(
      `select id, status, listed_at, ${frontExpr} from \`product\``
    )
  ).rows;

  const structural = structuralProblems("image_publication", publications, compositions);
  problems.push(...structural.problems);
  notes.push(...structural.notes);

  return {
    mode: "post-0013",
    problems,
    notes,
    counts: {
      publications: publications.length,
      compositions: compositions.length,
      orders: await count(client, "select count(*) as n from `order`"),
    },
  };
}
