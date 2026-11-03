/**
 * Ceilings for Better-Auth's limiter while the e2e server runs. The limiter
 * keeps a bucket per ip|path; an allowed request refreshes it and the count
 * resets only after 10 s with no request on that bucket, so `max` caps a run
 * of back-to-back requests rather than a rate. Defaults are 3 on sign-in
 * paths and 100 elsewhere, which nine workers sharing one IP exceed.
 * playwright.config.ts passes these to the server as
 * E2E_AUTH_SIGNIN_RATE_MAX and E2E_AUTH_GLOBAL_RATE_MAX (read in
 * src/lib/auth.ts); the rate-limit spec loops past the sign-in one to reach a
 * 429.
 */
export const E2E_SIGNIN_RATE_MAX = 1000;
export const E2E_GLOBAL_RATE_MAX = 10000;
