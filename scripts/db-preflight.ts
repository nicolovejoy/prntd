/**
 * Guard for #166: refuse to run a schema-touching DB command (db:push,
 * db:migrate, db:seed) against a non-dev DATABASE_URL unless the caller
 * explicitly confirms it. Wired into package.json as
 * `tsx scripts/db-preflight.ts && <command>`.
 *
 * Prints only the classified target + host — never the token, never any
 * other .env.local value.
 *
 *   npx tsx scripts/db-preflight.ts
 */
import { config } from "dotenv";
import {
  dbPreflight,
  DATABASE_URL_FROM_SHELL_KEY,
} from "../src/lib/db-target";

// Record whether DATABASE_URL was already in the shell BEFORE loading
// .env.local. dotenv's default config() never overrides an existing
// process.env value, so this is the same fact as "came from the shell" vs
// "came from .env.local" — which is exactly the inline-creds prod/preview
// one-liner (`DATABASE_URL=... DATABASE_AUTH_TOKEN=... npm run db:migrate`)
// vs. a bare `npm run db:push` reading the checked-out .env.local.
const urlWasPreset = Boolean(process.env.DATABASE_URL);

config({ path: ".env.local" });

const env: NodeJS.ProcessEnv = {
  ...process.env,
  [DATABASE_URL_FROM_SHELL_KEY]: urlWasPreset ? "1" : "0",
};

const result = dbPreflight(env);

if (!result.ok) {
  console.error(result.reason);
  process.exit(1);
}

const source = result.fromShell ? "shell (inline creds)" : ".env.local";
console.log(
  `DB preflight OK — target: ${result.target}, host: ${result.host || "(unknown)"}, source: ${source}`
);
