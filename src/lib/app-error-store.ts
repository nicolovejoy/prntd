/**
 * Best-effort persistence for shaped runtime errors (#121). Loaded only in the
 * Node runtime (dynamic import from instrumentation.ts). Must never throw —
 * an error in error-logging can't be allowed to break or recurse into the
 * failing request; the structured console line is the fallback record.
 */
import type { db as appDb } from "@/lib/db";
import { appError } from "@/lib/db/schema";
import { withTimeout } from "@/lib/timeout";
import type { AppErrorShape } from "@/lib/app-error";

const INSERT_TIMEOUT_MS = 3000;

export async function recordAppError(
  shape: AppErrorShape,
  database?: typeof appDb
): Promise<void> {
  try {
    const dbi = database ?? (await import("@/lib/db")).db;
    await withTimeout("app_error insert", INSERT_TIMEOUT_MS, async () => {
      await dbi.insert(appError).values(shape);
    });
  } catch (err) {
    console.error(
      "app_error insert failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
