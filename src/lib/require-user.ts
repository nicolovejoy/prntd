import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, isAnonymousUser } from "@/lib/auth";
import { guestFunnelEnabled } from "@/lib/flags";
import { withNext } from "@/lib/safe-next";

/**
 * Session gate for real-account pages (/orders) rendered as server
 * components. The proxy already bounces cookie-less visitors; this covers the
 * remaining case — an anonymous guest session (#26) — with the same redirect
 * instead of the Unauthorized throw the old client-fetch path surfaced as an
 * error state.
 *
 * `currentPath` is the page's own route (an explicit literal from the call
 * site, not read off headers — every caller today is a static route with no
 * searchParams to carry along, and a parameter is simpler to test than
 * threading headers() through). It rides to /sign-in as `?next=`, the same
 * way the proxy's own redirect does, so a signed-out visitor who follows a
 * link here lands back on it after signing in instead of on the default
 * post-sign-in page.
 *
 * The Studio used this too until #241 opened it to guests; it now has its own
 * gate below.
 */
export async function requireRealUser(currentPath: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) {
    redirect(withNext("/sign-in", currentPath));
  }
  return session;
}

/**
 * Who may use the Studio bench and My Designs (#241, option 1) — the same
 * predicate, even though My Designs moved to its own top-level route
 * (nav model A, 2026-09-27).
 *
 * A real account always may. An anonymous guest-funnel session may too, but
 * only while GUEST_FUNNEL_ENABLED is on: the guest made those designs in the
 * funnel, their lanes and images are scoped to the anonymous user id, and
 * the Studio bench / My Designs are the only places that list them. With the
 * flag off there is no guest funnel, so both stay real-account-only, exactly
 * as before #241.
 *
 * One predicate for the pages AND their server actions, so the two can never
 * disagree about who gets in — a page that admits a guest whose poll action
 * then refuses them is a bench that errors on every tick.
 */
export function canUseStudio(
  user: { isAnonymous?: boolean | null } | null | undefined,
  guestFunnel: boolean
): boolean {
  if (!user) return false;
  if (!isAnonymousUser(user)) return true;
  return guestFunnel;
}

/**
 * Page gate for /studio and /designs (My Designs). Redirects to /sign-in when
 * canUseStudio says no; otherwise returns the session and whether it is a
 * guest's, so the view can render the guest line ("Sign up to keep these
 * designs. Have an account? Sign in.").
 *
 * `currentPath` (the caller's own route — see requireRealUser's docblock)
 * rides to /sign-in as `?next=`, same as the proxy's own redirect.
 *
 * A visitor with no session at all never reaches this: the proxy sends them
 * to /sign-in first (there is nothing of theirs to show).
 */
export async function requireStudioUser(currentPath: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !canUseStudio(session.user, guestFunnelEnabled())) {
    redirect(withNext("/sign-in", currentPath));
  }
  return { session, isGuest: isAnonymousUser(session.user) };
}

/**
 * Server-action gate for the Studio's own actions (the bench poll and the two
 * bulk deletes). Same predicate as the page gate; throws "Unauthorized" instead
 * of redirecting, because an action is reachable directly and a redirect from
 * one is not a refusal. Ownership is still each action's job — this only
 * decides whether the caller may use the Studio at all.
 */
export async function requireStudioActionSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !canUseStudio(session.user, guestFunnelEnabled())) {
    throw new Error("Unauthorized");
  }
  return session;
}
