/**
 * Order for the back-source picker (#139): by image.luminance, so the
 * designs that read best on the chosen shirt come first. The direction
 * defaults from the shirt colour (a light shirt wants dark designs first)
 * and one control in the picker flips it. Unscored images (null) go last in
 * either direction, in the order they arrived (newest first, as the groups
 * are built), so the picker before the backfill reads like today.
 */
import { relativeLuminance } from "@/lib/blanks";

export type SortDirection = "light-first" | "dark-first";

/** A shirt at or above this relative luminance counts as light. 0.18 is the
 * linear value of perceptual mid-grey (L* 50). */
export const LIGHT_SHIRT_MIN_LUMINANCE = 0.18;

export function defaultSortForShirt(colorHex: string): SortDirection {
  return relativeLuminance(colorHex) >= LIGHT_SHIRT_MIN_LUMINANCE ? "dark-first" : "light-first";
}

/** Stable; returns a new array. */
export function sortBySuitability<T extends { luminance: number | null }>(
  images: readonly T[],
  direction: SortDirection
): T[] {
  const scored = images.filter((i) => i.luminance !== null) as Array<T & { luminance: number }>;
  const unscored = images.filter((i) => i.luminance === null);
  const sign = direction === "light-first" ? -1 : 1;
  // Array.prototype.sort is stable, so equal luminances keep their order.
  scored.sort((a, b) => sign * (a.luminance - b.luminance));
  return [...scored, ...unscored];
}
