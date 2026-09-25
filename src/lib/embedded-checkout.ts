/**
 * Embedded checkout config resolution (#135 slice 2) — pure, no db, no
 * network. `resolveEmbeddedCheckoutConfig` is the fail-closed gate: callers
 * that want to create or mount an embedded Stripe session call
 * `embeddedCheckoutConfig()` (which reads env) rather than the raw
 * `embeddedCheckoutFlag()` in src/lib/flags.ts, so a misconfigured key pair
 * degrades to hosted checkout instead of building a broken embedded session.
 */

const PUBLISHABLE_KEY_RE = /^pk_(test|live)_[A-Za-z0-9]+$/;
const SECRET_KEY_MODE_RE = /^(?:sk|rk)_(test|live)_/;

export type EmbeddedCheckoutResolution =
  | { enabled: true; publishableKey: string }
  | {
      enabled: false;
      reason: "flag-off" | "missing-key" | "invalid-key" | "mode-mismatch";
    };

/**
 * Resolve whether embedded checkout can actually be used. `flag` is the raw
 * env string — callers pass `process.env.EMBEDDED_CHECKOUT_ENABLED` (or the
 * `embeddedCheckoutFlag()` boolean's underlying string) so this stays a pure
 * function of its inputs, testable without touching `process.env`.
 */
export function resolveEmbeddedCheckoutConfig(params: {
  flag: string | undefined;
  publishableKey: string | undefined;
  secretKey: string | undefined;
}): EmbeddedCheckoutResolution {
  if (params.flag !== "true") {
    return { enabled: false, reason: "flag-off" };
  }

  const publishableKey = (params.publishableKey ?? "").trim();
  if (publishableKey === "") {
    return { enabled: false, reason: "missing-key" };
  }

  const pkMatch = publishableKey.match(PUBLISHABLE_KEY_RE);
  if (!pkMatch) {
    return { enabled: false, reason: "invalid-key" };
  }

  const secretKey = (params.secretKey ?? "").trim();
  const skMatch = secretKey.match(SECRET_KEY_MODE_RE);
  if (!skMatch || skMatch[1] !== pkMatch[1]) {
    return { enabled: false, reason: "mode-mismatch" };
  }

  return { enabled: true, publishableKey };
}

/**
 * env-reading wrapper around `resolveEmbeddedCheckoutConfig` — the one
 * callers in server actions / pages should use.
 */
export function embeddedCheckoutConfig(): EmbeddedCheckoutResolution {
  return resolveEmbeddedCheckoutConfig({
    flag: process.env.EMBEDDED_CHECKOUT_ENABLED,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    secretKey: process.env.STRIPE_SECRET_KEY,
  });
}

// Control characters (C0 + DEL) — reject a path carrying any of them.
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * A same-origin, single-segment-safe redirect target. Used for the
 * `/checkout?...&from=` back link and the `?next=` sign-in redirect built
 * from it — both are attacker-influenceable (query params), so this refuses
 * anything that isn't an unambiguous relative path: must start with a single
 * `/` (never `//`, which browsers treat as protocol-relative to another
 * host), must not contain a backslash (some browsers normalize `\` to `/`,
 * which can smuggle a `//host` past a naive check), and must not contain
 * control characters. Falls back to `/shop` rather than throwing, since this
 * runs on the redirect path itself.
 */
export function safeCheckoutReturnPath(from: unknown): string {
  if (typeof from !== "string") return "/shop";
  if (from.length === 0) return "/shop";
  if (!from.startsWith("/")) return "/shop";
  if (from.startsWith("//")) return "/shop";
  if (from.includes("\\")) return "/shop";
  if (CONTROL_CHAR_RE.test(from)) return "/shop";
  return from;
}

/**
 * The relative path `buyPublishedDesign` returns as `url` for the client to
 * navigate to when embedded checkout is enabled — same-origin, so it works
 * unchanged on a preview deploy (a preview and prod have different origins).
 */
export function embeddedCheckoutPath(sessionId: string, backPath: string): string {
  const safeBack = safeCheckoutReturnPath(backPath);
  return `/checkout?session=${encodeURIComponent(sessionId)}&from=${encodeURIComponent(safeBack)}`;
}

/**
 * The origin an embedded checkout session's `return_url` should point at.
 * Hosted checkout always uses `NEXT_PUBLIC_APP_URL` (prod's URL in every
 * Vercel scope) because the buyer leaves our origin for Stripe's page, so it
 * doesn't matter which deployment built the link. Embedded checkout keeps
 * the buyer on our own `/checkout` page the whole time, so a session created
 * on a preview deployment must return to that same preview — otherwise a
 * test-key phone check on a preview pays there and then gets sent to prod's
 * `/order/confirm`, where the preview's order doesn't exist.
 *
 * Trusts the same hosts `src/lib/auth.ts`'s `trustedOrigins` does (any
 * `*.vercel.app` host over https, any `prntd.org`/`*.prntd.org` host over
 * https) plus localhost/127.0.0.1 on any port, so an attacker-controlled
 * `Origin` header can't steer a real buyer's return trip off PRNTD
 * infrastructure. Anything else — missing, malformed, a different host, a
 * non-http(s) scheme like `javascript:` — falls back to `appUrl`'s origin.
 * Always returns a bare origin (no path, no trailing slash).
 */
export function resolveReturnOrigin(
  originHeader: string | null,
  appUrl: string
): string {
  const fallback = new URL(appUrl).origin;
  if (!originHeader) return fallback;

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return fallback;
  }

  if (origin.origin === fallback) return origin.origin;

  const host = origin.hostname;
  if (origin.protocol === "https:") {
    if (host.endsWith(".vercel.app")) return origin.origin;
    if (host === "prntd.org" || host.endsWith(".prntd.org")) return origin.origin;
  }
  if (
    (origin.protocol === "http:" || origin.protocol === "https:") &&
    (host === "localhost" || host === "127.0.0.1")
  ) {
    return origin.origin;
  }

  return fallback;
}
