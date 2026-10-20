import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// globals.css is authored after `@import "tailwindcss"`, so every rule in it
// is unlayered. Per the CSS cascade-layers spec an unlayered declaration beats
// any declaration inside an `@layer`, Tailwind's `@layer utilities` included,
// whatever the specificity. On 2026-09-06 a `border: ...` on the old
// `.bg-checkerboard` rule here silently overrode the `border-2 border-accent`
// selection border on five thumbnails. Class-presence tests under jsdom
// cannot see this; they never evaluate the cascade. So this file asserts that
// the only top-level rules are the token blocks and `body`, and that none of
// them declares a border.

const RULES = [":root", "@theme inline", "body"];

const css = readFileSync(join(__dirname, "../globals.css"), "utf-8");

function parseTopLevelRules(source: string) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: { selector: string; body: string }[] = [];
  let depth = 0;
  let prelude = "";
  let body = "";
  for (const ch of text) {
    if (ch === "{") {
      if (depth === 0) body = "";
      else body += ch;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        rules.push({ selector: prelude.trim().replace(/\s+/g, " "), body });
        prelude = "";
      } else {
        body += ch;
      }
    } else if (depth > 0) {
      body += ch;
    } else if (ch === ";") {
      prelude = ""; // an @import or @plugin statement, no block
    } else {
      prelude += ch;
    }
  }
  return rules;
}

describe("globals.css", () => {
  const rules = parseTopLevelRules(css);

  it("finds the three rules this test is about", () => {
    const selectors = rules.map((r) => r.selector);
    for (const expected of RULES) {
      expect(selectors, `expected a ${expected} rule`).toContain(expected);
    }
  });

  it("has no top-level rule besides :root, @theme inline and body", () => {
    const extra = rules.map((r) => r.selector).filter((s) => !RULES.includes(s));
    expect(
      extra,
      "any other rule is unlayered and beats Tailwind's layered utilities",
    ).toEqual([]);
  });

  it("declares no border in :root, @theme inline or body", () => {
    // Custom properties (`--border`, `--color-border`) are tokens, not borders.
    const offenders = rules
      .filter((r) =>
        r.body
          .split(";")
          .map((d) => d.trim())
          .some((d) => /^border[\w-]*\s*:/.test(d)),
      )
      .map((r) => r.selector);
    expect(offenders).toEqual([]);
  });
});
