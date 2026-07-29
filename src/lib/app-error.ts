/**
 * Shaping for prod runtime errors captured by instrumentation.ts (#121).
 * Pure and dependency-free: this module is imported by instrumentation.ts,
 * which Next.js also bundles for the edge runtime — no db/node imports here.
 */

export type AppErrorShape = {
  digest: string | null;
  message: string;
  stack: string | null;
  path: string | null;
  method: string | null;
  context: Record<string, string> | null;
};

export const MESSAGE_CAP = 2048;
export const STACK_CAP = 4096;
const PATH_CAP = 512;

/** Keys copied from Next's onRequestError context (all optional strings). */
const CONTEXT_KEYS = [
  "routerKind",
  "routePath",
  "routeType",
  "renderSource",
  "revalidateReason",
  "renderType",
] as const;

function truncate(value: string, cap: number): string {
  return value.length > cap ? value.slice(0, cap) : value;
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unstringifiable]";
  }
}

/**
 * Build an app_error row from whatever onRequestError hands us. Never throws:
 * the error may be a non-Error throw, a React-processed wrapper, or anything
 * else — every field access is defensive.
 */
export function shapeAppError(
  err: unknown,
  request?: { path?: unknown; method?: unknown },
  context?: Record<string, unknown>
): AppErrorShape {
  let message = "Unknown error";
  let stack: string | null = null;
  let digest: string | null = null;

  if (err instanceof Error) {
    message = typeof err.message === "string" && err.message ? err.message : err.name;
    stack = typeof err.stack === "string" ? err.stack : null;
  } else if (err !== null && err !== undefined) {
    message = safeString(err);
  }
  if (err !== null && typeof err === "object" && "digest" in err) {
    const d = (err as { digest?: unknown }).digest;
    if (typeof d === "string" && d) digest = d;
  }

  const ctx: Record<string, string> = {};
  for (const key of CONTEXT_KEYS) {
    const value = context?.[key];
    if (typeof value === "string" && value) ctx[key] = value;
  }

  return {
    digest,
    message: truncate(message, MESSAGE_CAP),
    stack: stack ? truncate(stack, STACK_CAP) : null,
    path: typeof request?.path === "string" ? truncate(request.path, PATH_CAP) : null,
    method: typeof request?.method === "string" ? request.method : null,
    context: Object.keys(ctx).length > 0 ? ctx : null,
  };
}

/**
 * One structured console.error line per error, emitted before the DB write so
 * `vercel logs | grep app_error` works even when the insert fails.
 */
export function appErrorLogLine(shape: AppErrorShape, now: Date = new Date()): string {
  return JSON.stringify({
    event: "app_error",
    timestamp: now.toISOString(),
    digest: shape.digest,
    message: shape.message,
    path: shape.path,
    method: shape.method,
    ...shape.context,
    stack: shape.stack,
  });
}
