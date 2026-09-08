/**
 * One-shot ops script (#231): mark pre-#231 `pending` orders abandoned so
 * `/orders`'s webhook-stranded-payment heuristic (see
 * `getUserOrdersData`/`STALE_PENDING_MS` in src/lib/user-orders.ts) doesn't
 * mistake every legacy pending row for a stranded payment. `abandoned_at` is
 * additive with no backfill (schema.ts's comment on the column), so every
 * pending row created before this shipped is still null — this fills that
 * in, once, at deploy time.
 *
 * Only touches rows where status='pending' AND abandoned_at IS NULL AND
 * created_at < --before. Idempotent: a second run against the same cutoff
 * matches nothing (the rows it touched the first time are no longer null).
 * Rows with no `stripe_session_id` are already excluded from the shown-
 * pending branch regardless of this script (a session-less row could never
 * have been paid) — this script still marks them abandoned so they carry a
 * consistent, honest timestamp instead of a null that reads as "in flight".
 *
 * Dry run by default: prints the target and the row count it WOULD touch,
 * writes nothing. `--apply` performs the UPDATE. Prod additionally requires
 * `--confirm-prod`, preview `--confirm-preview` (same `classifyDbTarget` +
 * `applyGuard` rules as scripts/delete-designs-since.ts).
 *
 *   DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io \
 *   DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) \
 *   npx tsx scripts/mark-legacy-pending-abandoned.ts --before=2026-09-09T00:00:00-07:00 --apply --confirm-prod
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import type { db as appDb } from "../src/lib/db";
import { classifyDbTarget } from "../src/lib/db-target";
import { applyGuard, parseWindowTimestamp, WINDOW_TIMESTAMP_FORM } from "../src/lib/delete-designs-since";

config({ path: ".env.local", quiet: true });

const FLAGS = ["--apply", "--confirm-prod", "--confirm-preview"] as const;

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    [
      "usage: npx tsx scripts/mark-legacy-pending-abandoned.ts --before=<ISO-8601> [--apply] [--confirm-prod | --confirm-preview]",
      "",
      `  --before           required cutoff on order.created_at — ${WINDOW_TIMESTAMP_FORM}`,
      "  --apply            perform the update (default: dry run)",
      "  --confirm-prod     required with --apply when DATABASE_URL is prod",
      "  --confirm-preview  required with --apply when DATABASE_URL is preview",
    ].join("\n")
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  let before: string | undefined;
  for (const a of argv) {
    if ((FLAGS as readonly string[]).includes(a)) {
      flags.add(a);
    } else if (a.startsWith("--before=")) {
      before = a.slice("--before=".length);
    } else {
      usage(`unknown argument ${a}`);
    }
  }
  return { flags, before };
}

async function main() {
  const { flags, before } = parseArgs(process.argv.slice(2));
  if (!before) usage("--before is required");

  const cutoff = parseWindowTimestamp(before);
  if (!cutoff) usage(`--before must be ${WINDOW_TIMESTAMP_FORM}`);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const target = classifyDbTarget(url);
  const apply = flags.has("--apply");
  console.log(`target: ${target} (${new URL(url.replace("libsql://", "https://")).host})`);
  console.log(`cutoff: ${cutoff.toISOString()}`);

  if (apply) {
    const guard = applyGuard(target, {
      confirmProd: flags.has("--confirm-prod"),
      confirmPreview: flags.has("--confirm-preview"),
    });
    if (!guard.ok) {
      console.error(`refusing: ${guard.reason}`);
      process.exit(1);
    }
  }

  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  const db = drizzle(client, { schema }) as unknown as typeof appDb;
  try {
    const where = and(
      eq(schema.order.status, "pending"),
      isNull(schema.order.abandonedAt),
      lt(schema.order.createdAt, cutoff)
    );

    if (!apply) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.order)
        .where(where);
      console.log(`dry run — would mark ${Number(n)} order(s) abandoned. Re-run with --apply to perform.`);
      return;
    }

    const result = await db
      .update(schema.order)
      .set({ abandonedAt: new Date() })
      .where(where);
    console.log(`marked ${result.rowsAffected} order(s) abandoned.`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
