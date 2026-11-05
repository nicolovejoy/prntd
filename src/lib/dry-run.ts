/**
 * The test-only short-circuits: `PRINTFUL_DRY_RUN` (no real Printful order or
 * quote) and `R2_DRY_RUN` (no R2 write). They exist for local runs, CI's e2e
 * jobs and Vercel Previews. In a Production deployment (`VERCEL_ENV` is
 * `production`) a flag set by mistake would quietly leave paid orders
 * unsubmitted or images unstored, so there it is ignored, with one error log
 * per process naming it (#354's open question; Claude's ruling, 2026-11-04,
 * in the hardening PR's body). Read per
 * call, so a test can set and clear it.
 */
export type DryRunFlag = "PRINTFUL_DRY_RUN" | "R2_DRY_RUN";

const warned = new Set<DryRunFlag>();

export function dryRunEnabled(name: DryRunFlag): boolean {
  if (process.env[name] !== "true") return false;
  if (process.env.VERCEL_ENV === "production") {
    if (!warned.has(name)) {
      warned.add(name);
      console.error(`[${name}] is set in a Production deployment; ignoring it`);
    }
    return false;
  }
  return true;
}
