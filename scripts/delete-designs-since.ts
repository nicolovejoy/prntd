/**
 * Bulk-delete one user's conversations created inside a time window (#189).
 * For cleaning up throwaway conversations after a smoke round.
 *
 *   npx tsx scripts/delete-designs-since.ts --user <email> --since <ISO-8601> \
 *     [--until <ISO-8601>] [--apply] [--confirm-prod | --confirm-preview]
 *
 * Dry run by default: one line per matching conversation and one per image
 * saying what WOULD happen (delete / detach-seed / detach-product-pin /
 * detach-cart-pin / BLOCKED-by-order). `--apply` performs it. Same rules as
 * the Delete button (src/lib/delete-design.ts): a conversation referenced by
 * an order or a shop product is skipped whole, never partially deleted.
 *
 * Targets whatever DATABASE_URL resolves to — .env.local (dev) by default, or
 * inline creds for prod/preview. The target is classified and printed;
 * `--apply` passes unflagged only for dev / a file DB, prod needs
 * `--confirm-prod`, preview `--confirm-preview`, and an unclassifiable URL
 * (https:// or wss://) is refused (src/lib/delete-designs-since.ts applyGuard).
 * `--since` / `--until` must carry an explicit zone (`Z` or `±HH:MM`); a naive
 * timestamp would parse as local time. R2 objects of deleted images are
 * removed on apply (the bucket is shared across envs, so the R2 creds come
 * from .env.local either way).
 *
 * Usage + the prod one-liner: docs/ops-cleanup.md.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../src/lib/db/schema";
import type { db as appDb } from "../src/lib/db";
import { classifyDbTarget } from "../src/lib/db-target";
import {
  applyGuard,
  deleteDesignsSince,
  parseWindowTimestamp,
  WINDOW_TIMESTAMP_FORM,
} from "../src/lib/delete-designs-since";

config({ path: ".env.local", quiet: true });

const FLAGS = ["--apply", "--confirm-prod", "--confirm-preview"] as const;
const VALUES = ["--user", "--since", "--until"] as const;

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    [
      "usage: npx tsx scripts/delete-designs-since.ts --user <email> --since <ISO-8601>",
      "         [--until <ISO-8601>] [--apply] [--confirm-prod | --confirm-preview]",
      "",
      "  --user             owner email; only their conversations match",
      `  --since            inclusive lower bound on design.created_at — ${WINDOW_TIMESTAMP_FORM}`,
      "  --until            inclusive upper bound, same form (default: now)",
      "  --apply            perform the deletes (default: dry run)",
      "  --confirm-prod     required with --apply when DATABASE_URL is prod",
      "  --confirm-preview  required with --apply when DATABASE_URL is preview",
    ].join("\n")
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((FLAGS as readonly string[]).includes(a)) {
      flags.add(a);
    } else if ((VALUES as readonly string[]).includes(a)) {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) usage(`${a} needs a value`);
      values.set(a, v);
      i++;
    } else {
      usage(`unknown argument ${a}`);
    }
  }
  return { flags, values };
}

function parseDate(flag: string, raw: string): Date {
  const d = parseWindowTimestamp(raw);
  if (!d) usage(`${flag} must be ${WINDOW_TIMESTAMP_FORM} (got: ${raw})`);
  return d;
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const email = values.get("--user");
  const sinceRaw = values.get("--since");
  if (!email) usage("--user is required");
  if (!sinceRaw) usage("--since is required");
  const since = parseDate("--since", sinceRaw);
  const untilRaw = values.get("--until");
  const until = untilRaw ? parseDate("--until", untilRaw) : undefined;
  const apply = flags.has("--apply");

  const url = process.env.DATABASE_URL;
  if (!url) usage("DATABASE_URL is not set");
  const target = classifyDbTarget(url);
  const host = url.replace(/^libsql:\/\//, "").split("?")[0];
  console.log(`DB target: ${target}, host: ${host || "(unknown)"}`);

  if (apply) {
    const guard = applyGuard(target, {
      confirmProd: flags.has("--confirm-prod"),
      confirmPreview: flags.has("--confirm-preview"),
    });
    if (!guard.ok) {
      console.error(guard.reason);
      process.exit(1);
    }
  }

  // Loaded after dotenv so the S3 client sees the R2 creds.
  const { deleteObjectByKey, imageKeyFromUrl } = await import("../src/lib/r2");

  const db = drizzle(
    createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN }),
    { schema }
  ) as unknown as typeof appDb;

  console.log(
    `${apply ? "APPLY" : "DRY RUN"} — ${email.trim().toLowerCase()}, created ${since.toISOString()} … ${(until ?? new Date()).toISOString()}`
  );
  console.log("");

  const result = await deleteDesignsSince(db, {
    email,
    since,
    until,
    apply,
    deleteObject: deleteObjectByKey,
    keyFromUrl: imageKeyFromUrl,
    log: (line) => console.log(line),
  });

  console.log("");
  console.log(
    `${result.matched} matched, ${apply ? result.deleted.length + " deleted" : result.reports.filter((r) => r.action === "delete").length + " would delete"}, ${result.skipped.length} skipped` +
      (apply ? `, R2 objects: ${result.r2Deleted} deleted, ${result.r2Failed} failed` : "")
  );
  if (!apply && result.matched > 0) {
    console.log("Dry run — nothing changed. Re-run with --apply to perform.");
  }
  process.exit(result.r2Failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
