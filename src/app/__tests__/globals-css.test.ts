import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// globals.css is authored after `@import "tailwindcss"`, so every rule in it
// is unlayered. Per the CSS cascade-layers spec an unlayered declaration beats
// any declaration inside an `@layer`, Tailwind's `@layer utilities` included,
// whatever the specificity. On 2026-09-06 a `border: ...` on the old
// `.bg-checkerboard` rule here silently overrode every `border-2
// border-accent` selection indicator applied beside it (four call sites).
// Class-presence tests under jsdom cannot see this; they never evaluate the
// cascade. So this file keeps border properties out of every rule except the
// token blocks and `body`, under any selector name.

const ALLOWED_SELECTORS = [":root", "@theme inline", "body"];

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

  it("parses the rules this test is about", () => {
    const selectors = rules.map((r) => r.selector);
    for (const allowed of ALLOWED_SELECTORS) {
      expect(selectors, `expected a ${allowed} rule`).toContain(allowed);
    }
  });

  it("defines no .bg-checkerboard", () => {
    expect(css).not.toContain("bg-checkerboard");
  });

  it("sets no border property outside :root, @theme inline and body", () => {
    const offenders = rules
      .filter((r) => !ALLOWED_SELECTORS.includes(r.selector))
      .filter((r) => /(^|[;{\s])border[\w-]*\s*:/.test(r.body))
      .map((r) => r.selector);
    expect(
      offenders,
      "an unlayered border rule beats Tailwind's layered border utilities",
    ).toEqual([]);
  });
});
