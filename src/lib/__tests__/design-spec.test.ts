import { describe, it, expect } from "vitest";
import { parseDesignSpec, renderSpecSummary, fallbackSpec } from "../design-spec";

const VALID = {
  subject: "A bear reading a book under a pine tree",
  style: { artStyle: "woodcut illustration", colorPalette: ["#1A2B3C"] },
  elements: [
    { type: "obj", desc: "a bear seated with an open book" },
    { type: "text", text: "READ MORE", desc: "curved hand-carved lettering below" },
  ],
};

describe("parseDesignSpec", () => {
  it("accepts a valid spec and preserves fields", () => {
    const spec = parseDesignSpec(VALID);
    expect(spec).not.toBeNull();
    expect(spec!.subject).toBe(VALID.subject);
    expect(spec!.elements).toHaveLength(2);
    expect(spec!.style?.artStyle).toBe("woodcut illustration");
  });

  it("rejects a missing or empty subject (#137 made unrepresentable)", () => {
    expect(parseDesignSpec({ ...VALID, subject: "" })).toBeNull();
    expect(parseDesignSpec({ ...VALID, subject: "   " })).toBeNull();
    const { subject: _subject, ...noSubject } = VALID;
    expect(parseDesignSpec(noSubject)).toBeNull();
  });

  it("rejects empty or missing elements", () => {
    expect(parseDesignSpec({ ...VALID, elements: [] })).toBeNull();
    const { elements: _elements, ...noElements } = VALID;
    expect(parseDesignSpec(noElements)).toBeNull();
  });

  it("rejects an obj element without desc and a text element without text", () => {
    expect(parseDesignSpec({ ...VALID, elements: [{ type: "obj", desc: "" }] })).toBeNull();
    expect(parseDesignSpec({ ...VALID, elements: [{ type: "text", text: "" }] })).toBeNull();
    expect(parseDesignSpec({ ...VALID, elements: [{ type: "wat", desc: "x" }] })).toBeNull();
  });

  it("drops malformed palette entries but keeps valid hexes", () => {
    const spec = parseDesignSpec({
      ...VALID,
      style: { colorPalette: ["#FFD700", "gold", "#12345", "#a1B2c3"] },
    });
    expect(spec!.style?.colorPalette).toEqual(["#FFD700", "#a1B2c3"]);
  });

  it("returns null for non-objects", () => {
    expect(parseDesignSpec(null)).toBeNull();
    expect(parseDesignSpec("a bear")).toBeNull();
    expect(parseDesignSpec(42)).toBeNull();
  });

  it("tolerates a missing style block", () => {
    const { style: _style, ...noStyle } = VALID;
    const spec = parseDesignSpec(noStyle);
    expect(spec).not.toBeNull();
    expect(spec!.style).toBeUndefined();
  });
});

describe("renderSpecSummary", () => {
  it("joins subject, style notes, and literal text", () => {
    const spec = parseDesignSpec(VALID)!;
    const summary = renderSpecSummary(spec);
    expect(summary).toContain("A bear reading a book under a pine tree");
    expect(summary).toContain("woodcut illustration");
    expect(summary).toContain('"READ MORE"');
  });

  it("is just the subject when there is nothing else", () => {
    const spec = parseDesignSpec({
      subject: "A mountain",
      elements: [{ type: "obj", desc: "a mountain" }],
    })!;
    expect(renderSpecSummary(spec)).toBe("A mountain");
  });
});

describe("fallbackSpec", () => {
  it("renders the user's own words as a valid spec", () => {
    const spec = fallbackSpec("dog doing calisthenics");
    expect(spec).toEqual({
      subject: "dog doing calisthenics",
      elements: [{ type: "obj", desc: "dog doing calisthenics" }],
    });
    // Round-trips through the validator — the generator sees a real spec.
    expect(parseDesignSpec(spec)).toEqual(spec);
  });

  it("trims surrounding whitespace", () => {
    expect(fallbackSpec("  a fox  ")?.subject).toBe("a fox");
  });

  it("caps a pasted essay so the subject stays a subject", () => {
    const spec = fallbackSpec("x".repeat(1000));
    expect(spec?.subject).toHaveLength(400);
  });

  it("returns null only when there is nothing to render", () => {
    expect(fallbackSpec("")).toBeNull();
    expect(fallbackSpec("   ")).toBeNull();
    expect(fallbackSpec(null)).toBeNull();
    expect(fallbackSpec(undefined)).toBeNull();
  });
});
