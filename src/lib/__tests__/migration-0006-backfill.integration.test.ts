// @vitest-environment node
/**
 * Migration 0006 (data-model Phase 1c) against a real libSQL, replaying the
 * whole `drizzle/` chain. The point is the backfill: orders placed before Phase
 * 1b have no order_item row, and their line lives only in the scalar columns
 * 0006 drops. If the backfill were missing or wrong, those orders would come
 * out of the migration with nothing to print or display.
 *
 * The regular test harness (test-db.ts) derives DDL from schema.ts, so it can
 * only ever build the post-migration shape — this file replays the actual SQL
 * files instead, which is the only way to exercise the pre-1c row shape.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";

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

async function columns(client: Client, table: string): Promise<string[]> {
  const res = await client.execute(`PRAGMA table_info(\`${table}\`)`);
  return res.rows.map((r) => String(r.name));
}

describe("migration 0006 — order_item backfill before the scalar drop", () => {
  let client: Client;
  let files: string[];
  let target: string;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    files = migrationFiles();
    // Target 0006 by prefix, not "the last file" — later migrations exist.
    const idx = files.findIndex((f) => /^0006_/.test(f));
    expect(idx).toBeGreaterThan(-1);
    target = files[idx];
    // Everything up to (not including) 0006 — the pre-1c schema.
    for (const f of files.slice(0, idx)) await apply(client, f);

    await client.execute(
      "INSERT INTO `user` (`id`, `name`, `email`, `email_verified`, `created_at`, `updated_at`) VALUES ('u1', 'Buyer', 'buyer@example.com', 0, 0, 0)"
    );
    await client.execute(
      "INSERT INTO `design` (`id`, `user_id`, `status`, `created_at`, `updated_at`) VALUES ('d1', 'u1', 'ordered', 0, 0)"
    );
  });

  it("gives a pre-1b order (scalar columns only) a line carrying its item data", async () => {
    await client.execute(
      `INSERT INTO \`order\` (\`id\`, \`user_id\`, \`design_id\`, \`product_id\`, \`size\`, \`color\`,
         \`placements\`, \`total_price\`, \`item_price\`, \`shipping_price\`, \`printful_cost\`, \`status\`, \`created_at\`)
       VALUES ('o-legacy', 'u1', 'd1', 'bella-canvas-6400', 'L', 'Navy',
         '{"front":"img-1","back":"img-2"}', 32.12, 27.43, 4.69, 18.45, 'shipped', 1234)`
    );

    await apply(client, target);

    const res = await client.execute(
      "SELECT * FROM `order_item` WHERE `order_id` = 'o-legacy'"
    );
    expect(res.rows).toHaveLength(1);
    const line = res.rows[0];
    expect(line.design_id).toBe("d1");
    expect(line.product_id).toBe("bella-canvas-6400");
    expect(line.size).toBe("L");
    expect(line.color).toBe("Navy");
    expect(line.quantity).toBe(1);
    expect(line.item_price).toBe(27.43);
    expect(line.printful_cost).toBe(18.45);
    expect(line.created_at).toBe(1234);
    expect(JSON.parse(String(line.placements))).toEqual({
      front: "img-1",
      back: "img-2",
    });
  });

  it("derives item_price from total − shipping when the pre-1B split is null", async () => {
    await client.execute(
      `INSERT INTO \`order\` (\`id\`, \`user_id\`, \`design_id\`, \`product_id\`, \`size\`, \`color\`,
         \`total_price\`, \`status\`, \`created_at\`)
       VALUES ('o-presplit', 'u1', 'd1', 'bella-canvas-3001', 'M', 'Black', 24.12, 'shipped', 0)`
    );

    await apply(client, target);

    const res = await client.execute(
      "SELECT `item_price` FROM `order_item` WHERE `order_id` = 'o-presplit'"
    );
    // No item_price and no shipping_price recorded → the whole total is the item.
    expect(res.rows[0].item_price).toBe(24.12);
  });

  it("leaves an order that already has lines untouched (idempotent)", async () => {
    await client.execute(
      `INSERT INTO \`order\` (\`id\`, \`user_id\`, \`design_id\`, \`product_id\`, \`size\`, \`color\`,
         \`total_price\`, \`item_price\`, \`status\`, \`created_at\`)
       VALUES ('o-modern', 'u1', 'd1', 'bella-canvas-3001', 'M', 'Black', 24.12, 19.43, 'paid', 0)`
    );
    await client.execute(
      `INSERT INTO \`order_item\` (\`id\`, \`order_id\`, \`design_id\`, \`product_id\`, \`size\`, \`color\`,
         \`quantity\`, \`item_price\`, \`created_at\`)
       VALUES ('oi-1', 'o-modern', 'd1', 'bella-canvas-3001', 'XL', 'White', 2, 19.43, 0)`
    );

    await apply(client, target);

    const res = await client.execute(
      "SELECT * FROM `order_item` WHERE `order_id` = 'o-modern'"
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBe("oi-1");
    expect(res.rows[0].size).toBe("XL"); // not overwritten by the header's "M"
  });

  it("drops exactly the four per-item columns from `order`", async () => {
    const before = await columns(client, "order");
    expect(before).toEqual(
      expect.arrayContaining(["product_id", "size", "color", "placements"])
    );

    await apply(client, target);

    const after = await columns(client, "order");
    for (const col of ["product_id", "size", "color", "placements"]) {
      expect(after).not.toContain(col);
    }
    // Order-level money and linkage survive.
    for (const col of [
      "design_id",
      "total_price",
      "item_price",
      "shipping_price",
      "tax_collected",
      "printful_cost",
    ]) {
      expect(after).toContain(col);
    }
  });
});
