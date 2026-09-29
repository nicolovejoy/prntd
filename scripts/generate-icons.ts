/**
 * Generates the PRNTD app icon set (#235) from one definition of the mark.
 *
 *   npx tsx scripts/generate-icons.ts
 *
 * The mark (picked by Nico 2026-09-29, "variant 5"): a 240×240 Paper square,
 * 22px padding, a 3×2 grid of ink tiles (8px gaps, radius 6) reading
 * P R [i] / N T D. Letters are Geist 900 at 72px, letter-spacing -0.04em,
 * Paper-coloured and centred the way the approved HTML mock centres them
 * (flex centring of the text line box). The i-block is a built "i": a 7×7
 * rose dot, a 4px gap, a 7×18 Paper stem.
 *
 * Letters are outlined to SVG paths with opentype.js, so no output depends
 * on a runtime font. The font is Google Fonts' static Geist 900 instance
 * (the same family the mock loaded), downloaded on each run.
 *
 * Writes:
 *   src/app/icon.svg                  master (paths and rects only)
 *   src/app/favicon.ico               16, 32, 48 (PNG entries)
 *   src/app/apple-icon.png            180, square (iOS applies the corner mask)
 *   public/icons/icon-192.png         manifest, purpose "any"
 *   public/icons/icon-512.png         manifest, purpose "any"
 *   public/icons/icon-maskable-512.png manifest, purpose "maskable": the tile
 *                                     grid sits inside the central 80% circle
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import opentype from "opentype.js";
import sharp from "sharp";

const ROOT = path.resolve(__dirname, "..");

// Pinned: Google Fonts css2?family=Geist:wght@900, truetype response.
const FONT_URL =
  "https://fonts.gstatic.com/s/geist/v5/gyBhhwUxId8gMGYQMKR3pzfaWI_RNeQ4nQ.ttf";
// SHA-256 of that file as downloaded 2026-09-29. A mismatch means Google
// re-served different bytes, which would change the letter outlines.
const FONT_SHA256 = "33eafb809140b258737f1163b649580d4ebc3c17231d6ec409288192747c0be8";

// Paper tokens (src/app/globals.css).
const PAPER = "#f8f5ef";
const INK = "#141311";
const ROSE = "#a83250";

const SIZE = 240;
const PAD = 22;
const GAP = 8;
const COLS = 3;
const ROWS = 2;
const CELL_W = (SIZE - 2 * PAD - (COLS - 1) * GAP) / COLS; // 60
const CELL_H = (SIZE - 2 * PAD - (ROWS - 1) * GAP) / ROWS; // 94
const RADIUS = 6;
const FONT_SIZE = 72;
const LETTER_SPACING = -0.04 * FONT_SIZE;

const r2 = (n: number) => Math.round(n * 100) / 100;

async function loadFont(): Promise<opentype.Font> {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`font download failed: ${res.status}`);
  const bytes = await res.arrayBuffer();
  const sha = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  if (sha !== FONT_SHA256) throw new Error(`font bytes changed: sha256 ${sha}`);
  const font = opentype.parse(bytes);
  const weight = font.tables.os2?.usWeightClass;
  if (weight !== 900) throw new Error(`expected Geist weight 900, got ${weight}`);
  return font;
}

/**
 * Vertical metrics Chrome uses for `line-height: normal`: typo metrics when
 * the font sets USE_TYPO_METRICS (fsSelection bit 7), hhea otherwise.
 */
function lineMetrics(font: opentype.Font) {
  const os2 = font.tables.os2;
  const useTypo = (os2.fsSelection & (1 << 7)) !== 0;
  const asc = useTypo ? os2.sTypoAscender : font.tables.hhea.ascender;
  const desc = useTypo ? -os2.sTypoDescender : -font.tables.hhea.descender;
  const gap = useTypo ? os2.sTypoLineGap : font.tables.hhea.lineGap;
  const k = FONT_SIZE / font.unitsPerEm;
  return { ascent: asc * k, descent: desc * k, lineGap: gap * k };
}

function letterPath(font: opentype.Font, ch: string, cellX: number, cellY: number): string {
  const glyph = font.charToGlyph(ch);
  const k = FONT_SIZE / font.unitsPerEm;
  const inlineWidth = (glyph.advanceWidth ?? 0) * k + LETTER_SPACING;
  const { ascent, descent, lineGap } = lineMetrics(font);
  const lineHeight = ascent + descent + lineGap;
  const x = cellX + (CELL_W - inlineWidth) / 2;
  const baseline = cellY + (CELL_H - lineHeight) / 2 + lineGap / 2 + ascent;
  // opentype.js 2 flips y by default in toPathData; getPath is already y-down.
  return glyph.getPath(x, baseline, FONT_SIZE).toPathData({ decimalPlaces: 2, flipY: false });
}

/** The mark's shapes in 240-unit coordinates, as SVG elements. */
function markElements(font: opentype.Font): string {
  const layout = ["P", "R", "i", "N", "T", "D"];
  const tiles: string[] = [];
  const letters: string[] = [];
  const dotAndStem: string[] = [];
  layout.forEach((ch, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const x = PAD + col * (CELL_W + GAP);
    const y = PAD + row * (CELL_H + GAP);
    tiles.push(
      `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(CELL_W)}" height="${r2(CELL_H)}" rx="${RADIUS}"/>`
    );
    if (ch === "i") {
      // 7×7 dot, 4 gap, 7×18 stem, centred as a 7×29 column. The half-pixel
      // offsets round up, as Chrome's layout did in the approved mock.
      const colX = x + Math.round((CELL_W - 7) / 2);
      const colY = y + Math.round((CELL_H - 29) / 2);
      dotAndStem.push(`<rect x="${r2(colX)}" y="${r2(colY)}" width="7" height="7" fill="${ROSE}"/>`);
      dotAndStem.push(`<rect x="${r2(colX)}" y="${r2(colY + 11)}" width="7" height="18" fill="${PAPER}"/>`);
    } else {
      letters.push(letterPath(font, ch, x, y));
    }
  });
  return [
    `<g fill="${INK}">${tiles.join("")}</g>`,
    `<path fill="${PAPER}" d="${letters.join("")}"/>`,
    ...dotAndStem,
  ].join("\n  ");
}

/** A square SVG of `px` pixels: Paper ground, the 240-unit mark scaled by `scale` about the centre. */
function svgDoc(elements: string, px: number | null, scale = 1): string {
  const dims = px ? ` width="${px}" height="${px}"` : "";
  const inner =
    scale === 1
      ? elements
      : `<g transform="translate(${r2((SIZE * (1 - scale)) / 2)} ${r2((SIZE * (1 - scale)) / 2)}) scale(${scale})">\n  ${elements}\n  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}"${dims}>\n  <rect width="${SIZE}" height="${SIZE}" fill="${PAPER}"/>\n  ${inner}\n</svg>\n`;
}

async function png(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** ICO container with PNG-encoded entries (supported by every current browser). */
function ico(entries: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

// Maskable: the safe zone is a circle of radius 0.4 × size. The tile grid's
// farthest point is its corner, (SIZE/2 - PAD)·√2 from the centre in mark
// units; scale so that lands inside the circle with a small margin.
const MASKABLE_SCALE = r2((0.4 * SIZE * 0.98) / ((SIZE / 2 - PAD) * Math.SQRT2));

async function main() {
  const font = await loadFont();
  const mark = markElements(font);

  const out = (rel: string, data: string | Buffer) => {
    const abs = path.join(ROOT, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, data);
    console.log(`wrote ${rel} (${Buffer.byteLength(data)} bytes)`);
  };

  out("src/app/icon.svg", svgDoc(mark, null));
  out("src/app/apple-icon.png", await png(svgDoc(mark, 180)));
  out("public/icons/icon-192.png", await png(svgDoc(mark, 192)));
  out("public/icons/icon-512.png", await png(svgDoc(mark, 512)));
  out("public/icons/icon-maskable-512.png", await png(svgDoc(mark, 512, MASKABLE_SCALE)));
  const icoEntries = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, data: await png(svgDoc(mark, size)) }))
  );
  out("src/app/favicon.ico", ico(icoEntries));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
