/**
 * Pure classification + preflight logic for #166: refuse a schema-touching
 * DB command (db:push / db:migrate / db:seed) against a non-dev target
 * unless the caller explicitly confirms it.
 *
 * Kept dependency-free (no dotenv, no @libsql/client) so it's plain
 * unit-testable — the dotenv load + host resolution happens in the calling
 * script (scripts/db-preflight.ts).
 */

export type DbTarget = "dev" | "preview" | "prod" | "memory" | "unknown";

const PROD_HOST = "prntd-nicolovejoy.aws-us-west-2.turso.io";

/** Classify a DATABASE_URL by host. Mirrors the hosts named in CLAUDE.md's
 * "Migration discipline" section (prntd / prntd-preview / prntd-dev). */
export function classifyDbTarget(url: string | undefined): DbTarget {
  if (!url) return "unknown";

  if (url.startsWith(":memory:") || url.startsWith("file:")) return "memory";

  const host = url.replace(/^libsql:\/\//, "").split("?")[0].split("/")[0];

  if (host.startsWith("prntd-dev-")) return "dev";
  if (host.startsWith("prntd-preview-")) return "preview";
  if (host === PROD_HOST || host.startsWith("prntd-nicolovejoy")) return "prod";

  return "unknown";
}

/**
 * Internal-only signal, not a real env var Nico sets by hand: the calling
 * script (scripts/db-preflight.ts) stamps this onto the env object it
 * builds to record whether DATABASE_URL was already present in
 * process.env BEFORE `.env.local` was loaded (i.e. the inline-creds
 * prod/preview one-liners, `DATABASE_URL=... npm run db:migrate`), as
 * opposed to having come from `.env.local` itself. dotenv's default
 * `config()` never overrides an existing process.env value, so "already
 * present" and "came from the shell" are the same fact.
 */
export const DATABASE_URL_FROM_SHELL_KEY = "__DB_TARGET_URL_FROM_SHELL__";

export type DbPreflightResult =
  | { ok: true; target: DbTarget; host: string; fromShell: boolean }
  | { ok: false; reason: string };

/**
 * Decide whether the resolved DATABASE_URL is safe to operate on.
 *
 * - Missing DATABASE_URL → refuse.
 * - `env[DATABASE_URL_FROM_SHELL_KEY] === "1"` (set by the calling script
 *   when DATABASE_URL was already in the shell before `.env.local` was
 *   loaded — the inline-creds flow) → always allowed, any target.
 * - Otherwise (came from `.env.local`) → allowed only for `dev` and
 *   `memory` implicitly; any other target needs
 *   `DB_TARGET_CONFIRM=<target>` matching the classified target.
 */
export function dbPreflight(env: NodeJS.ProcessEnv): DbPreflightResult {
  const url = env.DATABASE_URL;

  if (!url) {
    return {
      ok: false,
      reason:
        "DATABASE_URL is not set. Nothing to run against — set it (or check .env.local).",
    };
  }

  const target = classifyDbTarget(url);
  const host = url.replace(/^libsql:\/\//, "").split("?")[0];
  const fromShell = env[DATABASE_URL_FROM_SHELL_KEY] === "1";

  if (fromShell) {
    return { ok: true, target, host, fromShell: true };
  }

  if (target === "dev" || target === "memory") {
    return { ok: true, target, host, fromShell: false };
  }

  const confirm = env.DB_TARGET_CONFIRM;
  if (confirm === target) {
    return { ok: true, target, host, fromShell: false };
  }

  return {
    ok: false,
    reason: [
      `Refusing to run: DATABASE_URL (from .env.local) resolves to "${target}" (host: ${host || "unknown"}).`,
      `This command only runs implicitly against dev or an in-memory DB.`,
      `To proceed, set DB_TARGET_CONFIRM=${target} and re-run.`,
    ].join("\n"),
  };
}
