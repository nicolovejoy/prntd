import { ImageResponse } from "next/og";
import { SiteCard, SITE_CARD_SIZE } from "@/lib/og-site-card";

export const alt = "PRNTD — Your idea, on a shirt";
export const size = SITE_CARD_SIZE;
export const contentType = "image/png";

// Branded share card. The markup lives in og-site-card so the per-image
// card's fallback (src/app/d/[imageId]/opengraph-image.tsx) uses the same
// one. Uses next/og's bundled default font (no font file needed).
export default function Image() {
  return new ImageResponse(<SiteCard />, { ...size });
}
