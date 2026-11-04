import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Source-text check, like no-window-alert.test.ts: the root layout is a
// server component that loads next/font, so we assert on its text instead of
// rendering it.
const raw = readFileSync(join(__dirname, "../layout.tsx"), "utf8");
// Drop JSX comments so a commented-out script cannot satisfy the check.
const layout = raw.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("root layout page-view beacon", () => {
  it("renders one Script element with the beacon src, strategy and crossOrigin", () => {
    const re =
      /<Script\b(?=[^>]*\bsrc="https:\/\/prompt-labs\.org\/beacon\.js")(?=[^>]*\bstrategy="afterInteractive")(?=[^>]*\bcrossOrigin="anonymous")[^>]*\/>/g;
    expect(layout.match(re)).toHaveLength(1);
  });
});
