/**
 * Move everything one user owns to another user — the same seven-table batch
 * sign-up uses to claim a guest's work (`reparentUserData`, see
 * src/lib/reparent-user.ts), exposed as an ops command for the case where the
 * claim never happened (e.g. a design made while signed out and never linked).
 *
 * Dry run by default: prints the from/to users and per-table row counts, writes
 * nothing. `--apply` performs the batch. Prod additionally requires
 * `--confirm-prod`, preview `--confirm-preview`. The anonymous user row is
 * left in place (sessions may still reference it; it is harmless).
 *
 *   DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io \
 *   DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) \
 *   npx tsx scripts/reparent-user.ts <fromUserId> <toEmail> [--apply] [--confirm-prod]
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import type { db as appDb } from "../src/lib/db";
import { classifyDbTarget } from "../src/lib/db-target";
import { reparentUserData } from "../src/lib/reparent-user";

config({ path: ".env.local" });

const FLAGS = ["--apply", "--confirm-prod", "--confirm-preview"] as const;

function usage(): never {
  console.error(
    "usage: npx tsx scripts/reparent-user.ts <fromUserId> <toEmail> [--apply] [--confirm-prod | --confirm-preview]"
  );
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  for (const f of flags) if (!(FLAGS as readonly string[]).includes(f)) usage();
  const [fromId, toEmail] = args.filter((a) => !a.startsWith("--"));
  if (!fromId || !toEmail) usage();

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const target = classifyDbTarget(url);
  const apply = flags.has("--apply");
  console.log(`target: ${target} (${new URL(url.replace("libsql://", "https://")).host})`);
  if (apply && target === "prod" && !flags.has("--confirm-prod")) {
    console.error("refusing: --apply on prod needs --confirm-prod");
    process.exit(1);
  }
  if (apply && target === "preview" && !flags.has("--confirm-preview")) {
    console.error("refusing: --apply on preview needs --confirm-preview");
    process.exit(1);
  }
  if (apply && target === "unknown") {
    console.error("refusing: cannot classify DATABASE_URL");
    process.exit(1);
  }

  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  const db = drizzle(client, { schema }) as unknown as typeof appDb;
  try {
    const [from] = await db.select().from(schema.user).where(eq(schema.user.id, fromId));
    const [to] = await db.select().from(schema.user).where(eq(schema.user.email, toEmail));
    if (!from) throw new Error(`no user with id ${fromId}`);
    if (!to) throw new Error(`no user with email ${toEmail}`);
    if (from.id === to.id) throw new Error("from and to are the same user");
    console.log(`from: ${from.id}  email=${from.email ?? "(none)"}  anonymous=${from.isAnonymous ? "yes" : "no"}`);
    console.log(`to:   ${to.id}  email=${to.email}`);

    const counts: Array<[string, number]> = [];
    const count = async (label: string, table: { userId?: unknown; ownerId?: unknown }, col: "userId" | "ownerId") => {
      const c = table[col] as Parameters<typeof eq>[0];
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(table as never)
        .where(eq(c, from.id));
      counts.push([label, Number(n)]);
    };
    await count("design", schema.design, "userId");
    await count("order", schema.order, "userId");
    await count("cart_item", schema.cartItem, "userId");
    await count("store", schema.store, "ownerId");
    await count("product", schema.product, "ownerId");
    await count("image", schema.image, "ownerId");
    await count("image_generation", schema.imageGeneration, "userId");
    for (const [label, n] of counts) console.log(`  ${label.padEnd(17)} ${n}`);
    const total = counts.reduce((s, [, n]) => s + n, 0);
    if (total === 0) {
      console.log("nothing to move.");
      return;
    }
    if (!apply) {
      console.log(`dry run — ${total} rows would move. Re-run with --apply to perform.`);
      return;
    }
    await reparentUserData(db, from.id, to.id);
    const [{ n: left }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.image)
      .where(eq(schema.image.ownerId, from.id));
    console.log(`applied. images still on the old owner: ${Number(left)} (expect 0)`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
