// Funnel = the purchase path (#74). The floating feedback launcher is hidden
// on these routes — it overlapped the generate CTA on /design mobile — and the
// header "Feedback" menu item covers them instead.
const FUNNEL_PREFIXES = ["/design", "/preview", "/order", "/cart"];

export function isFunnelRoute(pathname: string): boolean {
  return FUNNEL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
