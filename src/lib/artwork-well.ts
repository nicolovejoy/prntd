/**
 * Which well unpublished artwork sits on (#139). The paper well
 * (--surface-well) makes a light design read as blank, so artwork whose mean
 * luminance (image.luminance) has less than 3:1 contrast against it — WCAG's
 * floor for large graphics, roughly "lighter than mid-grey" — goes on the ink
 * well (--surface-well-dark) instead. Unscored artwork (null) stays on paper,
 * so the day-one state before the backfill is today's.
 *
 * Published artwork never comes here on a surface that paints a backdrop: it
 * sits on its pinned Shop backdrop (publishedBackdrop). The back-source
 * picker paints no backdrop for any image, so it uses this rule for all.
 */
import { relativeLuminance } from "@/lib/blanks";

/** Must match --surface-well and --surface-well-dark in globals.css. */
export const PAPER_WELL_HEX = "#e6e3dd";
export const DARK_WELL_HEX = "#141311";

const PAPER_LUMINANCE = relativeLuminance(PAPER_WELL_HEX);
const MIN_CONTRAST = 3;

/** WCAG contrast ratio of two relative luminances, 1 to 21. */
export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

export type ArtworkWell = "paper" | "dark";

export function wellForLuminance(luminance: number | null): ArtworkWell {
  if (luminance === null) return "paper";
  return contrastRatio(luminance, PAPER_LUMINANCE) < MIN_CONTRAST ? "dark" : "paper";
}

export function wellClass(luminance: number | null): "bg-surface-well" | "bg-surface-well-dark" {
  return wellForLuminance(luminance) === "dark" ? "bg-surface-well-dark" : "bg-surface-well";
}
