import { imageKeyFromUrl, getObjectByKey } from "./r2";
import { REFERENCE_IMAGE_MAX_PIXELS } from "./reference-image";

/**
 * How long the photo read may take. The brief call has its own
 * DESIGN_BRIEF_TIMEOUT_MS (45 s) and LOST_SUBMIT_WINDOW_MS (src/lib/lost-submit.ts)
 * is 60 s, so the read has to fit in the margin between them.
 */
export const BRIEF_PHOTO_READ_TIMEOUT_MS = 5_000;

/** Longest side sent to the model. */
const BRIEF_PHOTO_MAX_SIDE = 1568;

export type BriefPhoto = { mediaType: "image/jpeg"; data: string };

/**
 * An uploaded photo as the brief call takes it: a JPEG no larger than 1568 px
 * on a side, base64. Uploads are stored as lossless PNG up to 2048 px, which
 * can pass Anthropic's 5 MB per-image limit, so the stored object is never
 * sent as is. Null on any failure (no key, no object, slow read, undecodable);
 * never throws.
 */
export async function loadBriefPhoto(imageUrl: string): Promise<BriefPhoto | null> {
  try {
    const key = imageKeyFromUrl(imageUrl);
    if (!key) return null;
    const bytes = await getObjectByKey(key, BRIEF_PHOTO_READ_TIMEOUT_MS);
    if (!bytes) return null;
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(bytes, {
      animated: false,
      limitInputPixels: REFERENCE_IMAGE_MAX_PIXELS,
    })
      .resize({
        width: BRIEF_PHOTO_MAX_SIDE,
        height: BRIEF_PHOTO_MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { mediaType: "image/jpeg", data: jpeg.toString("base64") };
  } catch (err) {
    console.error(
      "loadBriefPhoto failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
