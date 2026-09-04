import { describe, it, expect } from "vitest";
import {
  buildNamingContext,
  imageContextLabel,
  imageGalleryLine,
  imageHistoryNote,
  specAncestry,
  PROVENANCE_MAX_DEPTH,
  type ProvenanceNode,
} from "../image-provenance";
import type { DesignSpec } from "../design-spec";

const spec: DesignSpec = {
  subject: "A bear riding a unicycle",
  style: { artStyle: "woodcut illustration" },
  elements: [{ type: "obj", desc: "bear" }],
};

function node(over: Partial<ProvenanceNode> & { id: string }): ProvenanceNode {
  return {
    operation: null,
    designSpec: null,
    prompt: null,
    parentImageId: null,
    ...over,
  };
}

function index(nodes: ProvenanceNode[]): Map<string, ProvenanceNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

describe("buildNamingContext", () => {
  it("sends the spec summary for a generate", () => {
    const g = node({
      id: "a",
      operation: "generate",
      designSpec: spec,
      prompt: "A bear riding a unicycle — woodcut illustration",
    });
    expect(buildNamingContext("a", index([g]))).toBe(
      "Prompt used to generate this image:\nA bear riding a unicycle — woodcut illustration"
    );
  });

  it("sends original + instruction for a single edit", () => {
    const g = node({ id: "a", operation: "generate", designSpec: spec });
    const e = node({
      id: "b",
      operation: "edit",
      prompt: "make the bear larger",
      parentImageId: "a",
    });
    expect(buildNamingContext("b", index([g, e]))).toBe(
      "Original design: A bear riding a unicycle — woodcut illustration. " +
        "Later edits applied: make the bear larger"
    );
  });

  it("lists a chain of edits oldest first, including this image's", () => {
    const g = node({ id: "a", operation: "generate", designSpec: spec });
    const e1 = node({
      id: "b",
      operation: "edit",
      prompt: "make the bear larger",
      parentImageId: "a",
    });
    const e2 = node({
      id: "c",
      operation: "edit",
      prompt: "remove the lettering",
      parentImageId: "b",
    });
    expect(buildNamingContext("c", index([g, e1, e2]))).toContain(
      "Later edits applied: make the bear larger; remove the lettering"
    );
  });

  it("falls back to the edit's own prompt when the ancestor is missing", () => {
    const orphan = node({
      id: "b",
      operation: "edit",
      prompt: "make the bear larger",
      parentImageId: "gone",
    });
    expect(buildNamingContext("b", index([orphan]))).toBe(
      "Prompt used to generate this image:\nmake the bear larger"
    );
  });

  it("stops at the depth cap and degrades rather than walking forever", () => {
    const chain: ProvenanceNode[] = [
      node({ id: "root", operation: "generate", designSpec: spec }),
    ];
    // One more edit than the cap can reach back through.
    for (let i = 0; i < PROVENANCE_MAX_DEPTH; i++) {
      chain.push(
        node({
          id: `e${i}`,
          operation: "edit",
          prompt: `edit ${i}`,
          parentImageId: i === 0 ? "root" : `e${i - 1}`,
        })
      );
    }
    const last = chain[chain.length - 1];
    expect(buildNamingContext(last.id, index(chain))).toBe(
      `Prompt used to generate this image:\n${last.prompt}`
    );
    expect(specAncestry(last.id, index(chain))).toHaveLength(
      PROVENANCE_MAX_DEPTH
    );
  });

  it("survives a parent cycle", () => {
    const a = node({ id: "a", operation: "edit", prompt: "one", parentImageId: "b" });
    const b = node({ id: "b", operation: "edit", prompt: "two", parentImageId: "a" });
    expect(buildNamingContext("a", index([a, b]))).toBe(
      "Prompt used to generate this image:\none"
    );
  });

  it("keeps today's behaviour for a legacy row and an upload", () => {
    const legacy = node({ id: "a", prompt: "an old prompt" });
    const upload = node({
      id: "b",
      operation: "upload",
      prompt: "[user upload] logo.png",
    });
    expect(buildNamingContext("a", index([legacy]))).toBe(
      "Prompt used to generate this image:\nan old prompt"
    );
    expect(buildNamingContext("b", index([upload]))).toBe(
      "Prompt used to generate this image:\n[user upload] logo.png"
    );
  });

  it("returns null for an unknown image and for one with nothing to say", () => {
    expect(buildNamingContext("nope", index([]))).toBeNull();
    expect(buildNamingContext("a", index([node({ id: "a" })]))).toBeNull();
  });
});

describe("imageContextLabel / gallery / history", () => {
  it("labels each operation", () => {
    expect(
      imageContextLabel(
        node({ id: "a", operation: "generate", designSpec: spec })
      )
    ).toBe("Generated from: A bear riding a unicycle — woodcut illustration");
    expect(
      imageContextLabel(
        node({ id: "b", operation: "edit", prompt: "make the bear larger" })
      )
    ).toBe("Edit applied: make the bear larger");
    expect(
      imageContextLabel(
        node({ id: "c", operation: "upload", prompt: "[user upload] logo.png" })
      )
    ).toBe("Uploaded: [user upload] logo.png");
  });

  it("falls back to the stored prompt for a generate with no spec", () => {
    expect(
      imageContextLabel(
        node({ id: "a", operation: "generate", prompt: "a bear" })
      )
    ).toBe("Generated from: a bear");
  });

  it("leaves a legacy row's wording alone", () => {
    const legacy = node({ id: "a", prompt: "an old prompt" });
    expect(imageContextLabel(legacy)).toBe("an old prompt");
    expect(imageGalleryLine(legacy, 2)).toBe('#2: "an old prompt"');
    expect(imageHistoryNote(legacy)).toBe("Prompt used: an old prompt");
  });

  it("labels gallery lines and history notes for known operations", () => {
    const edit = node({
      id: "b",
      operation: "edit",
      prompt: "make the bear larger",
    });
    expect(imageGalleryLine(edit, 3)).toBe("#3: Edit applied: make the bear larger");
    expect(imageHistoryNote(edit)).toBe("Edit applied: make the bear larger");
  });

  it("has no history note when there is nothing recorded", () => {
    expect(imageHistoryNote(node({ id: "a" }))).toBeNull();
  });
});
