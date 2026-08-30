import type { AspectRatio } from "../blanks";
import type { DesignSpec } from "../design-spec";

export type GeneratorId = "ideogram";

/** What the user asked for, typed. A fresh design is a structured spec; a
 *  refinement is an instruction against an existing image. The adapter
 *  renders each to its provider's wire format. */
export type GenerateOperation =
  | { kind: "generate"; spec: DesignSpec }
  | { kind: "edit"; instruction: string; anchorImageUrl: string };

export type GenerateOptions = {
  aspect: AspectRatio;
};

export interface ImageGenerator {
  id: GeneratorId;
  label: string;
  /** Rough internal $/image for accounting (not customer-facing).
   *  Per-operation: an instructional edit costs more than a generation. */
  costFor(op: GenerateOperation): number;
  /** Returns a transparent-PNG URL. Caller downloads bytes immediately. */
  generate(op: GenerateOperation, opts: GenerateOptions): Promise<string>;
}
