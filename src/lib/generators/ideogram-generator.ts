import type { ImageGenerator } from "./types";
import type { DesignSpec } from "../design-spec";
import {
  generateTransparentV4,
  editTransparent,
  EDIT_COST_PER_IMAGE,
  GENERATE_COST_PER_IMAGE,
  type V4JsonPrompt,
} from "../ideogram";

/**
 * Render a provider-neutral DesignSpec into Ideogram 4.0's json_prompt wire
 * format (camelCase → snake_case). `background` is required by the schema;
 * the transparent endpoint replaces it server-side, so we state the intent.
 */
function toV4JsonPrompt(spec: DesignSpec): V4JsonPrompt {
  const style: NonNullable<V4JsonPrompt["style_description"]> = {};
  if (spec.style?.aesthetics) style.aesthetics = spec.style.aesthetics;
  if (spec.style?.artStyle) style.art_style = spec.style.artStyle;
  if (spec.style?.medium) style.medium = spec.style.medium;
  if (spec.style?.lighting) style.lighting = spec.style.lighting;
  if (spec.style?.colorPalette) style.color_palette = spec.style.colorPalette;

  return {
    high_level_description: spec.subject,
    ...(Object.keys(style).length > 0 ? { style_description: style } : {}),
    compositional_deconstruction: {
      background: "transparent background",
      elements: spec.elements.map((el) =>
        el.type === "obj"
          ? {
              type: "obj" as const,
              desc: el.desc,
              ...(el.colorPalette ? { color_palette: el.colorPalette } : {}),
            }
          : {
              type: "text" as const,
              text: el.text,
              ...(el.desc ? { desc: el.desc } : {}),
              ...(el.colorPalette ? { color_palette: el.colorPalette } : {}),
            }
      ),
    },
  };
}

/**
 * Ideogram adapter. A generate op renders the spec to v4's structured
 * json_prompt on the native transparent endpoint; an edit op is an
 * instruction against an anchor image via /v1/edit (native RGBA out).
 */
export const ideogramGenerator: ImageGenerator = {
  id: "ideogram",
  label: "Ideogram",
  costFor: (op) =>
    op.kind === "edit" ? EDIT_COST_PER_IMAGE : GENERATE_COST_PER_IMAGE,
  generate: (op, { aspect }) =>
    op.kind === "edit"
      ? editTransparent(op.instruction, op.anchorImageUrl, aspect)
      : generateTransparentV4(toV4JsonPrompt(op.spec), aspect),
};
