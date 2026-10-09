/**
 * The light/dark signal behind the back-source picker's sort and the dark
 * well under unpublished artwork (#139): the mean WCAG relative luminance of
 * an image's opaque pixels, 0 (black) to 1 (white). Computed once per image
 * by the generation continuation and the upload action (src/app/design/
 * actions.ts) before the R2 upload, and by scripts/backfill-image-luminance.ts
 * for rows older than the column.
 *
 * Opaque means alpha > 128. The image is downscaled to fit 256×256 first: a
 * mean does not need more, and it keeps the decode cheap inside `after()`.
 * Anti-aliased edge pixels count at their own colour, a mild bias toward the
 * outline's colour (accepted in the #139 spike).
 */
import sharp from "sharp";

export const ALPHA_OPAQUE_MIN = 128;
export const LUMINANCE_ANALYSIS_SIZE = 256;

// sRGB byte → linear light, the WCAG transfer; the same curve as
// relativeLuminance in blanks.ts, tabulated once for the pixel loop.
const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * `null` when the bytes do not decode, or when no pixel is opaque — callers
 * store it as NULL and never fail on it.
 */
export async function meanLuminance(png: Buffer | Uint8Array): Promise<number | null> {
  let data: Buffer;
  let channels: number;
  try {
    const out = await sharp(png)
      .ensureAlpha()
      .resize(LUMINANCE_ANALYSIS_SIZE, LUMINANCE_ANALYSIS_SIZE, { fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = out.data;
    channels = out.info.channels;
  } catch {
    return null;
  }
  if (channels < 4) return null;
  const pixels = data.length / channels;
  let opaque = 0;
  let sum = 0;
  for (let p = 0; p < pixels; p++) {
    const o = p * channels;
    if (data[o + 3] <= ALPHA_OPAQUE_MIN) continue;
    opaque++;
    sum += 0.2126 * LINEAR[data[o]] + 0.7152 * LINEAR[data[o + 1]] + 0.0722 * LINEAR[data[o + 2]];
  }
  if (opaque === 0) return null;
  return sum / opaque;
}
