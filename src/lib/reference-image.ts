import { REFERENCE_IMAGE_MAX_BYTES, REFERENCE_IMAGE_MAX_SIDE } from "./reference-image-limits";

export {
  REFERENCE_IMAGE_MAX_BYTES,
  REFERENCE_IMAGE_MAX_SIDE,
  REFERENCE_IMAGE_TOO_LARGE,
  REFERENCE_IMAGE_UNSUPPORTED,
} from "./reference-image-limits";

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
    const png = await sharp(buffer, { animated: false })
      .rotate()
      .resize(REFERENCE_IMAGE_MAX_SIDE, REFERENCE_IMAGE_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return { ok: true, png };
  } catch {
    return { ok: false, reason: "unsupported" };
  }
}
