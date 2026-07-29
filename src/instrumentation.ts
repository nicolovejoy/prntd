import type { Instrumentation } from "next";
import { shapeAppError, appErrorLogLine } from "@/lib/app-error";

/**
 * Prod error visibility (#121). Next.js masks server-action/RSC errors in
 * production (digest only reaches the client); this hook records the
 * digest→message/stack mapping. Two sinks, in order:
 * 1. one structured console.error line (greppable in `vercel logs`),
 * 2. a best-effort `app_error` row surfaced on /admin/errors.
 * Neither may throw — recordAppError swallows its own failures, and the DB
 * path is skipped entirely off the Node runtime (edge can't reach libSQL).
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  const shape = shapeAppError(err, request, context);
  console.error(appErrorLogLine(shape));

  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { recordAppError } = await import("@/lib/app-error-store");
      await recordAppError(shape);
    } catch (storeErr) {
      console.error(
        "app_error store unavailable:",
        storeErr instanceof Error ? storeErr.message : String(storeErr)
      );
    }
  }
};
