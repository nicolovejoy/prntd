"use client";

import {
  isDarkShirt,
  mockupBackdrop,
  type HeroDisplay,
  type Side,
} from "@/lib/instant-preview";

export type { Side };

/**
 * One side of the shirt as a layered preview (#167). Both buy surfaces
 * (`/preview` and the image detail page) render this twice — the hero and the
 * smaller tile — so the layers live in one place.
 *
 * Layers, bottom to top, exactly as the two hero blocks drew them before
 * this component existed:
 *
 *   1. instant layer (#57): the artwork centered on a flat panel of the shirt
 *      color, on screen immediately for any product/color/placement change;
 *   2. the exact Printful mockup, mounted as soon as its URL is known and
 *      faded in once its bytes load. The mockup has a white studio background
 *      baked in; `mix-blend-multiply` over `mockupBackdrop` maps those white
 *      pixels to the backdrop color, and `isolate` keeps the blend off the
 *      instant layer beneath;
 *   3. the pending indicator while the exact mockup is still on its way;
 *   4. a mono side label in the corner;
 *   5. the error overlay with retry — a sibling of the select button, never
 *      inside it, because a button inside a button is invalid HTML.
 *
 * Which state a side is in comes from `resolveHeroDisplay`; which of the two
 * sides is the hero comes from `sidesLayout`. This component only draws.
 */
export type SideMockupProps = {
  side: Side;
  variant: "hero" | "tile";
  /** `resolveHeroDisplay` output for this side. */
  display: HeroDisplay;
  /** Shirt color for the instant layer. */
  colorHex: string;
  /** Alt text for the mockup <img>. */
  alt: string;
  /** Instant-layer artwork width as % of the panel (`/preview` passes
   * scale × 62). Default 62. */
  artworkWidthPct?: number;
  /** Pending indicator text, e.g. "Final preview loading…". The tile shows
   * only the spinner. */
  pendingLabel: string;
  /** Reports the mockup URL the browser finished loading. */
  onMockupLoad: (url: string) => void;
  /** Visible failure state with retry. The caller decides the message
   * (placement render failed / mockup failed) and what retry does, and must
   * gate it on `display.showError` / its own mockup-error state — this
   * component renders the overlay whenever the prop is set. */
  error?: { message: string; retryLabel: string; onRetry: () => void } | null;
  /** Tapping the panel: hero → open the lightbox, tile → make this side the
   * hero. Without it the panel is inert. */
  onSelect?: () => void;
  /** Accessible name for the select button. */
  selectLabel?: string;
  /** Whether the Front/Back pill renders. Default `true` (today's
   * behaviour). The caller should pass `false` when only one side is on
   * screen — a lone panel with no counterpart has nothing for the label to
   * distinguish it from. */
  showSideLabel?: boolean;
  /** Size classes from the caller (w/h/max-h). */
  className?: string;
  testId?: string;
};

const SIDE_LABEL: Record<Side, string> = { front: "Front", back: "Back" };

export function SideMockup({
  side,
  variant,
  display,
  colorHex,
  alt,
  artworkWidthPct = 62,
  pendingLabel,
  onMockupLoad,
  error = null,
  onSelect,
  selectLabel,
  showSideLabel = true,
  className = "",
  testId,
}: SideMockupProps) {
  const tile = variant === "tile";
  // Captured so the onLoad closure reports the URL this layer was mounted
  // for, not whatever `display` holds when the bytes arrive.
  const mockupUrl = display.mockupUrl;

  const layers = (
    <>
      {/* Instant layer (#57). */}
      <div
        data-testid="side-mockup-instant"
        className="absolute inset-0 flex items-center justify-center"
        style={{ backgroundColor: colorHex }}
      >
        {display.artworkUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={display.artworkUrl}
            alt=""
            className="object-contain max-h-[70%]"
            style={{ width: `${Math.round(artworkWidthPct)}%` }}
          />
        )}
      </div>

      {/* Exact Printful mockup, crossfaded in over the instant layer once its
          image bytes arrive. */}
      {mockupUrl && (
        <div
          key={mockupUrl}
          data-testid="side-mockup-exact"
          className={`absolute inset-0 isolate transition-opacity duration-300 ${
            display.mockupVisible ? "opacity-100" : "opacity-0"
          }`}
          style={{ backgroundColor: mockupBackdrop(colorHex) }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mockupUrl}
            alt={alt}
            onLoad={() => onMockupLoad(mockupUrl)}
            className="w-full h-full object-contain mix-blend-multiply"
          />
        </div>
      )}

      {display.pendingExact && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
          <span
            className={`inline-flex items-center gap-2 text-xs ${
              isDarkShirt(colorHex) ? "text-accent-fg/80" : "text-foreground/60"
            }`}
          >
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {!tile && pendingLabel}
          </span>
        </div>
      )}
    </>
  );

  return (
    <div
      data-testid={testId}
      data-side={side}
      data-variant={variant}
      className={`relative overflow-hidden rounded-lg ${className}`}
    >
      {onSelect ? (
        <button
          type="button"
          aria-label={selectLabel}
          onClick={onSelect}
          className={`absolute inset-0 block w-full h-full ${
            tile ? "cursor-pointer" : "cursor-zoom-in"
          }`}
        >
          {layers}
        </button>
      ) : (
        <div className="absolute inset-0">{layers}</div>
      )}

      {/* Side label: a translucent pill so it reads on any shirt color. Sits
          outside the select button so the button's name stays `selectLabel`,
          and stays readable to assistive tech so a panel with no select
          button still says which side it is. Only rendered when the layout
          actually has two sides — with one side on screen there is nothing
          for "Front" to distinguish it from. */}
      {showSideLabel && (
        <span className="pointer-events-none absolute top-1.5 left-1.5 z-10 rounded-sm bg-foreground/70 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-fg backdrop-blur-sm">
          {SIDE_LABEL[side]}
        </span>
      )}

      {/* Error overlay. Sibling of the select button (z above it), so retry
          is a real button and its click never reaches `onSelect`. */}
      {error && (
        <div
          role="alert"
          className={`absolute inset-0 z-20 flex flex-col items-center justify-center bg-surface text-center ${
            tile ? "gap-1 px-1" : "gap-2 px-4"
          }`}
        >
          <span
            className={`text-text-muted ${
              tile ? "text-[10px] leading-tight" : "text-sm"
            }`}
          >
            {error.message}
          </span>
          <button
            type="button"
            onClick={error.onRetry}
            className={`min-h-11 min-w-11 rounded-md border border-border text-foreground hover:border-border-hover transition-colors ${
              tile ? "px-2 text-[11px]" : "px-3 text-sm"
            }`}
          >
            {error.retryLabel}
          </button>
        </div>
      )}
    </div>
  );
}
