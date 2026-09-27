import { describe, it, expect } from "vitest";
import { safeNextPath, withNext } from "../safe-next";

describe("safeNextPath", () => {
  it.each(["/cart", "/d/abc?x=1#h", "/design?id=abc", "/studio/library"])(
    "accepts %s unchanged",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    }
  );

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["no leading slash", "cart"],
    ["protocol-relative", "//evil.example"],
    ["backslash", "/\\evil.example"],
    ["double backslash", "/\\\\evil.example"],
    ["tab", "/\t/evil.example"],
    ["newline", "/\n/evil.example"],
    ["carriage return", "/\r/evil.example"],
    ["tab inside the host slash", "/\\\t/evil.example"],
    ["absolute https", "https://evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["single-slash scheme", "http:/evil.example"],
    ["leading space", " /cart"],
    ["leading space then //", " //evil.example"],
    ["leading tab", "\t/cart"],
    ["leading newline then //", "\n//evil.example"],
    ["dot segment collapsing to //", "/.//evil.example"],
    ["dot-dot segment collapsing to //", "/..//evil.example"],
    ["encoded dot segment collapsing to //", "/%2e//evil.example"],
    ["dot segments after a directory", "/a/..//evil.example"],
    ["backslash dot segment", "/.\\/evil.example"],
    ["userinfo lookalike", "/\\@evil.example"],
  ])("falls back on %s", (_label, raw) => {
    expect(safeNextPath(raw)).toBe("/studio");
  });

  it("uses the supplied fallback", () => {
    expect(safeNextPath("//evil.example", "/x")).toBe("/x");
  });

  it("keeps an encoded slash as data, not a host separator", () => {
    expect(safeNextPath("/%2Fevil.example")).toBe("/%2Fevil.example");
  });
});

describe("withNext", () => {
  it("appends an encoded next for a safe path", () => {
    expect(withNext("/sign-up", "/studio/library")).toBe(
      "/sign-up?next=%2Fstudio%2Flibrary"
    );
    expect(withNext("/sign-in", "/d/a?x=1#h")).toBe(
      "/sign-in?next=%2Fd%2Fa%3Fx%3D1%23h"
    );
  });

  it.each([null, undefined, "", "//evil.example", "/\\evil.example", "https://evil.example"])(
    "returns the bare path for %s",
    (next) => {
      expect(withNext("/sign-up", next)).toBe("/sign-up");
    }
  );
});
