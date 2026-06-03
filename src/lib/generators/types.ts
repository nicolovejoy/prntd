import type { AspectRatio } from "../products";

export type GeneratorId = "ideogram" | "recraft";

export type GenerateOptions = {
  aspect: AspectRatio;
  /** Optional continuity anchor for refinements. Adapters that can't
   *  use a style reference ignore it. */
  referenceImageUrl?: string;
};

export interface ImageGenerator {
  id: GeneratorId;
  label: string;
  /** Rough internal $/image for accounting (not customer-facing). */
  costPerImage: number;
  /** v1: identity. Later: per-model prompt shaping, sealed in the adapter. */
  adaptPrompt(base: string): string;
  /** Returns a transparent-PNG URL. Caller downloads bytes immediately. */
  generate(prompt: string, opts: GenerateOptions): Promise<string>;
}
