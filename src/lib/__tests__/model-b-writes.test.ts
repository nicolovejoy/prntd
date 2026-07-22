/**
 * Immutability guardrail (docs/model-b-migration-plan.md §3): a published
 * listing points at an `image` row nothing mutates, so publishing is a snapshot
 * by construction. The image write layer (model-b-writes.ts) must expose no
 * helper that updates an image's imageUrl / r2Key / prompt after insert. This
 * test fails if such a path is ever added — the enforcement the doc asks for.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as writes from "@/lib/model-b-writes";
import { r2KeyFromUrl } from "@/lib/model-b-writes";

const source = readFileSync(
  fileURLToPath(new URL("../model-b-writes.ts", import.meta.url)),
  "utf8"
);

describe("image write layer immutability", () => {
  it("exposes no update against the image table", () => {
    // Any UPDATE on the image table would be an escape hatch around the
    // snapshot guarantee. The module writes image rows via INSERT only.
    expect(source).not.toMatch(/\.update\(\s*imageTable\b/);
    expect(source).not.toMatch(/update\(image\b/);
  });

  it("only builds image rows, never mutates the immutable fields", () => {
    // No exported helper name suggests mutating an artifact's content.
    const names = Object.keys(writes);
    for (const n of names) {
      expect(n).not.toMatch(/updateImage|setImageUrl|setR2Key|setPrompt/i);
    }
  });

  it("r2KeyFromUrl parses the object key from a public URL", () => {
    expect(r2KeyFromUrl("https://pub-x.r2.dev/designs/d/1.png")).toBe(
      "designs/d/1.png"
    );
    expect(r2KeyFromUrl("not a url")).toBeNull();
  });
});
