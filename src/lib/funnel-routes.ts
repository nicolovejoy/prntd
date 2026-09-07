// Funnel = the purchase path (#74). The floating feedback launcher is hidden
// on these routes — it overlapped the generate CTA on /design mobile — and the
// header "Feedback" menu item covers them instead. /studio's Bench tab joined
// when it became the signed-in landing (nav re-map, 2026-09-01): its docked
// composer puts Generate at bottom-right, exactly where the launcher floats —
// the whole /studio prefix is swept in, even though /studio/library and
// /studio/archive have no docked composer or fixed bottom bar of their own;
// nothing so far has needed the launcher to distinguish the three tabs. /d
// joined for the same shape of reason (nav-model-a, 2026-09-07): it's the
// buy page, and the launcher overlapped its sticky Add-to-cart bar.
const FUNNEL_PREFIXES = ["/design", "/preview", "/order", "/cart", "/studio", "/d"];

export function isFunnelRoute(pathname: string): boolean {
  return FUNNEL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
