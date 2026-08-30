import Replicate from "replicate";
import { withTimeout } from "./timeout";

// This module exists only for BiRefNet background removal, used by ops
// scripts (`scripts/check-bg-removal.ts`, `scripts/backfill-legacy-alpha.ts`).
// The image-generation path no longer touches Replicate — chat generations
// and placement re-renders go through Ideogram's /v1/edit and
// generate-transparent endpoints (`src/lib/ideogram.ts`), which preserve
// alpha natively and don't need a separate knockout pass.
const replicate = new Replicate();

// Ideogram v3 Turbo and BiRefNet both finish well inside a minute in
// practice. `replicate.run` polls until the prediction settles, so a
// prediction stuck in "starting" (model boot hang, capacity stall) never
// resolves OR rejects — the caller hangs forever and the /preview spinner
// spins with no error surfaced (issue #15). This ceiling converts that
// silent hang into a rejection the UI can show.
const REPLICATE_RUN_TIMEOUT_MS = 120_000;

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
