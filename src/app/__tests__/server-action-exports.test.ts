// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import ts from "typescript";

// Every export of a "use server" file is a Server Action: a public endpoint
// anyone can POST to with arbitrary arguments (#251). These tests pin the
// runtime export list of each such file so a trusted-input helper can't be
// added to one by accident, and check that the two helpers moved out for that
// reason stay out.

const ROOT = join(__dirname, "../../..");

function parse(source: string, fileName = "file.ts"): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === kind)
  );
}

/**
 * Sorted runtime export names. Throws on `export *` and on any exported
 * statement form it doesn't recognise, since neither can be pinned.
 */
function runtimeExports(source: string): string[] {
  const names = new Set<string>();
  for (const stmt of parse(source).statements) {
    if (ts.isExportDeclaration(stmt)) {
      const clause = stmt.exportClause;
      if (!clause) {
        throw new Error(
          "`export * from` can't be pinned; list the exports explicitly",
        );
      }
      if (stmt.isTypeOnly) continue;
      if (ts.isNamespaceExport(clause)) {
        names.add(clause.name.text);
        continue;
      }
      for (const spec of clause.elements) {
        if (!spec.isTypeOnly) names.add(spec.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      names.add("default");
      continue;
    }
    if (!hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) continue;
    if (hasModifier(stmt, ts.SyntaxKind.DeclareKeyword)) continue;
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      continue;
    }
    if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) {
      names.add("default");
    } else if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      if (stmt.name) names.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        addBindingNames(decl.name, names);
      }
    } else {
      throw new Error(
        `Unsupported exported statement (${ts.SyntaxKind[stmt.kind]}) can't be pinned`,
      );
    }
  }
  return [...names].sort();
}

/** Collects bound names of a binding target, skipping default initializers. */
function addBindingNames(target: ts.BindingName, names: Set<string>) {
  if (ts.isIdentifier(target)) {
    names.add(target.text);
    return;
  }
  for (const el of target.elements) {
    if (ts.isBindingElement(el)) addBindingNames(el.name, names);
  }
}

function isUseServer(node: ts.Node): boolean {
  return (
    ts.isExpressionStatement(node) &&
    ts.isStringLiteral(node.expression) &&
    node.expression.text === "use server"
  );
}

function startsWithUseServer(source: string): boolean {
  const first = parse(source).statements[0];
  return !!first && isUseServer(first);
}

/** A "use server" directive anywhere: top level or inside a function body. */
function containsUseServer(source: string): boolean {
  let found = false;
  (function visit(n: ts.Node) {
    if (found) return;
    if (isUseServer(n)) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  })(parse(source));
  return found;
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

describe("runtimeExports helper", () => {
  it("lists functions, async functions, classes and enums", () => {
    expect(
      runtimeExports(`
        export function a() {}
        export async function b() {}
        export class C {}
        export enum E { X }
      `),
    ).toEqual(["C", "E", "a", "b"]);
  });

  it("lists every declarator of a const", () => {
    expect(runtimeExports(`export const x = 1, y = 2;`)).toEqual(["x", "y"]);
  });

  it("names a default export 'default'", () => {
    expect(runtimeExports(`export default function () {}`)).toEqual([
      "default",
    ]);
    expect(runtimeExports(`const a = 1; export default a;`)).toEqual([
      "default",
    ]);
  });

  it("uses the exported name of export specifiers", () => {
    expect(runtimeExports(`const a = 1, b = 2; export { a, b as c };`)).toEqual(
      ["a", "c"],
    );
  });

  it("skips type-only specifiers", () => {
    expect(
      runtimeExports(`const a = 1; type T = 1; export { a, type T };`),
    ).toEqual(["a"]);
    expect(runtimeExports(`type T = 1; export type { T };`)).toEqual([]);
  });

  it("ignores exported types, interfaces and declare", () => {
    expect(
      runtimeExports(`
        export type T = string;
        export interface I { a: string }
        export declare function d(): void;
        const kept = 1;
      `),
    ).toEqual([]);
  });

  it("throws on export *", () => {
    expect(() => runtimeExports(`export * from "./x";`)).toThrow(
      /can't be pinned/,
    );
  });

  it("throws on exported forms it can't see", () => {
    expect(() =>
      runtimeExports(`export namespace N { export const x = 1 }`),
    ).toThrow(/can't be pinned/);
    expect(() => runtimeExports(`export import A = B.C;`)).toThrow(
      /can't be pinned/,
    );
  });

  it("does not report a default interface", () => {
    expect(runtimeExports(`export default interface I {}`)).toEqual([]);
  });

  it("lists destructured exports without descending into initializers", () => {
    expect(
      runtimeExports(
        `export const { a, b: c, ...rest } = o; export const [d, [e]] = arr;`,
      ),
    ).toEqual(["a", "c", "d", "e", "rest"]);
    expect(
      runtimeExports(`export const { a = ({ b }) => b } = o;`),
    ).toEqual(["a"]);
  });

  it("lists re-exports, namespace re-exports, let/var and async defaults", () => {
    expect(runtimeExports(`export { x } from "./m";`)).toEqual(["x"]);
    expect(runtimeExports(`export { x as y } from "./m";`)).toEqual(["y"]);
    expect(runtimeExports(`export * as ns from "./m";`)).toEqual(["ns"]);
    expect(runtimeExports(`export let a = 1; export var b = 2;`)).toEqual([
      "a",
      "b",
    ]);
    expect(runtimeExports(`export default async function f() {}`)).toEqual([
      "default",
    ]);
  });
});

describe('"use server" export pins', () => {
  const pins: Record<string, string[]> = {
    "src/app/order/actions.ts": ["calculatePrice", "createCheckoutSession"],
    "src/app/preview/actions.ts": [
      "ensureMockupsPrefetched",
      "generateMockup",
      "getBackDesignSources",
      "getLastPurchaseDefaults",
      "getOrCreatePlacementRender",
      "isMultiPlacementEnabled",
    ],
    "src/app/d/actions.ts": [
      "buyPublishedDesign",
      "getBuyPageBackSources",
      "getConversationImages",
      "getDiscoverFeed",
      "getImagePage",
      "getListingBackMockup",
      "getListingMockup",
    ],
    "src/app/shop/actions.ts": [
      "buyStoreProduct",
      "getStoreProductForBuy",
      "getStorefront",
    ],
  };

  for (const [file, expected] of Object.entries(pins)) {
    it(`${file} starts with the directive`, () => {
      expect(startsWithUseServer(read(file))).toBe(true);
    });

    it(`${file} exports exactly the pinned list`, () => {
      const actual = runtimeExports(read(file));
      expect(
        actual,
        `Runtime exports of ${file} changed. Every export of a "use server" ` +
          `file is a Server Action that anyone can POST to (#251). Add a name ` +
          `to this list only if that function does its own auth; trusted ` +
          `helpers belong in src/lib/.`,
      ).toEqual(expected);
    });
  }
});

describe("helpers moved out of use-server files", () => {
  const moved: [string, string][] = [
    ["src/lib/order-checkout.ts", "createStripeCheckoutForOrder"],
    ["src/lib/mockup-prefetch.ts", "prefetchProductMockups"],
  ];

  for (const [file, name] of moved) {
    it(`${file} exports ${name} without a "use server" directive`, () => {
      const source = read(file);
      expect(runtimeExports(source)).toContain(name);
      expect(containsUseServer(source)).toBe(false);
    });
  }
});
