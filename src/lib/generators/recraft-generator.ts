import type { ImageGenerator } from "./types";
import { generateRecraftTransparent } from "../replicate";

/**
 * Recraft adapter — digital_illustration output via Replicate, background
 * removed. A second generator for style variety in Compare. v1 ignores
 * referenceImageUrl (no style-ref continuity yet); refinements regenerate
 * from the prompt.
 */
export const recraftGenerator: ImageGenerator = {
  id: "recraft",
  label: "Recraft",
  costPerImage: 0.08,
  adaptPrompt: (base) => base,
  generate: (prompt, { aspect }) => generateRecraftTransparent(prompt, aspect),
};
