// Funnel = the purchase path (#74). The floating feedback launcher is hidden
// on these routes — it overlapped the generate CTA on /design mobile — and the
// header "Feedback" menu item covers them instead. /studio joined when it
// became the signed-in landing (nav re-map, 2026-09-01): its docked composer
// puts Generate at bottom-right, exactly where the launcher floats.
const FUNNEL_PREFIXES = ["/design", "/preview", "/order", "/cart", "/studio"];

export function isFunnelRoute(pathname: string): boolean {
  return FUNNEL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
