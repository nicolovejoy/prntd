// @vitest-environment node
/**
 * One buy surface, slice 4 (#278): nothing in product code links to /preview
 * any more. The route is a redirect for old links. A new link to it would put
 * buyers through a redirect for nothing, so this fails on one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";

const ROOT = join(__dirname, "../../..");

// Files that may name /preview, each for a reason that outlives this slice.
const ALLOWED: Record<string, string> = {
  "src/app/order/page.tsx": "the legacy /order redirect forwards to /preview, which redirects on",
  "src/app/order/actions.ts": "createCheckoutSession: no caller since slice 4, removed in slice 6",
  "src/lib/preview-redirect.ts": "the sign-in detour returns to the redirect itself",
  "src/proxy.ts": "route list, not a link",
  "src/lib/funnel-routes.ts": "route list, not a link",
};

function productFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...productFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function previewLiterals(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node)
    ) {
      const text = node.text;
      if (text === "/preview" || text.startsWith("/preview?") || text.startsWith("/preview/")) {
        found.push(text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("no product code links to /preview (#278 slice 4)", () => {
  const files = productFiles(join(ROOT, "src"));

  it("found source files to check", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const path of files) {
    const rel = relative(ROOT, path);
    if (rel in ALLOWED) continue;
    it(`${rel} has no /preview link`, () => {
      expect(previewLiterals(readFileSync(path, "utf8"), rel)).toEqual([]);
    });
  }

  it("catches a link in a template and in a plain string", () => {
    expect(previewLiterals("const a = `/preview?id=${x}`; const b = '/preview';", "x.ts")).toEqual([
      "/preview?id=",
      "/preview",
    ]);
    expect(previewLiterals("// see /preview\nconst c = '/d/x';", "x.ts")).toEqual([]);
  });
});
