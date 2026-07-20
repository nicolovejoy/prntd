/**
 * Side-by-side trial: Ideogram v3 Turbo (current prod) vs v4 Turbo on Replicate.
 *
 * Runs each prompt through both models, saves PNGs to /tmp/ideogram-compare/,
 * and reports per-render wall-clock latency plus whether the output actually
 * carries an alpha channel (the transparency requirement for shirt printing).
 *
 * Run (needs REPLICATE_API_TOKEN):
 *   set -a && . ./.env.local && set +a && npx tsx scripts/compare-ideogram-v4.ts
 *
 * ~16 renders ≈ $0.50. Eyeball the pairs in /tmp/ideogram-compare/ when done.
 */
import Replicate from "replicate";
import { mkdirSync, writeFileSync } from "fs";

const MODELS = {
  v3: "ideogram-ai/ideogram-v3-turbo",
  v4: "ideogram-ai/ideogram-v4-turbo",
} as const;

// Representative of real usage: text-heavy, sticker/logo style, transparency.
const PROMPTS = [
  "Bold sumi-e brush lettering of 'today, this' in loose lowercase cursive, black ink, uneven pressure, hairline strokes, meditative minimal aesthetic, transparent background",
  "Hand-drawn arrows circling the words 'tomorrow never comes', rough marker style, black on transparent background",
  "Retro 70s sunset with the word 'COAST' in chrome script lettering, distressed print texture, transparent background",
  "Minimal line drawing of a bicycle with 'ride more worry less' in small caps underneath, single-weight black line, transparent background",
  "A grumpy cat wearing a party hat, flat vector sticker style with bold outlines, vibrant colors, transparent background",
  "Vintage botanical illustration of sword ferns, muted greens, engraved texture, transparent background",
  "The phrase 'Seattle Rain Club' as an embroidered-patch style badge, navy and cream, transparent background",
  "Geometric bauhaus composition of overlapping circles and one triangle, red black and mustard, transparent background",
];

async function hasAlpha(png: Buffer): Promise<boolean> {
  // PNG color type lives at byte 25 of the IHDR chunk; 4 and 6 carry alpha.
  if (png.length < 26 || png.readUInt32BE(12) !== 0) {
    // Not a minimal-IHDR-first PNG (or not a PNG); fall back to signature scan.
    const ihdrAt = png.indexOf("IHDR");
    if (ihdrAt === -1) return false;
    const colorType = png[ihdrAt + 13];
    return colorType === 4 || colorType === 6;
  }
  const colorType = png[25];
  return colorType === 4 || colorType === 6;
}

async function main() {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    console.error("REPLICATE_API_TOKEN not set — source .env.local first.");
    process.exit(1);
  }
  const replicate = new Replicate({ auth: token });
  const outDir = "/tmp/ideogram-compare";
  mkdirSync(outDir, { recursive: true });

  const rows: string[] = [];
  for (const [tag, model] of Object.entries(MODELS)) {
    for (let i = 0; i < PROMPTS.length; i++) {
      const started = Date.now();
      try {
        const output = await replicate.run(model as `${string}/${string}`, {
          input: { prompt: PROMPTS[i], aspect_ratio: "3:4" },
        });
        const url = Array.isArray(output) ? String(output[0]) : String(output);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        const res = await fetch(url);
        const buf = Buffer.from(await res.arrayBuffer());
        const file = `${outDir}/p${i + 1}-${tag}.png`;
        writeFileSync(file, buf);
        const alpha = await hasAlpha(buf);
        rows.push(`p${i + 1} ${tag}: ${secs}s alpha=${alpha} ${file}`);
        console.log(rows[rows.length - 1]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        rows.push(`p${i + 1} ${tag}: FAILED ${msg.slice(0, 120)}`);
        console.log(rows[rows.length - 1]);
      }
    }
  }

  writeFileSync(`${outDir}/report.txt`, rows.join("\n") + "\n");
  console.log(`\nReport: ${outDir}/report.txt — eyeball the p<N>-v3/p<N>-v4 pairs.`);
}

main();
