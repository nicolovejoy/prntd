import type { AspectRatio } from "./blanks";
import { withTimeout } from "./timeout";

const ENDPOINT = "https://api.ideogram.ai/v1/ideogram-v3/generate-transparent";
const EDIT_ENDPOINT = "https://api.ideogram.ai/v1/edit";
const EDIT_TIMEOUT_MS = 120_000;

// Ideogram uses NxM in its API (e.g. "1x1", "4x5", "9x16"), not the N:M
// our internal AspectRatio type uses. Map between them here.
function toIdeogramAspect(aspect: AspectRatio): string {
  return aspect.replace(":", "x");
}

/**
 * Generate an RGBA PNG via Ideogram's native transparent-background endpoint.
 * Returns the URL of the generated image. Caller is responsible for
 * downloading the bytes immediately — Ideogram URLs expire.
 */
export async function generateTransparent(
  prompt: string,
  aspectRatio: AspectRatio = "1:1",
  options: { seed?: number; negativePrompt?: string } = {}
): Promise<string> {
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) throw new Error("IDEOGRAM_API_KEY missing");

  const fd = new FormData();
  fd.append("prompt", prompt);
  fd.append("aspect_ratio", toIdeogramAspect(aspectRatio));
  fd.append("rendering_speed", "TURBO");
  fd.append("magic_prompt", "OFF");
  if (options.seed !== undefined) fd.append("seed", String(options.seed));
  if (options.negativePrompt) fd.append("negative_prompt", options.negativePrompt);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Api-Key": apiKey },
    body: fd,
  });

  if (!res.ok) {
    throw new Error(`Ideogram ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error(`No URL in Ideogram response: ${JSON.stringify(data)}`);
  return url;
}

/** Rough internal $/image for instructional edits (secondhand pricing —
 *  verify against the first real bill; see the plan doc). */
export const EDIT_COST_PER_IMAGE = 0.2;

/**
 * Instruction-edit an existing image via Ideogram /v1/edit, preserving
 * transparency (`transparent_background: true` — RGBA out, no BiRefNet).
 * The anchor is downloaded and sent as multipart bytes: `image_urls` only
 * accepts Ideogram-hosted URLs, and ours live on R2.
 * Returns the URL of the edited image. Caller downloads the bytes
 * immediately — Ideogram URLs expire.
 */
export async function editTransparent(
  prompt: string,
  anchorImageUrl: string,
  aspectRatio: AspectRatio = "1:1"
): Promise<string> {
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) throw new Error("IDEOGRAM_API_KEY missing");

  const anchorRes = await withTimeout("editAnchorFetch", EDIT_TIMEOUT_MS, () =>
    fetch(anchorImageUrl)
  );
  if (!anchorRes.ok) {
    throw new Error(`Failed to download anchor image: ${anchorRes.status}`);
  }
  const anchorBytes = await anchorRes.arrayBuffer();

  const fd = new FormData();
  fd.append("prompt", prompt);
  fd.append("aspect_ratio", toIdeogramAspect(aspectRatio));
  fd.append("magic_prompt", "OFF");
  fd.append("transparent_background", "true");
  fd.append("images", new Blob([anchorBytes], { type: "image/png" }), "anchor.png");

  const res = await withTimeout("editTransparent", EDIT_TIMEOUT_MS, () =>
    fetch(EDIT_ENDPOINT, {
      method: "POST",
      headers: { "Api-Key": apiKey },
      body: fd,
    })
  );

  if (!res.ok) {
    throw new Error(`Ideogram edit ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error(`No URL in Ideogram edit response: ${JSON.stringify(data)}`);
  return url;
}
