import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

// The alert sweep (this branch) replaced every browser alert() with an
// in-page surface: NoticeSheet for a control on an overlay with no stable
// inline slot, InlineNotice for one that stays on screen. A native alert is
// unstyleable, blocks the main thread, is invisible to our component tests,
// and on iOS Safari reads as a browser-chrome interruption rather than part
// of the product — the same reasons #195/#200 removed window.confirm. This
// guard makes a reintroduction fail CI instead of shipping.
//
// Sibling of globals-css.test.ts: both assert something about source text
// that no rendering test can see.
const SRC = join(__dirname, "../..");

// Matches `alert(` and `window.alert(` but not `showAlert(`, `x.alert(`, or
// the attribute `role="alert"` (no call parens). The lookbehind rejects a
// preceding identifier character or dot.
const ALERT_CALL = /(?<![\w.$])(?:window\.)?alert\s*\(/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("no browser alert() in product code", () => {
  it("finds source files to scan", () => {
    // Guards the guard: a broken walk would make the assertion below vacuous.
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
  });

  it("has no alert() call sites left outside tests", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => ALERT_CALL.test(readFileSync(file, "utf-8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
