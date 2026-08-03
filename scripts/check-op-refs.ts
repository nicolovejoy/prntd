/**
 * Verify every op:// reference in .env.tpl resolves, and report the field
 * LABELS available on the real items so the template can be repointed.
 *
 * Never prints a secret value — only item titles and field labels. Run it
 * yourself (the agent's secrets hook blocks `op item get` by design):
 *
 *   npx tsx scripts/check-op-refs.ts
 *
 * Writes the report to /tmp/op-refs-check.txt.
 *
 * Background: issue #154. Seven of eight references in .env.tpl point at
 * items that don't exist, and a reference to a missing item is injected as an
 * EMPTY value rather than failing — which is how REPLICATE_API_TOKEN ended up
 * blank and surfaced as a Replicate 401.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/** Extra items to report labels for, so a broken ref can be repointed. */
const CANDIDATES = [
  "Replicate.API.Key",
  "Ideogram.API.Key",
  "Turso",
  "prntd-preview-turso-token",
  "prntd-anthropic",
  "prntd-stripe-secret-test",
  "prntd-resend-API-key",
  "prntd CRON_SECRET",
];

const VAULT = "dev-secrets";

function op(args: string[]): string {
  return execFileSync("op", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Field labels only. Values are never read out of the parsed item. */
function fieldLabels(item: string): string[] | null {
  try {
    const raw = op(["item", "get", item, "--vault", VAULT, "--format", "json"]);
    const parsed = JSON.parse(raw) as {
      fields?: { label?: string; id?: string; value?: string }[];
    };
    return (parsed.fields ?? [])
      .filter((f) => f.value !== undefined && f.value !== "")
      .map((f) => f.label || f.id || "(unlabeled)");
  } catch {
    return null;
  }
}

function main() {
  const lines: string[] = [];
  const tpl = readFileSync(".env.tpl", "utf8");

  // op://vault/item/field
  const refs = [...tpl.matchAll(/op:\/\/([^/\s]+)\/([^/\s]+)\/(\S+)/g)].map((m) => ({
    ref: m[0],
    item: m[2],
    field: m[3],
  }));

  lines.push(`== references in .env.tpl (${refs.length}) ==`);
  for (const r of refs) {
    const labels = fieldLabels(r.item);
    if (labels === null) {
      lines.push(`BROKEN  ${r.ref}  → item "${r.item}" not found`);
    } else if (!labels.includes(r.field)) {
      lines.push(
        `WRONG FIELD  ${r.ref}  → item exists; non-empty fields: ${labels.join(", ")}`
      );
    } else {
      lines.push(`OK      ${r.ref}`);
    }
  }

  lines.push("");
  lines.push("== candidate items (non-empty field labels) ==");
  for (const item of CANDIDATES) {
    const labels = fieldLabels(item);
    lines.push(
      labels === null ? `${item}: NOT FOUND` : `${item}: ${labels.join(", ") || "(no non-empty fields)"}`
    );
  }

  const report = lines.join("\n");
  console.log(report);
  writeFileSync("/tmp/op-refs-check.txt", report + "\n");
}

main();
