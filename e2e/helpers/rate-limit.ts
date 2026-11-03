/**
 * Sign-in requests allowed per 10 s per IP while the e2e server runs.
 * Better-Auth's default is 3, which nine parallel workers minting guests
 * from one IP exceed. playwright.config.ts passes this to the server as
 * E2E_AUTH_SIGNIN_RATE_MAX (read in src/lib/auth.ts); the rate-limit spec
 * loops past it to reach a 429.
 */
export const E2E_SIGNIN_RATE_MAX = 30;
