// Funnel = the purchase path (#74). The floating feedback launcher is hidden
// on these routes — it overlapped the generate CTA on /design mobile — and the
// header "Feedback" menu item covers them instead. The Studio bench joined
// when it became the signed-in landing (nav re-map, 2026-09-01): its composer
// was then docked as a fixed bottom bar, putting Generate at bottom-right,
// exactly where the launcher floats. The composer has since moved to a
// bordered panel at the TOP of the page (Paper bench, #188 slice 3), so the
// bench no longer has standing bottom chrome of its own — but its select-mode bar
// (Select all/Delete/Done) is still fixed to the bottom edge and stretches
// under the launcher's corner, so the prefix stays swept in. /designs (My
// Designs) was /studio/library until 2026-09-27 and so sat under the /studio
// prefix; it is listed on its own to keep that behaviour when it moved. It
// has no fixed bottom chrome (its select controls are inline above the
// grid), so this is continuity, not need — the header's Feedback menu item
// reaches the same panel. Note "/designs" is not covered by "/design": the
// match below requires a "/" boundary. /d joined for the
// same shape of reason (nav-model-a, 2026-09-07): it's the buy page, and the
// launcher overlapped its sticky Add-to-cart bar. /checkout joined for the
// same reason again (#135 slice 2): the embedded Stripe form is mounted
// full-width on phones, and the fixed-position launcher can sit right over
// its Pay button.
const FUNNEL_PREFIXES = [
  "/design",
  "/preview",
  "/order",
  "/cart",
  "/studio",
  "/designs",
  "/d",
  "/checkout",
];

export function isFunnelRoute(pathname: string): boolean {
  return FUNNEL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
