/**
 * Keyboard focus ring for a button that fills an `overflow-hidden` box whose
 * children paint over it (#285: the artwork button, the shirt hero, the
 * checkout tile). The browser's own ring, and an `outline` on the button,
 * are drawn under such opaque absolutely positioned children or clipped by
 * the box; a positioned `::after` with a z-index paints after them.
 *
 * Two tones in two bands: the ink border occupies 0-2px from the edge and
 * the paper outline 2-4px. The outline offset is -4, not -2: an outline
 * paints above borders, so at -2 the paper line would sit on the same 0-2px
 * band, cover the ink one, and the ring would vanish on a White shirt or on
 * paper. (A class-string test cannot see that overdraw; it was found by
 * reading pixels.) The pair reads on a Black shirt and on paper. The element
 * using it must be positioned (`relative` or `absolute`) so `inset-0`
 * measures against it.
 * The full class names are written out here so Tailwind finds them.
 */
export const INSET_FOCUS_RING =
  "focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:z-30 focus-visible:after:border-2 focus-visible:after:border-foreground focus-visible:after:outline-2 focus-visible:after:-outline-offset-4 focus-visible:after:outline-background";
