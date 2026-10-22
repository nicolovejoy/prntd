// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Email HTML, satori (OG card), the web manifest, artwork-well.ts and the icon
// generator cannot read CSS custom properties, so they carry hand-copied hex
// values. The generated src/app/icon.svg carries them too. This test
// reads those values as source text and compares each to the token in
// globals.css's :root block. The files are read as text, not imported:
// email.ts and og-site-card.tsx pull in Resend and satori.

const ROOT = join(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

function rootTokens(): Map<string, string> {
  const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const start = css.indexOf(":root {");
  expect(start, "expected a :root block in globals.css").toBeGreaterThan(-1);
  const block = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const tokens = new Map<string, string>();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

// OKLCH -> OKLab -> linear sRGB -> gamma sRGB, with the matrices from
// Bjorn Ottosson's OKLab article (https://bottosson.github.io/posts/oklab/).
function oklchToHex(value: string): string {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!m) throw new Error(`not an oklch() value: ${value}`);
  const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const encode = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return (
    "#" +
    linear
      .map((x) =>
        Math.round(Math.min(1, Math.max(0, encode(x))) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** Token value as a hex string; --background is the one oklch() token. */
function tokenHex(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} not found in :root`);
  return value.startsWith("oklch(") ? oklchToHex(value) : value;
}

function constHex(file: string, constName: string): string {
  const m = new RegExp(`const ${constName}\\s*=\\s*"(#[0-9a-f]{6})"`, "i").exec(
    read(file),
  );
  if (!m) throw new Error(`const ${constName} = "#xxxxxx" not found in ${file}`);
  return m[1];
}

const MIRRORS: { file: string; constName: string; token: string }[] = [
  { file: "src/lib/email.ts", constName: "INK", token: "--foreground" },
  { file: "src/lib/email.ts", constName: "MUTED", token: "--text-muted" },
  { file: "src/lib/email.ts", constName: "FAINT", token: "--text-faint" },
  { file: "src/lib/email.ts", constName: "BORDER", token: "--border" },
  { file: "src/lib/email.ts", constName: "GROUND", token: "--background" },
  { file: "src/lib/email.ts", constName: "SURFACE", token: "--surface" },
  { file: "src/lib/email.ts", constName: "WELL", token: "--surface-well" },
  { file: "src/lib/email.ts", constName: "ROSE", token: "--accent-rose" },
  { file: "src/lib/og-site-card.tsx", constName: "GROUND", token: "--background" },
  { file: "src/lib/og-site-card.tsx", constName: "INK", token: "--foreground" },
  { file: "src/lib/og-site-card.tsx", constName: "FAINT", token: "--text-faint" },
  { file: "src/lib/og-site-card.tsx", constName: "ROSE", token: "--accent-rose" },
  { file: "src/app/manifest.ts", constName: "PAPER", token: "--background" },
  { file: "src/lib/artwork-well.ts", constName: "PAPER_WELL_HEX", token: "--surface-well" },
  { file: "src/lib/artwork-well.ts", constName: "DARK_WELL_HEX", token: "--surface-well-dark" },
  { file: "scripts/generate-icons.ts", constName: "PAPER", token: "--background" },
  { file: "scripts/generate-icons.ts", constName: "INK", token: "--foreground" },
  { file: "scripts/generate-icons.ts", constName: "ROSE", token: "--accent-rose" },
];

describe("hand-copied token hex values match globals.css", () => {
  const tokens = rootTokens();

  it("--background converts to #f8f5ef, the value every mirror uses", () => {
    expect(tokenHex(tokens, "--background").toLowerCase()).toBe("#f8f5ef");
  });

  it.each(MIRRORS)(
    "$file $constName matches $token",
    ({ file, constName, token }) => {
      expect(constHex(file, constName).toLowerCase()).toBe(
        tokenHex(tokens, token).toLowerCase(),
      );
    },
  );

  it("every colour in src/app/icon.svg is a token hex", () => {
    const allowed = new Set(
      ["--background", "--foreground", "--accent-rose"].map((t) =>
        tokenHex(tokens, t).toLowerCase(),
      ),
    );
    const colours = [
      ...read("src/app/icon.svg").matchAll(/\b(?:fill|stroke|stop-color)="([^"]*)"/g),
    ].map((m) => m[1].toLowerCase());
    expect(colours.length, "expected colours in icon.svg").toBeGreaterThan(0);
    expect(colours.filter((c) => !allowed.has(c))).toEqual([]);
  });
});
