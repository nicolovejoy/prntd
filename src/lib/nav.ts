/**
 * Centralized navigation hierarchy. One source of truth for "where does a
 * given route sit, and what's above it" — consumed by <Breadcrumbs> (the
 * visible trail + mobile back chip) and by Escape-to-go-up.
 *
 * The trail is ancestor crumbs only, nearest-last; the current page is NOT
 * included (callers pass their own `current` label, since a detail page's
 * label is dynamic — e.g. a design title). The LAST crumb is the immediate
 * parent: the mobile back chip and the Escape target.
 *
 * "Up" is deterministic (a real href we push to), never browser-history
 * back — see docs/funnel-back-nav.md for why router.back() was unreliable
 * across the /preview URL-rewrite churn.
 */

export type Crumb = { label: string; href: string };

// `/` is auth-aware since the nav re-map (2026-09-01): signed-in users are
// redirected to /studio server-side. The crumb keeps pointing at `/` on
// purpose — "Home" means wherever the root resolves for this visitor, and a
// pure helper can't know auth state. Cost: one extra server hop on Escape
// from a top-level hub while signed in.
export const HOME: Crumb = { label: "Home", href: "/" };

/**
 * A design detail (/d/[id]) is reachable from several hubs. We record the
 * origin in ?from so "up" returns there; shared links with no origin fall
 * back to the Shop, the public storefront. The Studio's lightbox Order and the
 * conversation page's Order links open the page with `from=/studio` (#278
 * slice 4), so "up" returns to the Studio bench.
 *
 * The retired marker /prints, and /studio/library (My Designs' address
 * before nav model A moved it to /designs), still resolve — links carrying
 * them were shared before the move and outlive it.
 */
/** The origins `detailParent` knows; any other `from` is treated as absent. */
const DETAIL_ORIGINS = ["/designs", "/studio/library", "/orders", "/shop", "/prints", "/studio"];

function detailParent(from: string | undefined): Crumb {
  switch (from) {
    case "/designs":
    case "/studio/library":
      return { label: "My Designs", href: "/designs" };
    case "/orders":
      return { label: "Orders", href: "/orders" };
    case "/studio":
      return { label: "Studio", href: "/studio" };
    case "/shop":
    case "/prints":
    default:
      return { label: "Shop", href: "/shop" };
  }
}

/**
 * The `from` an image detail page navigates with. An explicit `?from` wins
 * when `detailParent` recognises it; an empty, unknown or unsafe one (`?from=`,
 * `?from=//evil.example`, the image's own page) counts as absent, so it can't
 * beat the fallback below. Without one, a published image falls back to the Shop (detailParent), and an
 * unpublished one to My Designs: it is private, so it is not in the Shop, and
 * the buyer who backs out of an order for it (Stripe's cancel link, the
 * embedded Back, the sign-in detour) arrives with no `from` because the return
 * path never carries a client-sent one.
 */
export function detailFrom(
  from: string | undefined,
  published: boolean
): string | undefined {
  if (from && DETAIL_ORIGINS.includes(from)) return from;
  return published ? undefined : "/designs";
}

/**
 * Ancestor crumbs for `pathname`, nearest-last. The conversation page hangs
 * off the Studio, the image detail page off the origin recorded in `from`, and
 * the order confirmation page off order history. /order and /preview only
 * redirect, so they have no trail. Top-level hubs sit directly under Home.
 * Unknown routes return [].
 */
export function breadcrumbTrail(
  pathname: string,
  params: Record<string, string | undefined> = {}
): Crumb[] {
  const studio: Crumb = { label: "Studio", href: "/studio" };

  if (pathname === "/") return [];

  if (
    pathname === "/shop" ||
    pathname === "/studio" ||
    pathname === "/designs" ||
    pathname === "/orders" ||
    pathname === "/admin"
  ) {
    return [HOME];
  }

  if (pathname === "/cart") return [HOME];
  // The thread hangs off the Studio bench, not My Designs: the bench is where
  // a conversation you are still working on lives.
  if (pathname === "/design") return [HOME, studio];
  // Terminal success page: its only useful "up" is order history — the buy
  // page needs an id we no longer carry post-checkout.
  if (pathname === "/order/confirm")
    return [HOME, { label: "Orders", href: "/orders" }];

  if (pathname.startsWith("/d/")) return [HOME, detailParent(params.from)];

  if (
    pathname === "/admin/published" ||
    pathname === "/admin/errors" ||
    pathname.startsWith("/admin/orders/")
  )
    return [HOME, { label: "Admin", href: "/admin" }];

  return [];
}

/**
 * Whether `pathname` sits inside the section rooted at `href` — an exact
 * match, or a path under it. Used by the header bar to underline the current
 * primary link; a prefix match alone would be wrong (`/design` must not
 * light up `/designs`, nor the reverse).
 */
export function isCurrentSection(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** The immediate parent — Escape target and mobile back chip — or null at the root. */
export function upTarget(
  pathname: string,
  params: Record<string, string | undefined> = {}
): Crumb | null {
  const trail = breadcrumbTrail(pathname, params);
  return trail.length > 0 ? trail[trail.length - 1] : null;
}
