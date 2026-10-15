/**
 * Embedded checkout config resolution (#135 slice 2) — pure, no db, no
 * network. `resolveEmbeddedCheckoutConfig` is the fail-closed gate: callers
 * that want to create or mount an embedded Stripe session call one of the
 * env-reading wrappers below rather than the raw flags in src/lib/flags.ts,
 * so a misconfigured key pair degrades to hosted checkout instead of
 * building a broken embedded session. The image detail page, the cart, the
 * /checkout page and its loader share one switch, `embeddedCheckoutConfig()`
 * (EMBEDDED_CHECKOUT_ENABLED). `resolveReturnOrigin` picks
 * the origin an embedded session returns to; `vercelDeployment()` reads the
 * Vercel system variables it needs.
 */

import { safeNextPath } from "@/lib/safe-next";

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
 * env string, so this stays a pure function of its inputs, testable without
 * touching `process.env`. `embeddedCheckoutConfig()` reads the env
 * (EMBEDDED_CHECKOUT_ENABLED).
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
 * env-reading wrapper around `resolveEmbeddedCheckoutConfig` for the image
 * detail page's buy action, the cart's checkout, the /checkout page and its
 * loader (EMBEDDED_CHECKOUT_ENABLED).
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

// Bounds the incoming query value (`from` on /checkout and /order/confirm, and
// the sign-in `next=` built from it), checked on the resolved output.
export const MAX_CHECKOUT_RETURN_PATH_LENGTH = 2048;

/**
 * A same-origin redirect target. Used for the `/checkout?...&from=` back link,
 * the `?next=` sign-in redirect built from it, and the `from=` on Stripe's
 * `return_url` — all attacker-influenceable (query params), so this refuses
 * anything that isn't an unambiguous relative path: must start with a single
 * `/` (never `//`, which browsers treat as protocol-relative to another
 * host), must not contain a backslash (some browsers normalize `\` to `/`),
 * must not contain control characters, and neither the input nor the
 * resolved path may exceed MAX_CHECKOUT_RETURN_PATH_LENGTH. Those raw checks
 * reject outright; then the value is resolved the way a browser would resolve it (dot segments
 * collapsed, `/.//evil.example` caught) by `safeNextPath`, the repo's shared
 * rule, and the resolved path is returned. Falls back to `/shop` rather than
 * throwing, since this runs on the redirect path itself.
 */
export function safeCheckoutReturnPath(from: unknown): string {
  if (typeof from !== "string") return "/shop";
  if (from.length === 0) return "/shop";
  if (from.length > MAX_CHECKOUT_RETURN_PATH_LENGTH) return "/shop"; // cheap pre-check
  if (!from.startsWith("/")) return "/shop";
  if (from.startsWith("//")) return "/shop";
  if (from.includes("\\")) return "/shop";
  if (CONTROL_CHAR_RE.test(from)) return "/shop";
  // safeNextPath percent-encodes, so the output can be longer than the input;
  // capping it here keeps the function idempotent across /order/confirm and
  // /checkout.
  const out = safeNextPath(from, "/shop");
  return out.length > MAX_CHECKOUT_RETURN_PATH_LENGTH ? "/shop" : out;
}

/**
 * The relative path `buyPublishedDesign` and `checkoutCart`
 * return as `url` for the client to navigate to when
 * embedded checkout is enabled — same-origin, so it works unchanged on a
 * preview deploy (a preview and prod have different origins).
 */
export function embeddedCheckoutPath(sessionId: string, backPath: string): string {
  const safeBack = safeCheckoutReturnPath(backPath);
  return `/checkout?session=${encodeURIComponent(sessionId)}&from=${encodeURIComponent(safeBack)}`;
}

/**
 * The three Vercel system variables this module reads. Pure data so
 * `resolveReturnOrigin` stays a function of its inputs; `vercelDeployment()`
 * fills it from the process environment. Vercel sets `VERCEL_ENV` to
 * `production`, `preview` or `development`, and `VERCEL_URL` /
 * `VERCEL_BRANCH_URL` to the deployment's own hosts (no scheme). All three
 * are absent outside Vercel.
 */
export type VercelDeployment = {
  env: string | undefined;
  url: string | undefined;
  branchUrl: string | undefined;
};

export function vercelDeployment(): VercelDeployment {
  return {
    env: process.env.VERCEL_ENV,
    url: process.env.VERCEL_URL,
    branchUrl: process.env.VERCEL_BRANCH_URL,
  };
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
 * Trusts the origin of `appUrl` anywhere (this covers prntd.org in
 * Production, and local dev and the e2e harness, where `NEXT_PUBLIC_APP_URL`
 * is a localhost URL). On a Vercel Preview (`deployment.env === "preview"`)
 * it also trusts the deployment's own two hosts, `VERCEL_URL` and
 * `VERCEL_BRANCH_URL`, over https, compared case-insensitively and including
 * any port. It does not trust: any `vercel.app` host in Production,
 * including its own `VERCEL_URL` (Production buyers shop on prntd.org; a
 * Production deployment's vercel.app hosts are not a buying surface, and the
 * canonical domain is the only Production return); a `vercel.app` host whose name merely
 * looks like ours or belongs to another deployment; plain http (other than
 * an `appUrl` that is itself http); or any other prntd.org subdomain. The
 * value decides where a live payment session returns, so it is matched
 * against the deployment's own hosts rather than a name shape. This is
 * narrower than `src/lib/auth.ts`'s `trustedOrigins`, which accepts any
 * `prntd-*.vercel.app` and `*.prntd.org` host for CSRF checks. Anything else
 * — missing, malformed, a different host, a non-http(s) scheme like
 * `javascript:` — falls back to `appUrl`'s origin. Always returns a bare
 * origin (no path, no trailing slash). Next.js already rejects a server
 * action POST whose `Origin` doesn't match `Host`/its own trusted-origins
 * config, so this check is defence in depth, not the only guard.
 *
 * Never throws, including when `appUrl` is missing or malformed (e.g.
 * `NEXT_PUBLIC_APP_URL` unset) — an empty fallback then degrades the same
 * way an unset `NEXT_PUBLIC_APP_URL` already does on the hosted checkout
 * path.
 */
export function resolveReturnOrigin(
  originHeader: string | null,
  appUrl: string | undefined,
  deployment: VercelDeployment
): string {
  if (typeof appUrl !== "string") return "";
  let fallback: string;
  try {
    fallback = new URL(appUrl).origin;
  } catch {
    return appUrl.replace(/\/+$/, "");
  }
  if (!originHeader) return fallback;

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return fallback;
  }

  if (origin.origin === fallback) return origin.origin;

  if (deployment.env === "preview" && origin.protocol === "https:") {
    const own = [deployment.url, deployment.branchUrl]
      .map((h) => (h ?? "").trim().toLowerCase())
      .filter((h) => h !== "");
    if (own.includes(origin.host.toLowerCase())) return origin.origin;
  }

  return fallback;
}
