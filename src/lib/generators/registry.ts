import type { GeneratorId, ImageGenerator } from "./types";
import { ideogramGenerator } from "./ideogram-generator";

export const DEFAULT_GENERATOR_ID: GeneratorId = "ideogram";

export const GENERATORS: Record<GeneratorId, ImageGenerator> = {
  ideogram: ideogramGenerator,
};

/** Resolve an adapter by id, falling back to the default for null or
 *  unknown ids (historical rows, removed adapters). */
export function getGenerator(id: string | null | undefined): ImageGenerator {
  if (id && id in GENERATORS) return GENERATORS[id as GeneratorId];
  return GENERATORS[DEFAULT_GENERATOR_ID];
}
