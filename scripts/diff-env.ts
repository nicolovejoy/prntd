/**
 * Compare a freshly injected env file against the current .env.local WITHOUT
 * printing any secret value.
 *
 * Reports, per key: present only in one side, value changed, or identical.
 * Changed values are described by character length only — never content.
 *
 *   op inject -i .env.tpl -o /tmp/env.local.new
 *   npx tsx scripts/diff-env.ts /tmp/env.local.new
 *
 * Writes the report to /tmp/env-diff.txt. Safe to paste anywhere.
 */
import { readFileSync, writeFileSync } from "node:fs";

function parse(path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

/** Non-secret values worth showing in full so a wrong one is obvious. */
const SHOW_VALUE = new Set([
  "DATABASE_URL",
  "R2_BUCKET_NAME",
  "NEXT_PUBLIC_R2_PUBLIC_URL",
  "NEXT_PUBLIC_APP_URL",
  "ADMIN_EMAIL",
  "PRINTFUL_DRY_RUN",
  "GUEST_FUNNEL_ENABLED",
]);

function describe(key: string, value: string): string {
  if (value === "") return "EMPTY";
  return SHOW_VALUE.has(key) ? value : `${value.length} chars`;
}

function main() {
  const newPath = process.argv[2] ?? "/tmp/env.local.new";
  const oldPath = process.argv[3] ?? ".env.local";
  const next = parse(newPath);
  const current = parse(oldPath);
  const lines: string[] = [`new: ${newPath}`, `current: ${oldPath}`, ""];

  const keys = [...new Set([...next.keys(), ...current.keys()])].sort();

  const lost = keys.filter((k) => current.has(k) && !next.has(k));
  const added = keys.filter((k) => next.has(k) && !current.has(k));
  const changed = keys.filter(
    (k) => next.has(k) && current.has(k) && next.get(k) !== current.get(k)
  );
  const same = keys.filter(
    (k) => next.has(k) && current.has(k) && next.get(k) === current.get(k)
  );

  lines.push(`== WOULD BE LOST (in current, missing from new): ${lost.length} ==`);
  for (const k of lost) lines.push(`  ${k}  (current: ${describe(k, current.get(k)!)})`);

  lines.push("");
  lines.push(`== NEW KEYS: ${added.length} ==`);
  for (const k of added) lines.push(`  ${k}  (new: ${describe(k, next.get(k)!)})`);

  lines.push("");
  lines.push(`== VALUE CHANGED: ${changed.length} ==`);
  for (const k of changed) {
    lines.push(
      `  ${k}  current: ${describe(k, current.get(k)!)}  →  new: ${describe(k, next.get(k)!)}`
    );
  }

  lines.push("");
  lines.push(`== UNCHANGED: ${same.length} ==`);
  lines.push(`  ${same.join(", ") || "(none)"}`);

  const emptied = [...next.entries()].filter(([, v]) => v === "").map(([k]) => k);
  lines.push("");
  lines.push(
    emptied.length
      ? `!! EMPTY IN NEW FILE (a broken vault reference): ${emptied.join(", ")}`
      : "OK: no empty values in the new file."
  );

  const report = lines.join("\n");
  console.log(report);
  writeFileSync("/tmp/env-diff.txt", report + "\n");
}

main();
