"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { isAdminUser } from "@/app/admin/actions";
import { getCartCount } from "@/app/cart/actions";
import { sweepStaleJobs, countRunningJobsForUser } from "@/lib/generation-job";

export type HeaderState = { isAdmin: boolean; cartCount: number; runningJobs: number };

/**
 * Sweeps this user's overdue jobs (riding on a read that already happens, per
 * the durable-generation-job plan) and reports how many are still running.
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
  await sweepStaleJobs({ scope: "user", userId: user.id });
  return countRunningJobsForUser(user.id);
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
