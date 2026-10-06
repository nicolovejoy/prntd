/**
 * Keyboard focus ring for a button that fills an `overflow-hidden` box whose
 * children paint over it (#285: the artwork button, the shirt hero, the
 * checkout tile). The browser's own ring, and an `outline` on the button,
 * are drawn under such opaque absolutely positioned children or clipped by
 * the box; a positioned `::after` with a z-index paints after them.
 *
 * Two tones, an ink line outside and a paper line inside it, so it reads on
 * a Black shirt as well as on paper. The element using it must be
 * positioned (`relative` or `absolute`) so `inset-0` measures against it.
 * The full class names are written out here so Tailwind finds them.
 */
export const INSET_FOCUS_RING =
  "focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:z-30 focus-visible:after:border-2 focus-visible:after:border-foreground focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-background";
