/**
 * Pure compose-time helpers for the organizer "Product" (design × blank ×
 * placement). The validity rule itself lives in `blanks.ts`
 * (`validatePlacementFit`); this adapts it to the data a `design_image` row
 * actually persists today.
 */
import {
  getBlankOrThrow,
  validatePlacementFit,
  type AspectRatio,
  type DesignArtwork,
  type FitResult,
} from "./blanks";

/**
 * `design_image` persists `aspect_ratio` but NOT pixel dimensions (the plan's
 * deferred "new metadata"). Build the validity artwork from what we know; the
 * unknowns use non-warning sentinels so the rule never FALSE-warns. Alpha is
 * probed server-side where available (`probeImageAlpha` in image-alpha.ts) and
 * passed through; undefined keeps the non-warning sentinel. When pixel capture
 * lands, pass it through and the DPI rule lights up for free.
 */
const UNKNOWN_HIRES_PX = 1_000_000; // unknown resolution ⇒ DPI check can't fire

export function artworkFromAspect(
  aspectRatio: AspectRatio,
  hasTransparency?: boolean
): DesignArtwork {
  return {
    aspectRatio,
    pixelWidth: UNKNOWN_HIRES_PX,
    pixelHeight: UNKNOWN_HIRES_PX,
    // unknown ⇒ don't warn the knockout rule (warn-not-block policy)
    hasTransparency: hasTransparency ?? true,
  };
}

/**
 * Can this design (by its image's aspect) print on this blank at this
 * placement? Thin wrapper over `validatePlacementFit` for the compose UI's
 * live warn+fix. Warn-not-block policy is inherited from the rule.
 */
export function checkProductFit(params: {
  blankId: string;
  placementId: string;
  aspectRatio: AspectRatio;
  /** Whether the chosen variant is a dark/colored garment (DTG knockout rule). */
  coloredGarment?: boolean;
  /** Whether the artwork PNG carries alpha; undefined = unknown (no warning). */
  hasTransparency?: boolean;
}): FitResult {
  const blank = getBlankOrThrow(params.blankId);
  return validatePlacementFit({
    blank,
    placementId: params.placementId,
    artwork: artworkFromAspect(params.aspectRatio, params.hasTransparency),
    coloredGarment: params.coloredGarment,
  });
}
