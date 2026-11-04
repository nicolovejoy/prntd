/**
 * Better-Auth's limiter (node_modules/better-auth/dist/api/rate-limiter) keeps
 * one bucket per ip|path. Every allowed request refreshes the bucket's
 * lastRequest, and the count resets only after `window` seconds with no
 * request on that bucket, so `max` caps a run of back-to-back requests, not a
 * rate. Defaults: 3 per 10 s on /sign-in*, /sign-up*, /change-password and
 * /change-email, and 100 per 10 s on every other path.
 *
 * The local e2e suite runs many workers from one IP, each polling get-session
 * and minting a guest, so it needs far higher ceilings. The harness passes
 * them through E2E_AUTH_SIGNIN_RATE_MAX and E2E_AUTH_GLOBAL_RATE_MAX; they are
 * honoured only when E2E_TRUST_LOCALHOST is "true" and VERCEL_ENV is unset.
 */
export const SIGNIN_RATE_WINDOW_SECONDS = 10;
export const RATE_MAX_CEILING = 1_000_000;

/** Parse one override. Returns null unless it is an integer in
 * [1, RATE_MAX_CEILING], the e2e harness flag is on, and this is not a Vercel
 * deployment. */
export function parseRateMax(
  value: string | undefined,
  guards: { vercelEnv: string | undefined; trustLocalhost: string | undefined }
): number | null {
  if (guards.vercelEnv) return null;
  if (guards.trustLocalhost !== "true") return null;
  if (value === undefined || !/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n > 0 && n <= RATE_MAX_CEILING ? n : null;
}

/** Better-Auth `rateLimit.customRules` for the paths its default 3/10 s rule
 * covers. A custom rule replaces the default rule for the paths it matches. */
export function signinRateLimitRules(
  max: number | null
): Record<string, { window: number; max: number }> | undefined {
  if (max === null) return undefined;
  const rule = { window: SIGNIN_RATE_WINDOW_SECONDS, max };
  return {
    "/sign-in/*": rule,
    "/sign-up/*": rule,
    "/change-password": rule,
    "/change-email": rule,
  };
}

/** The `rateLimit` option for the e2e overrides, or undefined when neither is
 * set. `window`, `enabled` and `storage` are left out so Better-Auth's
 * defaults still apply. */
export function e2eRateLimitOptions(
  signinMax: number | null,
  globalMax: number | null
):
  | {
      max?: number;
      customRules?: Record<string, { window: number; max: number }>;
    }
  | undefined {
  const customRules = signinRateLimitRules(signinMax);
  if (!customRules && globalMax === null) return undefined;
  return {
    ...(globalMax !== null ? { max: globalMax } : {}),
    ...(customRules ? { customRules } : {}),
  };
}
