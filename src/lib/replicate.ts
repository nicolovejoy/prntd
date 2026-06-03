import Replicate from "replicate";
import type { AspectRatio } from "./products";

const replicate = new Replicate();

// Ideogram v3 Turbo and BiRefNet both finish well inside a minute in
// practice. `replicate.run` polls until the prediction settles, so a
// prediction stuck in "starting" (model boot hang, capacity stall) never
// resolves OR rejects — the caller hangs forever and the /preview spinner
// spins with no error surfaced (issue #15). This ceiling converts that
// silent hang into a rejection the UI can show.
const REPLICATE_RUN_TIMEOUT_MS = 120_000;

/**
 * Reject if `run` hasn't settled within `ms`. Note: this does not cancel
 * the underlying Replicate prediction (Promise.race can't), it just stops
 * the caller from waiting indefinitely so an error state can render.
 */
async function withTimeout<T>(
  label: string,
  ms: number,
  run: () => Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run a Replicate call with one retry on 429 (Replicate throttles to
 * 6/min when account credit is low; bursts can also produce transient
 * 429s). Honors `Retry-After` on the response, falling back to a 5s
 * default. Other errors bubble up unchanged.
 */
async function withReplicate429Retry<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status !== 429) throw err;
    const retryAfterRaw = (err as { response?: { headers?: Headers } })?.response?.headers?.get?.("retry-after");
    const waitMs = Math.min(15000, Math.max(1000, (Number(retryAfterRaw) || 5) * 1000 + 500));
    console.warn(`${label}: 429 from Replicate, retrying after ${waitMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return await run();
  }
}

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

  return withReplicate429Retry("generateImage", async () => {
    const output = await withTimeout("generateImage", REPLICATE_RUN_TIMEOUT_MS, () =>
      replicate.run("ideogram-ai/ideogram-v3-turbo", { input })
    );
    return String(output);
  });
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
  return withReplicate429Retry("removeBackground", async () => {
    const output = await withTimeout(
      "removeBackground",
      REPLICATE_RUN_TIMEOUT_MS,
      () =>
        replicate.run(
          "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
          {
            input: {
              image: imageUrl,
              format: "png",
              background_type: "rgba",
              // Hard segmentation: every pixel is fully foreground or fully
              // background. With soft alpha (threshold: 0) thin dark text was
              // coming through semi-transparent against colored shirts.
              threshold: 0.5,
            },
          }
        )
    );
    return String(output);
  });
}

// recraft-v3 takes a WxH size string. 1:1 is the only aspect chat
// generations use today; the others map to the nearest supported size.
function toRecraftSize(aspect: AspectRatio): string {
  switch (aspect) {
    case "4:5":
      return "1024x1280";
    case "1:2":
      return "1024x2048";
    default:
      return "1024x1024";
  }
}

/**
 * Generate via Recraft v3 on Replicate (official model — warm, stable,
 * reuses REPLICATE_API_TOKEN). vector_illustration style for clean
 * line/graphic art. Recraft has no native transparent output, so BiRefNet
 * drops the background afterward.
 *
 * NOTE: BiRefNet is subject matting — interior white can stay opaque (the
 * open white-fill risk). If a line-drawing case shows opaque interior
 * white and it matters, swap removeBackground for a luminance knockout
 * here (sealed; no change elsewhere).
 */
export async function generateRecraftTransparent(
  prompt: string,
  aspect: AspectRatio = "1:1"
): Promise<string> {
  const rgbUrl = await withReplicate429Retry("generateRecraftTransparent", async () => {
    const output = await withTimeout("generateRecraftTransparent", REPLICATE_RUN_TIMEOUT_MS, () =>
      replicate.run("recraft-ai/recraft-v3", {
        input: {
          prompt,
          style: "vector_illustration",
          size: toRecraftSize(aspect),
        },
      })
    );
    return String(output);
  });
  return await removeBackground(rgbUrl);
}
