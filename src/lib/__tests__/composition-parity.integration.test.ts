// @vitest-environment node
/**
 * `checkCompositionParity` against real libSQL databases built from the
 * migration chain — the pre-0013 shape (0000–0012, which the schema-derived
 * test-db.ts can never build) and the post-0013 shape (0000–0013).
 *
 * The SQL files are replayed statement-by-statement as the 0006 and 0013
 * tests do. Replaying THROUGH 0013 that way needs `PRAGMA foreign_keys=OFF`
 * up front: outside the migrator's batch the DROP TABLE product between the
 * copy and the rename would otherwise trip order.store_product_id.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import {
  checkCompositionParity,
  MIGRATION_0012_WHEN,
  MIGRATION_0013_WHEN,
} from "@/lib/composition-parity";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function apply(client: Client, file: string) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) await client.execute(trimmed);
  }
}

/** Replay the chain up to (and, when `through0013`, including) migration 0013. */
async function chainDb(through0013: boolean): Promise<Client> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys=OFF");
  const files = migrationFiles();
  const target = files.find((f) => /^0013_/.test(f))!;
  const end = files.indexOf(target) + (through0013 ? 1 : 0);
  for (const f of files.slice(0, end)) await apply(client, f);
  await client.execute("PRAGMA foreign_keys=ON");
  return client;
}

async function ledger(client: Client, when: number) {
  await client.execute(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)'
  );
  await client.execute({
    sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
    args: ["seeded", when],
  });
}

async function baseRows(client: Client) {
  await client.execute(
    "INSERT INTO `user` (`id`, `email`, `name`, `email_verified`, `created_at`, `updated_at`) VALUES ('u', 'u@example.com', 'U', 0, 0, 0)"
  );
  await client.execute(
    "INSERT INTO `design` (`id`, `user_id`, `status`, `created_at`, `updated_at`) VALUES ('d', 'u', 'draft', 0, 0)"
  );
}

/** A pre-0013 Shop composition for `front`, listed at `listedAt`. */
async function mirror(client: Client, id: string, front: string, listedAt: number | null, status = "listed") {
  await client.execute({
    sql: `INSERT INTO \`product\` (\`id\`, \`owner_id\`, \`placements\`, \`status\`, \`position\`, \`title\`, \`listed_at\`, \`created_at\`, \`updated_at\`)
          VALUES (?, 'u', ?, ?, 0, 'T', ?, 0, 0)`,
    args: [id, JSON.stringify({ front }), status, listedAt],
  });
}

describe("checkCompositionParity — pre-0013 (Nico's pre-check)", () => {
  let client: Client;

  beforeEach(async () => {
    client = await chainDb(false);
    await baseRows(client);
    await client.execute(
      "INSERT INTO `listing` (`image_id`, `published_at`, `is_hidden`, `title`, `created_at`) VALUES ('img1', 5, 0, 'Frozen', 0)"
    );
    await mirror(client, "mir", "img1", 5);
    await client.execute(
      "INSERT INTO `order` (`id`, `user_id`, `design_id`, `total_price`, `status`, `store_product_id`, `created_at`) VALUES ('o', 'u', 'd', 24.12, 'paid', 'mir', 0)"
    );
  });

  it("clean: listing and mirror agree, no organizer rows, no store orders", async () => {
    const report = await checkCompositionParity(client);
    expect(report.mode).toBe("pre-0013");
    expect(report.problems).toEqual([]);
    expect(report.counts).toMatchObject({
      listings: 1,
      compositions: 1,
      organizerProducts: 0,
      orders: 1,
      ordersWithStoreId: 0,
      ordersOnOrganizerProducts: 0,
      duplicateFronts: 0,
    });
    expect(report.notes).toEqual([
      "no organizer product rows — migration 0013's DELETE is a no-op here",
      "no __drizzle_migrations table — never migrated by drizzle-kit; db:migrate would attempt the whole chain from 0000",
    ]);
    expect(report.counts.malformedPlacements).toBe(0);
  });

  it("malformed placements JSON is a problem naming the row, not a crash", async () => {
    await client.execute(
      "INSERT INTO `product` (`id`, `owner_id`, `placements`, `status`, `position`, `created_at`, `updated_at`) VALUES ('bad', 'u', 'not json', 'draft', 0, 0, 0)"
    );
    const report = await checkCompositionParity(client);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/^1 product row\(s\) have malformed placements JSON/);
    expect(report.problems[0]).toContain("bad");
    expect(report.counts.malformedPlacements).toBe(1);
    // The structural pass is skipped rather than misreporting every listing
    // as orphaned once the survivors query cannot run.
    expect(report.problems.some((p) => /\[parity\]/.test(p))).toBe(false);
  });

  it("a leftover scratch table from an interrupted run is a problem", async () => {
    await client.execute("CREATE TABLE `__new_product` (`id` text)");
    const report = await checkCompositionParity(client);
    expect(report.problems).toEqual([
      "table __new_product already exists — migration 0013 creates it as a scratch table and would fail on CREATE TABLE; drop the leftover by hand first",
    ]);
  });

  it("reports where the migrator thinks the database is", async () => {
    await ledger(client, MIGRATION_0012_WHEN);
    const at12 = await checkCompositionParity(client);
    expect(at12.notes).toContain(
      `migrations ledger: newest created_at ${MIGRATION_0012_WHEN} = 0012's journal when — db:migrate will apply exactly 0013`
    );
    await client.execute("DELETE FROM `__drizzle_migrations`");
    await ledger(client, MIGRATION_0012_WHEN - 1);
    const behind = await checkCompositionParity(client);
    expect(behind.notes.some((n) => /≠ 0012's journal when .* not just 0013/.test(n))).toBe(true);
    expect(behind.problems).toEqual([]);
  });

  it("an order carrying store_id is a problem (guard statement 1)", async () => {
    await client.execute(
      "INSERT INTO `store` (`id`, `owner_id`, `slug`, `name`, `status`, `created_at`, `updated_at`) VALUES ('s', 'u', 'club', 'Club', 'live', 0, 0)"
    );
    await client.execute(
      "INSERT INTO `order` (`id`, `user_id`, `design_id`, `total_price`, `status`, `store_id`, `created_at`) VALUES ('o2', 'u', 'd', 29.69, 'paid', 's', 1)"
    );
    const report = await checkCompositionParity(client);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/^1 order\(s\) carry store_id — migration 0013's guard will refuse to run/);
    expect(report.problems[0]).toContain("o2 (store s)");
    expect(report.counts.ordersWithStoreId).toBe(1);
  });

  it("an order whose store_product_id is an organizer product is a problem (guard statement 2)", async () => {
    await client.execute(
      `INSERT INTO \`product\` (\`id\`, \`owner_id\`, \`design_id\`, \`blank_id\`, \`placements\`, \`status\`, \`position\`, \`created_at\`, \`updated_at\`)
       VALUES ('org', 'u', 'd', 'bella-canvas-3001', '{"front":"img7"}', 'listed', 0, 0, 0)`
    );
    await client.execute(
      "INSERT INTO `order` (`id`, `user_id`, `design_id`, `total_price`, `status`, `store_product_id`, `created_at`) VALUES ('o3', 'u', 'd', 29.69, 'paid', 'org', 1)"
    );
    const report = await checkCompositionParity(client);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(
      /^1 order\(s\) reference an organizer product via store_product_id — migration 0013's guard will refuse to run/
    );
    expect(report.problems[0]).toContain("o3 → product org");
    expect(report.counts.ordersOnOrganizerProducts).toBe(1);
    // The organizer row itself is reported, not a problem on its own.
    expect(report.counts.organizerProducts).toBe(1);
  });

  it("two surviving rows sharing a front image is a problem (the unique index could not be built)", async () => {
    await mirror(client, "mir2", "img1", 5);
    const report = await checkCompositionParity(client);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toBe(
      "front image img1 is pinned by 2 surviving compositions (mir, mir2) — migration 0013's unique index product_front_image_unique cannot be built; dedupe by hand first"
    );
    expect(report.counts.duplicateFronts).toBe(1);
  });

  it("organizer rows the migration will delete appear as notes with a count, even when they share the mirror's front", async () => {
    await client.execute(
      "INSERT INTO `store` (`id`, `owner_id`, `slug`, `name`, `status`, `created_at`, `updated_at`) VALUES ('s', 'u', 'club', 'Club', 'live', 0, 0)"
    );
    await client.execute(
      `INSERT INTO \`product\` (\`id\`, \`owner_id\`, \`store_id\`, \`design_id\`, \`blank_id\`, \`placements\`, \`price\`, \`status\`, \`position\`, \`title\`, \`created_at\`, \`updated_at\`)
       VALUES ('org', 'u', 's', 'd', 'bella-canvas-3001', '{"front":"img1"}', 25, 'listed', 0, 'Club Tee', 0, 0)`
    );
    await client.execute(
      `INSERT INTO \`product\` (\`id\`, \`owner_id\`, \`design_id\`, \`blank_id\`, \`placements\`, \`status\`, \`position\`, \`created_at\`, \`updated_at\`)
       VALUES ('loose', 'u', 'd', 'bella-canvas-3001', '{"front_large":"img9"}', 'draft', 0, 86400, 86400)`
    );
    const report = await checkCompositionParity(client);
    expect(report.problems).toEqual([]);
    expect(report.counts.organizerProducts).toBe(2);
    expect(report.counts.compositions).toBe(1);
    expect(report.notes.filter((n) => !/^(migrations ledger|no __drizzle_migrations)/.test(n))).toEqual([
      "2 organizer product row(s) will be DELETED by migration 0013 (design_id or store_id set; test-era — the guard refuses the migration if any order still references one):",
      "  org  store_id=s  design_id=d  status=listed  title=Club Tee  created_at=1970-01-01T00:00:00.000Z",
      "  loose  store_id=—  design_id=d  status=draft  title=—  created_at=1970-01-02T00:00:00.000Z",
    ]);
  });

  it("a listing without a mirror is a problem", async () => {
    await client.execute(
      "INSERT INTO `listing` (`image_id`, `published_at`, `is_hidden`, `created_at`) VALUES ('img2', 6, 0, 0)"
    );
    const report = await checkCompositionParity(client);
    expect(report.problems).toEqual([
      "[parity] img2: published image with no composition — invisible in the Shop, and unbuyable since slice 4",
    ]);
  });

  it("a surviving row with no front slot is a note, not a problem", async () => {
    await client.execute(
      `INSERT INTO \`product\` (\`id\`, \`owner_id\`, \`placements\`, \`status\`, \`position\`, \`created_at\`, \`updated_at\`)
       VALUES ('nofront', 'u', '{"back":"img3"}', 'draft', 0, 0, 0)`
    );
    const report = await checkCompositionParity(client);
    expect(report.problems).toEqual([]);
    expect(report.notes.some((n) => n.includes("no front placement slot") && n.includes("nofront"))).toBe(true);
  });
});

describe("checkCompositionParity — post-0013 (Nico's verify)", () => {
  let client: Client;

  beforeEach(async () => {
    client = await chainDb(true);
    await ledger(client, MIGRATION_0013_WHEN);
    await baseRows(client);
    await client.execute(
      "INSERT INTO `image_publication` (`image_id`, `published_at`, `is_hidden`, `created_at`) VALUES ('img1', 5, 0, 0)"
    );
    await mirror(client, "comp", "img1", 5);
    await client.execute(
      "INSERT INTO `order` (`id`, `user_id`, `design_id`, `total_price`, `status`, `store_product_id`, `created_at`) VALUES ('o', 'u', 'd', 24.12, 'paid', 'comp', 0)"
    );
  });

  it("clean: drops landed, generated column + unique index present, ledger stamped, rows agree", async () => {
    const report = await checkCompositionParity(client);
    expect(report.mode).toBe("post-0013");
    expect(report.problems).toEqual([]);
    expect(report.notes).toEqual([]);
    expect(report.counts).toEqual({ publications: 1, compositions: 1, orders: 1 });
  });

  it("a publication without a composition is a problem", async () => {
    await client.execute(
      "INSERT INTO `image_publication` (`image_id`, `published_at`, `is_hidden`, `created_at`) VALUES ('img2', 6, 0, 0)"
    );
    const report = await checkCompositionParity(client);
    expect(report.problems).toEqual([
      "img2: published image with no composition — invisible in the Shop, and unbuyable since slice 4",
    ]);
  });

  it("a listed composition without a publication is a problem", async () => {
    await mirror(client, "stray", "img8", 7);
    const report = await checkCompositionParity(client);
    expect(report.problems).toEqual([
      "img8: composition stray is listed but the image has no image_publication row — in the Shop with no publish grant",
    ]);
  });

  it("hidden-state and listed_at disagreements are problems", async () => {
    await client.execute("UPDATE `image_publication` SET `is_hidden` = 1, `published_at` = 9 WHERE `image_id` = 'img1'");
    const report = await checkCompositionParity(client);
    expect(report.problems).toEqual([
      "img1: composition comp is listed, expected hidden (hidden-state disagrees with image_publication.is_hidden)",
      "img1: composition listed_at 5 != image_publication.published_at 9",
    ]);
  });

  it("a later ledger row (0014 and beyond) still counts as 0013 applied", async () => {
    await client.execute("DELETE FROM `__drizzle_migrations`");
    await ledger(client, MIGRATION_0013_WHEN + 100_000);
    const report = await checkCompositionParity(client);
    expect(report.problems).toEqual([]);
  });

  it("a missing 0013 ledger row is a problem", async () => {
    await client.execute("DELETE FROM `__drizzle_migrations`");
    await ledger(client, MIGRATION_0013_WHEN - 1);
    const report = await checkCompositionParity(client);
    expect(report.problems).toEqual([
      `__drizzle_migrations has no row with created_at >= ${MIGRATION_0013_WHEN} (0013's journal when) — the migrator does not consider 0013 applied`,
    ]);
  });

  it("no ledger table at all is a problem", async () => {
    await client.execute("DROP TABLE `__drizzle_migrations`");
    const report = await checkCompositionParity(client);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/^no __drizzle_migrations table/);
  });
});

describe("checkCompositionParity — mode detection", () => {
  it("throws on a database with neither listing nor image_publication", async () => {
    const client = createClient({ url: ":memory:" });
    await client.execute("CREATE TABLE `product` (`id` text PRIMARY KEY)");
    await expect(checkCompositionParity(client)).rejects.toThrow(
      /neither image_publication nor listing exists/
    );
  });

  it("reads 0013's `when` from the journal", () => {
    expect(MIGRATION_0013_WHEN).toBeGreaterThan(1_700_000_000_000);
  });
});
