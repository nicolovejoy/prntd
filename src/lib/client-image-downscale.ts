import {
  REFERENCE_IMAGE_MAX_BYTES,
  REFERENCE_IMAGE_MAX_SIDE,
} from "./reference-image-limits";

const JPEG_QUALITY = 0.9;

/**
 * Shrinks a camera photo on the device before upload (#188 slice 2a): phone
 * JPEGs are often 3 to 8 MB, over the request-body budget. When the file is
 * over REFERENCE_IMAGE_MAX_BYTES or its longest side is over
 * REFERENCE_IMAGE_MAX_SIDE, it is redrawn on a canvas at most that many
 * pixels on the longest side (orientation applied by the decoder) and
 * exported as JPEG at quality 0.9; transparency is flattened onto white.
 * Anything else, and any environment without createImageBitmap or canvas
 * (jsdom, old browsers), or any failure, returns the original file. The
 * caller still applies the byte cap to the result.
 */
export async function downscaleForUpload(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);
    if (file.size <= REFERENCE_IMAGE_MAX_BYTES && longest <= REFERENCE_IMAGE_MAX_SIDE) {
      return file;
    }
    const scale = Math.min(1, REFERENCE_IMAGE_MAX_SIDE / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) return file;
    const base = file.name.replace(/\.[^./]+$/, "") || "image";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}
