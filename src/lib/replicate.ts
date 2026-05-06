import Replicate from "replicate";
import type { AspectRatio } from "./products";

const replicate = new Replicate();

export async function generateImage(
  prompt: string,
  referenceImageUrl?: string,
  negativePrompt?: string | null,
  aspectRatio: AspectRatio = "1:1"
): Promise<string> {
  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: aspectRatio,
    magic_prompt_option: "Off",
  };

  if (referenceImageUrl) {
    input.style_reference_images = [referenceImageUrl];
  }

  if (negativePrompt) {
    input.negative_prompt = negativePrompt;
  }

  const output = await replicate.run("ideogram-ai/ideogram-v3-turbo", {
    input,
  });

  return String(output);
}

/**
 * Generate a transparent PNG anchored visually on a style reference image.
 *
 * Routes through Replicate's regular Ideogram v3 Turbo (not the direct
 * generate-transparent endpoint, which doesn't accept style refs per
 * developer.ideogram.ai/openapi.json), then runs BiRefNet for transparency.
 * Two API calls instead of one — the cost we pay for visual continuity
 * across aspect ratios and chat iterations.
 *
 * Use this when you have an anchor image (chat iteration: prior image;
 * placement adaptation: the user's primary pick). Use the direct
 * `generateTransparent` from ideogram.ts when there is no anchor.
 */
export async function generateAnchoredTransparent(
  prompt: string,
  styleReferenceUrl: string,
  aspectRatio: AspectRatio = "1:1",
  negativePrompt?: string | null
): Promise<string> {
  const rgbUrl = await generateImage(prompt, styleReferenceUrl, negativePrompt, aspectRatio);
  return await removeBackground(rgbUrl);
}

export async function removeBackground(imageUrl: string): Promise<string> {
  // 851-labs/background-remover (BiRefNet): handles soft / painterly edges
  // much better than Bria, which silently returned the un-removed image on
  // Ideogram's hand-painted output.
  const run = () =>
    replicate.run("851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc", {
      input: {
        image: imageUrl,
        format: "png",
        background_type: "rgba",
        // Hard segmentation: every pixel is fully foreground or fully
        // background. With soft alpha (threshold: 0) thin dark text was
        // coming through semi-transparent against colored shirts.
        threshold: 0.5,
      },
    });

  try {
    return String(await run());
  } catch (err) {
    // Retry once on 429 (Replicate throttles to 6/min when account credit is
    // low). The error from replicate-js exposes the response on `.response`.
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status !== 429) throw err;
    const retryAfterRaw = (err as { response?: { headers?: Headers } })?.response?.headers?.get?.("retry-after");
    const waitMs = Math.min(15000, Math.max(1000, (Number(retryAfterRaw) || 5) * 1000 + 500));
    console.warn(`removeBackground: 429 from Replicate, retrying after ${waitMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return String(await run());
  }
}
