import { describe, it, expect } from "vitest";
import {
  isGenerateIntent,
  isClarificationOnly,
  isSubjectlessPrompt,
} from "../design-prompt";

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

describe("isSubjectlessPrompt", () => {
  it("catches the boilerplate that rendered a flower", () => {
    expect(
      isSubjectlessPrompt("graphic design illustration, high quality, printable")
    ).toBe(true);
  });

  it("passes a prompt with a real subject", () => {
    expect(
      isSubjectlessPrompt("a chalkboard with cursive lettering, high quality")
    ).toBe(false);
  });

  it("passes a subject even when every other clause is boilerplate", () => {
    expect(
      isSubjectlessPrompt("sunset, illustration, high quality, printable")
    ).toBe(false);
  });
});

describe("isClarificationOnly", () => {
  it("treats empty and blank prompts as clarification", () => {
    expect(isClarificationOnly("")).toBe(true);
    expect(isClarificationOnly("   ")).toBe(true);
    expect(isClarificationOnly(null)).toBe(true);
    expect(isClarificationOnly(undefined)).toBe(true);
  });

  it("treats subjectless boilerplate as clarification", () => {
    expect(
      isClarificationOnly("graphic design illustration, high quality, printable")
    ).toBe(true);
  });

  it("lets a real prompt through", () => {
    expect(isClarificationOnly("sunset illustration, white background")).toBe(
      false
    );
  });
});
