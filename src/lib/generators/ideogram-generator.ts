import type { ImageGenerator } from "./types";
import {
  generateTransparent,
  editTransparent,
  EDIT_COST_PER_IMAGE,
} from "../ideogram";

const GENERATE_COST_PER_IMAGE = 0.03;

/**
 * Ideogram adapter. Without a reference image, uses Ideogram's native
 * transparent generate endpoint. With one, this is an iteration: it routes
 * to /v1/edit (instruction edit, native RGBA out) — replacing the old
 * Replicate style-reference + BiRefNet detour that emitted RGB (#153) and
 * re-expressed every refinement as a whole new scene. /v1/edit has no
 * negative-prompt parameter, so negativePrompt applies to generates only.
 */
export const ideogramGenerator: ImageGenerator = {
  id: "ideogram",
  label: "Ideogram",
  costFor: (opts) =>
    opts.referenceImageUrl ? EDIT_COST_PER_IMAGE : GENERATE_COST_PER_IMAGE,
  adaptPrompt: (base) => base,
  generate: (prompt, { aspect, referenceImageUrl, negativePrompt }) =>
    referenceImageUrl
      ? editTransparent(prompt, referenceImageUrl, aspect)
      : generateTransparent(prompt, aspect, {
          negativePrompt: negativePrompt ?? undefined,
        }),
};
