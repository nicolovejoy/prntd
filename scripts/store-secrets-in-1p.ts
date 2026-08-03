/**
 * Mint the missing dev-secrets items from the values already in .env.local,
 * so .env.tpl has real references to point at (#154).
 *
 * Five prntd secrets were never stored in 1Password — they live only in
 * .env.local and in Vercel — which is why most op:// references in .env.tpl
 * resolve to nothing and inject as empty.
 *
 * Values are read from .env.local and passed to `op` as process arguments.
 * They are never printed, never echoed, and never written to disk by this
 * script. Output names items and fields only.
 *
 * Dry run (default — shows what it would create, creates nothing):
 *   npx tsx scripts/store-secrets-in-1p.ts
 *
 * Create for real:
 *   npx tsx scripts/store-secrets-in-1p.ts --apply
 *
 * Idempotent: an item that already exists is skipped, never overwritten.
 */
import { execFileSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local" });

const VAULT = "dev-secrets";
const APPLY = process.argv.includes("--apply");

/** env var → 1Password item title. Field is always `credential`. */
const WANTED: { env: string; title: string }[] = [
  { env: "R2_ACCESS_KEY_ID", title: "prntd-r2-access-key-id" },
  { env: "R2_SECRET_ACCESS_KEY", title: "prntd-r2-secret-access-key" },
  { env: "PRINTFUL_API_KEY", title: "prntd-printful" },
  { env: "STRIPE_WEBHOOK_SECRET", title: "prntd-stripe-webhook-secret" },
  { env: "BETTER_AUTH_SECRET", title: "prntd-better-auth-secret" },
];

function itemExists(title: string): boolean {
  try {
    execFileSync("op", ["item", "get", title, "--vault", VAULT, "--format", "json"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function createItem(title: string, value: string) {
  // Assignment is passed as a process argument, not through a shell, so the
  // value is never interpolated into a command line we control or print.
  execFileSync(
    "op",
    [
      "item",
      "create",
      "--category=API Credential",
      `--title=${title}`,
      `--vault=${VAULT}`,
      `credential=${value}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
}

function main() {
  console.log(APPLY ? "MODE: apply\n" : "MODE: dry run (pass --apply to create)\n");

  for (const { env, title } of WANTED) {
    const value = process.env[env];
    if (!value) {
      console.log(`SKIP    ${title}  — ${env} is absent or empty in .env.local`);
      continue;
    }
    if (itemExists(title)) {
      console.log(`EXISTS  ${title}  — left untouched`);
      continue;
    }
    if (!APPLY) {
      console.log(`WOULD CREATE  ${title}  ← ${env} (${value.length} chars)`);
      continue;
    }
    try {
      createItem(title, value);
      console.log(`CREATED ${title}  ← ${env}`);
    } catch (err) {
      console.log(
        `FAILED  ${title}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log(
    "\nNothing above prints a secret value — only names, field labels and lengths."
  );
}

main();
