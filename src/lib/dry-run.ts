/**
 * The test-only short-circuits: `PRINTFUL_DRY_RUN` (no real Printful order or
 * quote) and `R2_DRY_RUN` (no R2 write). They exist for local runs, CI's e2e
 * jobs and Vercel Previews.
 *
 * When `VERCEL_ENV` is `production` a set flag throws instead of answering.
 * In a real Production deployment a flag set by mistake would otherwise leave
 * paid orders unsubmitted (with a fake Printful id) or images unstored, and
 * nobody would see it; the throw fails the submission or the write loudly
 * (`/admin/errors`, the fulfillment retry cron picks the order up once the
 * flag is gone). A local run whose env file was filled by `vercel env pull`
 * from Production also carries `VERCEL_ENV=production`; there the throw keeps
 * the dry run's promise (no real order, no real write) instead of turning
 * it off. Ignoring the flag was the first version and was reversed for that
 * reason (#368's review). Read per call, so a test can set and clear it.
 */
export type DryRunFlag = "PRINTFUL_DRY_RUN" | "R2_DRY_RUN";

export function dryRunEnabled(name: DryRunFlag): boolean {
  if (process.env[name] !== "true") return false;
  if (process.env.VERCEL_ENV === "production") {
    throw new Error(
      `${name}=true with VERCEL_ENV=production: refusing both the dry run and the real call`
    );
  }
  return true;
}
