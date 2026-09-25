import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, isAnonymousUser } from "@/lib/auth";
import { guestFunnelEnabled } from "@/lib/flags";

/**
 * Session gate for real-account pages (/orders) rendered as server
 * components. Middleware already bounces cookie-less visitors; this covers the
 * remaining case — an anonymous guest session (#26) — with the same redirect
 * instead of the Unauthorized throw the old client-fetch path surfaced as an
 * error state.
 *
 * The Studio used this too until #241 opened it to guests; it now has its own
 * gate below.
 */
export async function requireRealUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) redirect("/sign-in");
  return session;
}

/**
 * Who may use the Studio — the bench and the library (#241, option 1).
 *
 * A real account always may. An anonymous guest-funnel session may too, but
 * only while GUEST_FUNNEL_ENABLED is on: the guest made those designs in the
 * funnel, their lanes and images are scoped to the anonymous user id, and
 * Studio is the only place that lists them. With the flag off there is no
 * guest funnel, so Studio stays real-account-only, exactly as before #241.
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
 * Page gate for /studio and /studio/library. Redirects to /sign-in when
 * canUseStudio says no; otherwise returns the session and whether it is a
 * guest's, so the view can render the guest line ("Sign up to keep these
 * designs. Have an account? Sign in.").
 *
 * A visitor with no session at all never reaches this: middleware sends them
 * to /sign-in first (there is nothing of theirs to show).
 */
export async function requireStudioUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !canUseStudio(session.user, guestFunnelEnabled())) {
    redirect("/sign-in");
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
