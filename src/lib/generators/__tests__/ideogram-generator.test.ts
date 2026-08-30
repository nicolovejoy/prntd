import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DesignSpec } from "../../design-spec";
import type { AspectRatio } from "../../blanks";
import type { V4JsonPrompt } from "../../ideogram";

const ideogram = vi.hoisted(() => ({
  generateTransparentV4: vi.fn<
    (jsonPrompt: V4JsonPrompt, aspect: AspectRatio) => Promise<string>
  >(async () => "https://out/generate.png"),
  editTransparent: vi.fn<
    (prompt: string, anchorUrl: string, aspect: AspectRatio) => Promise<string>
  >(async () => "https://out/edit.png"),
  EDIT_COST_PER_IMAGE: 0.2,
  GENERATE_COST_PER_IMAGE: 0.03,
}));
vi.mock("../../ideogram", () => ideogram);

import { ideogramGenerator } from "../ideogram-generator";

const spec: DesignSpec = {
  subject: "a grizzly bear holding a thermos",
  style: {
    artStyle: "vintage screenprint",
    medium: "ink on paper",
    colorPalette: ["#1b1b1b", "#c25b32"],
  },
  elements: [
    { type: "obj", desc: "a grizzly bear holding a thermos", colorPalette: ["#6b4423"] },
    { type: "text", text: "STAY WARM", desc: "block letters beneath the bear" },
  ],
};

describe("ideogramGenerator routing", () => {
  beforeEach(() => {
    ideogram.generateTransparentV4.mockClear();
    ideogram.editTransparent.mockClear();
  });

  it("renders a generate op to the v4 json_prompt wire format", async () => {
    const url = await ideogramGenerator.generate(
      { kind: "generate", spec },
      { aspect: "1:1" }
    );
    expect(url).toBe("https://out/generate.png");
    expect(ideogram.editTransparent).not.toHaveBeenCalled();
    expect(ideogram.generateTransparentV4).toHaveBeenCalledTimes(1);

    const [jsonPrompt, aspect] = ideogram.generateTransparentV4.mock.calls[0];
    expect(aspect).toBe("1:1");
    expect(jsonPrompt.high_level_description).toBe(spec.subject);
    expect(jsonPrompt.style_description).toEqual({
      art_style: "vintage screenprint",
      medium: "ink on paper",
      color_palette: ["#1b1b1b", "#c25b32"],
    });
    expect(jsonPrompt.compositional_deconstruction.background).toBe(
      "transparent background"
    );
    expect(jsonPrompt.compositional_deconstruction.elements).toEqual([
      {
        type: "obj",
        desc: "a grizzly bear holding a thermos",
        color_palette: ["#6b4423"],
      },
      { type: "text", text: "STAY WARM", desc: "block letters beneath the bear" },
    ]);
  });

  it("omits style_description when the spec carries no style", async () => {
    await ideogramGenerator.generate(
      {
        kind: "generate",
        spec: { subject: "a cat", elements: [{ type: "obj", desc: "a cat" }] },
      },
      { aspect: "4:5" }
    );
    const [jsonPrompt] = ideogram.generateTransparentV4.mock.calls[0];
    expect(jsonPrompt.style_description).toBeUndefined();
    expect(jsonPrompt.compositional_deconstruction.elements).toEqual([
      { type: "obj", desc: "a cat" },
    ]);
  });

  it("routes an edit op to editTransparent", async () => {
    const url = await ideogramGenerator.generate(
      {
        kind: "edit",
        instruction: "make the bear larger",
        anchorImageUrl: "https://r2/anchor.png",
      },
      { aspect: "4:5" }
    );
    expect(url).toBe("https://out/edit.png");
    expect(ideogram.editTransparent).toHaveBeenCalledWith(
      "make the bear larger",
      "https://r2/anchor.png",
      "4:5"
    );
    expect(ideogram.generateTransparentV4).not.toHaveBeenCalled();
  });

  it("prices generate at 0.03 and edit at 0.2", () => {
    expect(ideogramGenerator.costFor({ kind: "generate", spec })).toBe(0.03);
    expect(
      ideogramGenerator.costFor({
        kind: "edit",
        instruction: "bigger",
        anchorImageUrl: "https://r2/a.png",
      })
    ).toBe(0.2);
  });
});
