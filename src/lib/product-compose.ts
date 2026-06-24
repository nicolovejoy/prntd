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
 * `design_image` persists `aspect_ratio` but NOT pixel dimensions or an alpha
 * flag yet (the plan's deferred "new metadata"). Build the validity artwork
 * from what we know; the unknowns use non-warning sentinels so the rule never
 * FALSE-warns — it surfaces only the aspect + placement-exists checks we can
 * actually evaluate today. When pixel/alpha capture lands, pass them through
 * and the DPI + knockout rules light up for free.
 */
const UNKNOWN_HIRES_PX = 1_000_000; // unknown resolution ⇒ DPI check can't fire

export function artworkFromAspect(aspectRatio: AspectRatio): DesignArtwork {
  return {
    aspectRatio,
    pixelWidth: UNKNOWN_HIRES_PX,
    pixelHeight: UNKNOWN_HIRES_PX,
    hasTransparency: true, // unknown ⇒ don't warn the knockout rule
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
}): FitResult {
  const blank = getBlankOrThrow(params.blankId);
  return validatePlacementFit({
    blank,
    placementId: params.placementId,
    artwork: artworkFromAspect(params.aspectRatio),
    coloredGarment: params.coloredGarment,
  });
}
