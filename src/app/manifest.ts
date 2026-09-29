import type { MetadataRoute } from "next";

// Paper ground (#f8f5ef, the hex the icon and the OG card use for the
// globals.css --background token).
const PAPER = "#f8f5ef";

/**
 * Web app manifest (#235). Next serves it at /manifest.webmanifest and links
 * it from every page's head. The PNGs under public/icons/ come from
 * scripts/generate-icons.ts; the iPhone home-screen icon is
 * src/app/apple-icon.png, which Next links as apple-touch-icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PRNTD",
    short_name: "PRNTD",
    start_url: "/",
    display: "standalone",
    background_color: PAPER,
    theme_color: PAPER,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
