// Pure constants, importable from client components. Kept apart from
// reference-image.ts so a client bundle never sees its sharp import.

/**
 * Vercel Functions cap a request body at 4.5 MB whatever
 * `serverActions.bodySizeLimit` says, and base64 adds a third: 3 MB raw is
 * about 4 MB on the wire.
 */
export const REFERENCE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const REFERENCE_IMAGE_MAX_SIDE = 2048;

/** What the browser file picker is told to offer, and what the device check accepts. */
export const REFERENCE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Refusal reasons `normalizeReferenceImage` and `storeReferenceImage` return; the Studio action maps them to copy. */
export const REFERENCE_IMAGE_TOO_LARGE = "too_large";
export const REFERENCE_IMAGE_UNSUPPORTED = "unsupported";
