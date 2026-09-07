import { ImageResponse } from "next/og";
import { getImageShareCard } from "@/lib/image-share";
import { SiteCard, SITE_CARD_SIZE, designCardPalette } from "@/lib/og-site-card";

export const alt = "A design on PRNTD";
export const size = SITE_CARD_SIZE;
export const contentType = "image/png";

// A listing's title and backdrop are owner-editable, so the card is cached
// with a bound rather than forever. Nothing here reads a request-time API
// (no headers, no session) — that is what keeps the route cacheable, and
// what makes a cache hit safe to serve to any viewer. See image-share.ts.
export const revalidate = 3600;

/**
 * Per-design share card: the artwork on its own storefront backdrop, which
 * is the same thing the detail page leads with.
 *
 * Designs are transparent PNGs, so handing chat clients the bare R2 object
 * would let a light design vanish into the card's light paper ground —
 * compositing onto the pinned backdrop is the whole point. The title is
 * deliberately NOT drawn here: clients render og:title as a caption under
 * the image, so baking it in would show it twice.
 *
 * Falls back to the site card whenever there is nothing shareable — an
 * unknown id, an owner-private image, an admin-hidden one. The og:image URL
 * always resolves to a valid image; it just stops being this design's.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ imageId: string }>;
}) {
  const { imageId } = await params;
  const card = await getImageShareCard(imageId);
  if (!card) return new ImageResponse(<SiteCard />, { ...size });

  const { backdrop, wordmark } = designCardPalette(card.backgroundColor);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: backdrop,
        }}
      >
        <img
          src={card.imageUrl}
          alt=""
          width={520}
          height={520}
          style={{ objectFit: "contain" }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 36,
            right: 44,
            display: "flex",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: wordmark,
          }}
        >
          PRNTD
        </div>
      </div>
    ),
    { ...size }
  );
}
