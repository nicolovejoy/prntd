import type { AspectRatio } from "./products";

const ENDPOINT = "https://api.ideogram.ai/v1/ideogram-v3/generate-transparent";

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
