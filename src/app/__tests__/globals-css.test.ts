import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Guard against a regression that shipped and was caught in the #188 Paper
// slice-1 whole-branch review: globals.css is authored AFTER
// `@import "tailwindcss"`, so every rule in this file lives in an
// unlayered position. Per the CSS cascade-layers spec, an unlayered
// declaration beats any declaration in a `@layer` — including Tailwind's
// `@layer utilities` — regardless of specificity or source order. A
// `border: ...` on `.bg-checkerboard` here silently overrode every
// `border-2 border-accent` / `border-border-hover` selection-indicator
// utility applied alongside this class (five sites: preview back-picker,
// /d back-picker, conversation-images aria-current thumb, design-stage
// strip, studio isPrimary tile) — jsdom-based class-presence tests cannot
// see this because they don't evaluate the cascade, only the built CSS
// does. Do not re-add a border to this rule; call sites that want an edge
// on a plain (non-selectable) well add `border border-border` themselves.
describe("globals.css .bg-checkerboard", () => {
  const css = readFileSync(
    join(__dirname, "../globals.css"),
    "utf-8",
  );

  function extractRule(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `expected to find rule ${selector} in globals.css`).toBeGreaterThan(-1);
    const end = css.indexOf("}", start);
    return css.slice(start, end);
  }

  it("sets no border property (would win over layered utility borders)", () => {
    const rule = extractRule(".bg-checkerboard");
    expect(rule).not.toMatch(/\bborder\b/);
    expect(rule).not.toMatch(/\bborder-/);
  });

  it("still fills the well with the surface-well token", () => {
    const rule = extractRule(".bg-checkerboard");
    expect(rule).toContain("background-color: var(--surface-well)");
  });
});
