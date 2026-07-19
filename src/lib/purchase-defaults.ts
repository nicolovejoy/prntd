/**
 * Pure precedence helpers for buy-surface defaults (#44, collapse plan §3).
 *
 * For each control: URL param (validated) > remembered default > static
 * default. Size is never silently defaulted (#66) — a remembered size
 * pre-selects a visible chip; with nothing remembered it stays null and the
 * CTA is gated. Color is NOT remembered: URL > the design's pinned backdrop
 * (when the palette has it) > White > first color.
 *
 * No DB access here — the remembered value comes from
 * `resolveLastPurchaseDefaults` (src/lib/last-purchase.ts).
 */
import {
  ACTIVE_BLANKS,
  DEFAULT_BLANK_ID,
  getBlankOrThrow,
  type BlankColor,
} from "@/lib/blanks";

export type PurchaseDefaults = {
  /** Blank catalog id from the last purchase; always in ACTIVE_BLANKS. */
  blankId: string;
  /** Size from the last purchase when the blank still offers it, else null. */
  size: string | null;
};

function activeBlank(id: string | null | undefined) {
  return id ? ACTIVE_BLANKS.find((b) => b.id === id) : undefined;
}

/**
 * Product + size precedence for a buy surface. URL values are validated
 * against the active catalog (a discontinued blank in a stale deep link falls
 * through, same as a discontinued remembered blank). Size validates against
 * whichever blank won.
 */
export function resolveProductAndSize(params: {
  urlProduct: string | null;
  urlSize: string | null;
  remembered: PurchaseDefaults | null;
}): { productId: string; size: string | null } {
  const { urlProduct, urlSize, remembered } = params;
  const blank =
    activeBlank(urlProduct) ??
    activeBlank(remembered?.blankId) ??
    getBlankOrThrow(DEFAULT_BLANK_ID);
  const size =
    urlSize && blank.sizes.includes(urlSize)
      ? urlSize
      : remembered?.size && blank.sizes.includes(remembered.size)
        ? remembered.size
        : null;
  return { productId: blank.id, size };
}

/**
 * Color precedence (§3, not remembered): URL > pinned backdrop > White >
 * first color. `pinnedApplied` tells the caller to label the default
 * ("Designer's pick") so it isn't a silent pick.
 */
export function resolveDefaultColor(params: {
  urlColor: string | null;
  pinnedColor: string | null;
  palette: BlankColor[];
}): { color: string; pinnedApplied: boolean } {
  const { urlColor, pinnedColor, palette } = params;
  const has = (name: string | null | undefined): name is string =>
    !!name && palette.some((c) => c.name === name);
  if (has(urlColor)) return { color: urlColor, pinnedApplied: false };
  if (has(pinnedColor)) return { color: pinnedColor, pinnedApplied: true };
  if (has("White")) return { color: "White", pinnedApplied: false };
  return { color: palette[0]?.name ?? "White", pinnedApplied: false };
}
