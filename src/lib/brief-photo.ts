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

/**
 * Pixel area sent to the model, about 1.15 MP. Anthropic downscales larger
 * images to roughly this size before the model sees them, so sending more
 * only adds payload.
 */
export const BRIEF_PHOTO_MAX_PIXELS = 1_150_000;

/**
 * Target size for a decoded width and height: aspect kept, never enlarged,
 * longest side at most BRIEF_PHOTO_MAX_SIDE and area at most
 * BRIEF_PHOTO_MAX_PIXELS. Sides are rounded; when rounding would break
 * either limit they are floored instead, so both limits always hold.
 */
export function briefPhotoSize(
  width: number,
  height: number
): { width: number; height: number } {
  const scale = Math.min(
    1,
    BRIEF_PHOTO_MAX_SIDE / Math.max(width, height),
    Math.sqrt(BRIEF_PHOTO_MAX_PIXELS / (width * height))
  );
  if (scale >= 1) return { width, height };
  const fits = (w: number, h: number) =>
    w * h <= BRIEF_PHOTO_MAX_PIXELS && Math.max(w, h) <= BRIEF_PHOTO_MAX_SIDE;
  const rounded = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
  if (fits(rounded.width, rounded.height)) return rounded;
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export type BriefPhoto = { mediaType: "image/jpeg"; data: string };

/**
 * An uploaded photo as the brief call takes it: a JPEG no larger than 1568 px
 * on a side and about 1.15 MP, base64. Uploads are stored as lossless PNG up to
 * 2048 px, which can pass Anthropic's 5 MB per-image limit, so the stored
 * object is never sent as is. The size comes from the decoded metadata and is
 * never enlarged. Uploads are stored with EXIF orientation already applied and
 * metadata stripped (normalizeReferenceImage), so no rotate step is needed
 * here. Null on any failure (no key, no object, slow read, undecodable);
 * never throws.
 */
export async function loadBriefPhoto(imageUrl: string): Promise<BriefPhoto | null> {
  try {
    const key = imageKeyFromUrl(imageUrl);
    if (!key) {
      console.error("loadBriefPhoto: no R2 key in", imageUrl);
      return null;
    }
    const bytes = await getObjectByKey(key, BRIEF_PHOTO_READ_TIMEOUT_MS);
    if (!bytes) return null;
    const { default: sharp } = await import("sharp");
    const options = {
      animated: false,
      limitInputPixels: REFERENCE_IMAGE_MAX_PIXELS,
    };
    const meta = await sharp(bytes, options).metadata();
    if (!meta.width || !meta.height) {
      console.error("loadBriefPhoto: no dimensions");
      return null;
    }
    const size = briefPhotoSize(meta.width, meta.height);
    const jpeg = await sharp(bytes, options)
      .resize({ ...size, fit: "fill" })
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
