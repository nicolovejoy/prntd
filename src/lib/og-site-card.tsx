/**
 * The site-wide branded share card, as satori markup for `next/og`.
 *
 * Extracted so the root `opengraph-image` and the per-image card's fallback
 * are one definition rather than two that drift. This is NOT a DOM component
 * — satori supports a narrow subset of CSS, so every element carries explicit
 * `display` and inline styles.
 */
import { publishedBackdrop } from "./blanks";
import { relativeLuminance } from "./instant-preview";

export const SITE_CARD_SIZE = { width: 1200, height: 630 };

/**
 * Backdrop + wordmark contrast for a design card. Pure, and separated from
 * the markup because it is the only part with a decision in it: legacy
 * listings carry a null backdrop and display White (#76), and the wordmark
 * has to stay legible on a White backdrop and on a Black one.
 */
export function designCardPalette(backgroundColor: string | null | undefined): {
  backdrop: string;
  wordmark: string;
} {
  const backdrop =
    publishedBackdrop(backgroundColor).style?.backgroundColor ?? "#ffffff";
  return {
    backdrop,
    wordmark:
      relativeLuminance(backdrop) >= 0.5
        ? "rgba(0,0,0,0.45)"
        : "rgba(255,255,255,0.55)",
  };
}

/** Mirrors the site palette (near-black bg, white accent) from globals.css. */
export function SiteCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "96px",
        background: "#0a0a0a",
        color: "#ededed",
      }}
    >
      <div
        style={{
          fontSize: 220,
          fontWeight: 800,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color: "#ffffff",
        }}
      >
        PRNTD
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 32,
          fontSize: 52,
          color: "#999999",
        }}
      >
        Your idea, on a shirt.
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 28,
          fontSize: 34,
          color: "#666666",
        }}
      >
        prntd.org
      </div>
      {/* accent underline strip */}
      <div
        style={{
          display: "flex",
          marginTop: 56,
          width: 280,
          height: 10,
          background: "#ffffff",
          borderRadius: 5,
        }}
      />
    </div>
  );
}
