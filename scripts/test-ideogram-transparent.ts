/**
 * Compare Ideogram's native transparent endpoint against Replicate v3 Turbo
 * (today's pipeline) on two designs that have failed our matting-model
 * background removal: the ogre with "STOP PLATE TECTONICS!" caption and the
 * scale of justice with "WORDS ARE BIASED" lettering.
 *
 * Outputs four PNGs to /tmp/ideogram-test/ for side-by-side review:
 *   {prompt}-transparent.png   — Ideogram direct API, generate-transparent (RGBA)
 *   {prompt}-turbo.png         — Replicate Ideogram v3 Turbo (RGB, today's path)
 *
 * Same prompt + same seed for both endpoints, so any visual difference is
 * the endpoint, not aesthetic variance.
 *
 * Run:
 *   node --env-file=.env.local --import tsx scripts/test-ideogram-transparent.ts
 *
 * Requires IDEOGRAM_API_KEY and REPLICATE_API_TOKEN in .env.local.
 */

import Replicate from "replicate";
import { promises as fs } from "node:fs";
import path from "node:path";

const SEED = 42;
const OUT_DIR = "/tmp/ideogram-test";

const PROMPTS = [
  {
    id: "ogre",
    text: 'Comic book panel style t-shirt graphic, brutish Ogre with tusks and warty green-grey skin, heavy brow and determined grimace, kneeling and pressing both hands flat against cracked earth, visible fault lines radiating outward from his hands, dynamic action pose, bold black ink outlines, classic 4-color comic palette (red, blue, yellow, black), halftone dot shading, motion lines, slight registration offset for vintage comic feel, white background isolated design — large bold chunky distressed rally-poster text at bottom of image reads "STOP PLATE TECTONICS!"',
  },
  {
    id: "scale",
    text: 'Vintage hand-drawn scale of justice with two pans hanging from the crossbeam, ornate detailed black ink line art on white background, isolated design, large bold serif text above the scale reads "WORDS ARE BIASED", small text in the left pan reads "WHAT I SAID", small text in the right pan reads "WHAT YOU HEARD"',
  },
];

async function ideogramTransparent(prompt: string, seed: number) {
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) throw new Error("IDEOGRAM_API_KEY missing from env");

  const fd = new FormData();
  fd.append("prompt", prompt);
  fd.append("seed", String(seed));
  fd.append("aspect_ratio", "1x1"); // Ideogram uses NxM format, not N:M
  fd.append("rendering_speed", "TURBO"); // match what Replicate Turbo gives us
  fd.append("magic_prompt", "OFF"); // match the magic_prompt_option: Off in src/lib/replicate.ts

  const res = await fetch(
    "https://api.ideogram.ai/v1/ideogram-v3/generate-transparent",
    {
      method: "POST",
      headers: { "Api-Key": apiKey },
      body: fd,
    }
  );

  if (!res.ok) {
    throw new Error(`Ideogram ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const first = data.data?.[0];
  if (!first?.url) throw new Error(`No URL in Ideogram response: ${JSON.stringify(data)}`);
  return {
    url: first.url as string,
    resolution: first.resolution as string | undefined,
    actualPrompt: first.prompt as string | undefined,
    seed: first.seed as number | undefined,
  };
}

async function replicateTurbo(prompt: string, seed: number) {
  const replicate = new Replicate();
  const output = await replicate.run("ideogram-ai/ideogram-v3-turbo", {
    input: {
      prompt,
      aspect_ratio: "1:1",
      seed,
      magic_prompt_option: "Off",
    },
  });
  return String(output);
}

async function downloadToFile(url: string, filePath: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(filePath, buf);
  return { bytes: buf.length };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const p of PROMPTS) {
    console.log(`\n=== ${p.id} ===`);

    // Run both endpoints in parallel — they don't depend on each other
    const [transparentResult, turboUrl] = await Promise.all([
      ideogramTransparent(p.text, SEED).catch((err) => {
        console.error(`Ideogram transparent failed for ${p.id}:`, err.message);
        return null;
      }),
      replicateTurbo(p.text, SEED).catch((err) => {
        console.error(`Replicate Turbo failed for ${p.id}:`, err.message);
        return null;
      }),
    ]);

    if (transparentResult) {
      const filePath = path.join(OUT_DIR, `${p.id}-transparent.png`);
      const { bytes } = await downloadToFile(transparentResult.url, filePath);
      console.log(`  transparent: ${filePath} (${(bytes / 1024).toFixed(1)} KB)`);
      console.log(`    resolution: ${transparentResult.resolution ?? "?"}`);
      console.log(`    seed:       ${transparentResult.seed ?? "?"}`);
    }

    if (turboUrl) {
      const filePath = path.join(OUT_DIR, `${p.id}-turbo.png`);
      const { bytes } = await downloadToFile(turboUrl, filePath);
      console.log(`  turbo:       ${filePath} (${(bytes / 1024).toFixed(1)} KB)`);
    }
  }

  console.log("\n---");
  console.log(`Open the directory to compare side-by-side:`);
  console.log(`  open ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
