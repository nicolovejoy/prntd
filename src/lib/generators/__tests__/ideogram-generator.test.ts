import { describe, it, expect, vi, beforeEach } from "vitest";

const ideogram = vi.hoisted(() => ({
  generateTransparent: vi.fn(async () => "https://out/generate.png"),
  editTransparent: vi.fn(async () => "https://out/edit.png"),
  EDIT_COST_PER_IMAGE: 0.2,
}));
vi.mock("../../ideogram", () => ideogram);

import { ideogramGenerator } from "../ideogram-generator";

describe("ideogramGenerator routing", () => {
  beforeEach(() => {
    ideogram.generateTransparent.mockClear();
    ideogram.editTransparent.mockClear();
  });

  it("routes un-anchored generations to generateTransparent with negative prompt", async () => {
    const url = await ideogramGenerator.generate("a bear", {
      aspect: "1:1",
      negativePrompt: "smooth gradients",
    });
    expect(url).toBe("https://out/generate.png");
    expect(ideogram.generateTransparent).toHaveBeenCalledWith("a bear", "1:1", {
      negativePrompt: "smooth gradients",
    });
    expect(ideogram.editTransparent).not.toHaveBeenCalled();
  });

  it("routes anchored generations to editTransparent (negative prompt has no edit param)", async () => {
    const url = await ideogramGenerator.generate("make the bear larger", {
      aspect: "4:5",
      referenceImageUrl: "https://r2/anchor.png",
      negativePrompt: "ignored on edits",
    });
    expect(url).toBe("https://out/edit.png");
    expect(ideogram.editTransparent).toHaveBeenCalledWith(
      "make the bear larger",
      "https://r2/anchor.png",
      "4:5"
    );
    expect(ideogram.generateTransparent).not.toHaveBeenCalled();
  });

  it("prices generate at 0.03 and edit at 0.2", () => {
    expect(ideogramGenerator.costFor({ aspect: "1:1" })).toBe(0.03);
    expect(
      ideogramGenerator.costFor({ aspect: "1:1", referenceImageUrl: "https://r2/a.png" })
    ).toBe(0.2);
  });
});
