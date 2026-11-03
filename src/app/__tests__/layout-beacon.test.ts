import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Source-text check, like no-window-alert.test.ts: the root layout is an
// server component loads next/font, so we assert on its text
// instead of rendering it.
const layout = readFileSync(join(__dirname, "../layout.tsx"), "utf8");

describe("root layout page-view beacon", () => {
  it("loads prompt-lab's beacon after hydration", () => {
    expect(layout).toContain('src="https://prompt-labs.org/beacon.js"');
    expect(layout).toContain('strategy="afterInteractive"');
    expect(layout).toContain('crossOrigin="anonymous"');
  });
});
