"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { auth, isAnonymousUser } from "@/lib/auth";
import { isAdminUser } from "@/app/admin/actions";
import { getCartCount } from "@/app/cart/actions";
import { sweepStaleJobs, countActiveGenerationsForUser } from "@/lib/generation-job";

export type HeaderState = { isAdmin: boolean; cartCount: number; runningJobs: number };

/**
 * The header's lazy stale-job sweep, in a shape `after()` can safely run:
 * it never rejects. An unhandled rejection out of an `after` continuation
 * runs on the shared Fluid instance, not inside anyone's request, and can
 * take other users' work down with it — the same reason
 * `after(() => runGenerationJob(...))` in design/actions.ts never throws
 * past its boundary.
 *
 * Deliberately NOT `sweepStudioForUser` (src/lib/studio.ts), even though it
 * takes the same `{ scope: "user" }` shape: that helper also runs
 * `sweepIdleConversations`, so reusing it here would move the 3-day
 * conversation archive onto every page view of every route, which is a
 * behavior change, not a latency fix.
 */
async function sweepUserJobsAfterResponse(userId: string): Promise<void> {
  try {
    await sweepStaleJobs({ scope: "user", userId });
  } catch (err) {
    console.error(
      "[header] sweepStaleJobs failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Reports how many of this user's generations are still running, and
 * schedules — does not await — the sweep of their overdue ones.
 *
 * The sweep is write-shaped and moved off the response with `after()`
 * (#210, same seam #204 used for /studio): it cost ~25-35ms of Turso round
 * trip on EVERY page view, for a sweep that almost always finds nothing,
 * and on /studio it duplicated the after() sweep already scheduled there.
 * Overlapping sweeps are safe — the transitions are conditional UPDATEs, so
 * a second one is a no-op.
 *
 * The trade, deliberately accepted: the count below can now include a job
 * that is past STALE_JOB_MS but not yet swept, so the badge can read one
 * too high for exactly one header fetch. It self-corrects on the next one,
 * which the header already performs on every pathname change, not just on
 * mount (site-header.tsx) — plus the next /studio load, the next thread
 * open, and the daily cron. Do not "fix" this by awaiting the sweep again.
 *
 * 0 for signed-out and anonymous guest-funnel visitors, without a job-table
 * query — a guest is looking at /design itself while their job runs, so the
 * header badge adds nothing there, and every anonymous page view would
 * otherwise cost a query for a number that's always going to be 0 anyway
 * (their jobs, if any, are scoped to their anon user id and this branch never
 * looks them up).
 */
async function runningJobsForCurrentUser(): Promise<number> {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user;
  if (!user || isAnonymousUser(user)) return 0;

  // Narrowest scope for this call site — only the cron sweeps scope: "all".
  // Scheduled BEFORE the read, so a thrown read still leaves the sweep to
  // run (same ordering as studio/page.tsx and studio/actions.ts).
  after(() => sweepUserJobsAfterResponse(user.id));
  // Display count, not slot count: a cancelled job still holds its slot but
  // must not keep the header pill lit until the provider call finishes.
  return countActiveGenerationsForUser(user.id);
}

/**
 * One round trip for the header's three session/DB-dependent checks (Admin
 * nav entry, cart count, running-generation count), replacing what used to
 * be two separate server-action calls (#127) before that (#144 collapsed
 * four down to one). Feature-flag checks (cart/stores enabled) don't need a
 * round trip at all — they're resolved server-side in layout.tsx and passed
 * down as props.
 *
 * The running-job count joins this same Promise.all rather than an
 * additional sequential await — regressing back to multiple round trips is
 * exactly what #144 fixed.
 *
 * cartOn skips the cart query entirely when the cart is disabled or the
 * caller already knows it's not shown.
 */
export async function getHeaderState(cartOn: boolean): Promise<HeaderState> {
  const [isAdmin, cartCount, runningJobs] = await Promise.all([
    isAdminUser(),
    cartOn ? getCartCount() : Promise.resolve(0),
    runningJobsForCurrentUser(),
  ]);
  return { isAdmin, cartCount, runningJobs };
}
