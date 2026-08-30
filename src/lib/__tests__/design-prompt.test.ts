import { describe, it, expect } from "vitest";
import { isGenerateIntent, latestUserText } from "../design-prompt";

// The prod turn that rendered an unwanted flower (design bbdaca91, 2026-07-30).
const REPRO_MESSAGE =
  "make it again, but with a different metaphor than a chalk board. same words, same concept. name 5 good metaphors";

describe("isGenerateIntent", () => {
  it("does not fire on the #137 repro turn", () => {
    expect(isGenerateIntent(REPRO_MESSAGE)).toBe(false);
  });

  it("still fires on short confirmations", () => {
    for (const msg of ["yes", "do it", "go", "generate", "draw it", "sure"]) {
      expect(isGenerateIntent(msg)).toBe(true);
    }
  });

  it("fires on a short refinement that starts with a trigger", () => {
    expect(isGenerateIntent("make it bolder in red")).toBe(true);
  });

  it("treats a question as chat even when short and trigger-prefixed", () => {
    expect(isGenerateIntent("make it what?")).toBe(false);
  });

  it("treats a long turn as chat even without a question mark", () => {
    expect(
      isGenerateIntent(
        "go ahead and tell me which of these five directions reads best on a dark shirt"
      )
    ).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(isGenerateIntent("  do it  ")).toBe(true);
  });

  it("does not fire on unrelated text", () => {
    expect(isGenerateIntent("a sunset over mountains")).toBe(false);
  });
});

describe("latestUserText", () => {
  const thread = [
    { role: "user", content: "a dog on a skateboard" },
    { role: "assistant", content: "What style?" },
  ];

  it("returns the most recent user turn", () => {
    expect(latestUserText(thread)).toBe("a dog on a skateboard");
  });

  it("ignores assistant turns, however recent", () => {
    expect(
      latestUserText([...thread, { role: "assistant", content: "Still here?" }])
    ).toBe("a dog on a skateboard");
  });

  it("skips back over an empty user turn", () => {
    expect(latestUserText([...thread, { role: "user", content: "   " }])).toBe(
      "a dog on a skateboard"
    );
  });

  it("is null when the user has never said anything", () => {
    expect(latestUserText([])).toBeNull();
    expect(latestUserText([{ role: "assistant", content: "hi" }])).toBeNull();
  });
});
