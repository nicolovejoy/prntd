/**
 * Better-Auth's built-in rule allows 3 sign-in/sign-up requests per 10 s per
 * IP (node_modules/better-auth/dist/api/rate-limiter, getDefaultSpecialRules).
 * The local e2e suite runs many workers from one IP and mints a guest per
 * test, so it exceeds that. E2E_AUTH_SIGNIN_RATE_MAX raises the limit for the
 * harness only; it is ignored on any Vercel deployment.
 */
export const SIGNIN_RATE_WINDOW_SECONDS = 10;

/** Parse the override. Returns null unless it is a positive integer and the
 * process is not a Vercel deployment. */
export function parseSigninRateMax(
  value: string | undefined,
  vercelEnv: string | undefined
): number | null {
  if (vercelEnv) return null;
  if (value === undefined || !/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Better-Auth `rateLimit.customRules` for the paths its default 3/10 s rule
 * covers (/sign-in*, /sign-up*, /change-password, /change-email), or undefined
 * when there is no override. A custom rule replaces the default rule for the
 * paths it matches. */
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

/** Ordinary paths (get-session and the rest) are limited per IP per path by
 * Better-Auth's global rule: 100 per 10 s (create-context.mjs defaults).
 * Nine e2e workers polling get-session from one IP exceed that, so the harness
 * raises it by the same override, as a fixed multiple of the sign-in max. */
export const GLOBAL_RATE_MAX_MULTIPLE = 10;

/** The whole `rateLimit` option for the e2e override, or undefined. `window`,
 * `enabled` and `storage` are left out so Better-Auth's defaults still apply. */
export function e2eRateLimitOptions(max: number | null):
  | {
      max: number;
      customRules: Record<string, { window: number; max: number }>;
    }
  | undefined {
  const customRules = signinRateLimitRules(max);
  if (!customRules || max === null) return undefined;
  return { max: max * GLOBAL_RATE_MAX_MULTIPLE, customRules };
}
