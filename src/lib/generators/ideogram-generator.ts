import type { ImageGenerator } from "./types";
import { generateTransparent } from "../ideogram";
import { generateAnchoredTransparent } from "../replicate";

/**
 * Ideogram adapter. Without a reference image, uses Ideogram's native
 * transparent endpoint (single call). With one, routes to the Replicate
 * style-reference path + BiRefNet (the transparent endpoint doesn't accept
 * style refs). Both transparency mechanisms are sealed here.
 */
export const ideogramGenerator: ImageGenerator = {
  id: "ideogram",
  label: "Ideogram",
  costPerImage: 0.03,
  adaptPrompt: (base) => base,
  generate: (prompt, { aspect, referenceImageUrl }) =>
    referenceImageUrl
      ? generateAnchoredTransparent(prompt, referenceImageUrl, aspect)
      : generateTransparent(prompt, aspect),
};
