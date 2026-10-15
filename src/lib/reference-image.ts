import { REFERENCE_IMAGE_MAX_BYTES, REFERENCE_IMAGE_MAX_SIDE } from "./reference-image-limits";

export {
  REFERENCE_IMAGE_MAX_BYTES,
  REFERENCE_IMAGE_MAX_SIDE,
  REFERENCE_IMAGE_TOO_LARGE,
  REFERENCE_IMAGE_UNSUPPORTED,
} from "./reference-image-limits";

/** Decoded pixels allowed per input image. */
const REFERENCE_IMAGE_MAX_PIXELS = 40_000_000;
/** sharp's names for the formats the file picker offers, plus gif (first frame). */
const ACCEPTED_FORMATS = ["png", "jpeg", "webp", "gif"];

export type NormalizedReferenceImage =
  | { ok: true; png: Buffer }
  | { ok: false; reason: "too_large" | "unsupported" };

/**
 * Validates and normalizes an uploaded reference image: size cap, decodable,
 * EXIF rotation applied, longest side at most 2048 px, always PNG. The size
 * check runs before any decode.
 */
export async function normalizeReferenceImage(buffer: Buffer): Promise<NormalizedReferenceImage> {
  if (buffer.length > REFERENCE_IMAGE_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (buffer.length === 0) return { ok: false, reason: "unsupported" };
  try {
    // Loaded here, not at module scope, as image-luminance.ts does.
    const { default: sharp } = await import("sharp");
    // limitInputPixels refuses a small file that declares a huge raster
    // (a 1.1 MB 16383x16383 PNG took 1.33 GB of RSS before this); a 12 MP
    // photo is well under it.
    const input = { animated: false, limitInputPixels: REFERENCE_IMAGE_MAX_PIXELS } as const;
    const meta = await sharp(buffer, input).metadata();
    if (!meta.format || !ACCEPTED_FORMATS.includes(meta.format)) {
      return { ok: false, reason: "unsupported" };
    }
    const png = await sharp(buffer, input)
      .rotate()
      .resize(REFERENCE_IMAGE_MAX_SIDE, REFERENCE_IMAGE_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return { ok: true, png };
  } catch {
    return { ok: false, reason: "unsupported" };
  }
}
