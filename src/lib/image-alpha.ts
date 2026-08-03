/**
 * Does a PNG carry transparency? Reads the IHDR colour type (byte 25) and,
 * for the colour types that CAN'T carry a per-pixel alpha channel, scans for
 * a tRNS chunk — palette (and, rarely, grayscale/RGB) PNGs express
 * transparency that way. Used by the compose flow's DTG knockout warning and
 * the legacy-alpha backfill script; both only need a prefix of the file, so
 * `probeImageAlpha` does a ranged fetch.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** How much of the file to fetch: tRNS sits between IHDR and IDAT, and PLTE
 * (max 768 bytes) is the only sizable chunk that can precede it. */
export const ALPHA_PROBE_BYTES = 8192;

function findMarker(bytes: Uint8Array, marker: string): number {
  const target = [...marker].map((c) => c.charCodeAt(0));
  outer: for (let i = 8; i <= bytes.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * True/false when the prefix is conclusive, null when it isn't (not a PNG,
 * truncated before the verdict, or an unknown colour type). Callers treat
 * null as "unknown" and fail open.
 */
export function pngHasAlpha(bytes: Uint8Array): boolean | null {
  if (bytes.length < 26) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  const colourType = bytes[25];
  if (colourType === 4 || colourType === 6) return true; // gray+alpha / RGBA
  if (colourType !== 0 && colourType !== 2 && colourType !== 3) return null;

  // 0/2/3 have no alpha channel, but a tRNS chunk (which must precede IDAT)
  // still carries transparency. Only conclusive once we can see IDAT.
  const tRNS = findMarker(bytes, "tRNS");
  const idat = findMarker(bytes, "IDAT");
  if (tRNS !== -1 && (idat === -1 || tRNS < idat)) return true;
  if (idat !== -1) return false;
  return null; // prefix ended before IDAT — can't rule tRNS out
}

/**
 * Ranged-fetch the start of an image and report alpha. Null on any fetch or
 * parse problem — the knockout rule is warn-not-block, so unknown must never
 * produce a warning.
 */
export async function probeImageAlpha(url: string): Promise<boolean | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${ALPHA_PROBE_BYTES - 1}` },
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // A server that ignores Range returns the whole file; the prefix logic
    // works either way.
    return pngHasAlpha(buf.length > ALPHA_PROBE_BYTES ? buf.slice(0, ALPHA_PROBE_BYTES) : buf);
  } catch {
    return null;
  }
}
