import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Source-text check, like no-window-alert.test.ts: the root layout is a
// server component that loads next/font, so we assert on its text instead of
// rendering it.
const raw = readFileSync(join(__dirname, "../layout.tsx"), "utf8");
// Drop JSX comments so a commented-out element cannot satisfy the check.
const layout = raw.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("root layout page-view beacon", () => {
  it("renders <PageViewBeacon /> exactly once", () => {
    expect(layout.match(/<PageViewBeacon\s*\/>/g)).toHaveLength(1);
  });

  it("loads no third-party beacon script and does not import next/script", () => {
    expect(layout).not.toContain("prompt-labs.org/beacon.js");
    expect(layout).not.toMatch(/from\s+["']next\/script["']/);
  });
});
