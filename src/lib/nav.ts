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

export const HOME: Crumb = { label: "Home", href: "/" };

/** Build a query string from whichever of `keys` are present in `params`. */
function query(
  params: Record<string, string | undefined>,
  keys: string[]
): string {
  const usp = new URLSearchParams();
  for (const k of keys) {
    const v = params[k];
    if (v) usp.set(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

/**
 * A design detail (/d/[id]) is reachable from several hubs. We record the
 * origin in ?from so "up" returns there; shared links with no origin fall
 * back to the Shop, the public storefront.
 */
function detailParent(from: string | undefined): Crumb {
  switch (from) {
    case "/designs":
      return { label: "My Designs", href: "/designs" };
    case "/orders":
      return { label: "Orders", href: "/orders" };
    case "/prints":
    default:
      return { label: "Shop", href: "/prints" };
  }
}

/**
 * Ancestor crumbs for `pathname`, nearest-last. Funnel pages (/design →
 * /preview → /order → /order/confirm) share one spine and thread id /
 * product / color through their hrefs so stepping up lands on a fully-formed
 * URL. Top-level hubs sit directly under Home. Unknown routes return [].
 */
export function breadcrumbTrail(
  pathname: string,
  params: Record<string, string | undefined> = {}
): Crumb[] {
  const myDesigns: Crumb = { label: "My Designs", href: "/designs" };
  const designStep: Crumb = {
    label: "Design",
    href: `/design${query(params, ["id"])}`,
  };
  const previewStep: Crumb = {
    label: "Preview",
    href: `/preview${query(params, ["id", "product"])}`,
  };

  if (pathname === "/") return [];

  if (
    pathname === "/prints" ||
    pathname === "/designs" ||
    pathname === "/orders" ||
    pathname === "/admin"
  ) {
    return [HOME];
  }

  if (pathname === "/cart") return [HOME];
  if (pathname === "/design") return [HOME, myDesigns];
  if (pathname === "/preview") return [HOME, myDesigns, designStep];
  if (pathname === "/order") return [HOME, myDesigns, designStep, previewStep];
  // Terminal success page: its only useful "up" is order history — the
  // funnel /order needs an id we no longer carry post-checkout.
  if (pathname === "/order/confirm")
    return [HOME, { label: "Orders", href: "/orders" }];

  if (pathname.startsWith("/d/")) return [HOME, detailParent(params.from)];

  if (pathname === "/admin/published" || pathname.startsWith("/admin/orders/"))
    return [HOME, { label: "Admin", href: "/admin" }];

  return [];
}

/** The immediate parent — Escape target and mobile back chip — or null at the root. */
export function upTarget(
  pathname: string,
  params: Record<string, string | undefined> = {}
): Crumb | null {
  const trail = breadcrumbTrail(pathname, params);
  return trail.length > 0 ? trail[trail.length - 1] : null;
}
