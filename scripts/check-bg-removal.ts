/**
 * Does the anchored-generation transparency step actually produce alpha?
 *
 * Verified 2026-08-02: within one design, generation #1 (no anchor → Ideogram's
 * native generate-transparent endpoint) is RGBA, while #2–#5 (anchored →
 * ideogram-v3-turbo + BiRefNet via removeBackground) are plain RGB with no
 * alpha channel at all. r2.ts uploads bytes verbatim, so the RGB came back
 * from Replicate. This isolates removeBackground: feed it a known-opaque image
 * and report whether the result carries alpha.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/check-bg-removal.ts <image-url>
 *
 * Writes the verdict to /tmp/bg-removal-check.txt.
 */
import { writeFileSync } from "node:fs";
import { removeBackground } from "../src/lib/replicate";

const DEFAULT_SAMPLE =
  "https://pub-7389d029733346daa7c3196cad2f5288.r2.dev/designs/914f394a-d287-4dfb-a64b-3bc347c754f4/3.png";

async function main() {
  const input = process.argv[2] ?? DEFAULT_SAMPLE;
  const lines: string[] = [`input:  ${input}`];

  try {
    const output = await removeBackground(input);
    lines.push(`output: ${output}`);

    // PNG colour type lives in the IHDR chunk: byte 25 of the file.
    // 2 = RGB (no alpha), 6 = RGBA. Anything but 6 means the knockout
    // produced an opaque image.
    const bytes = new Uint8Array(
      await (await fetch(output)).arrayBuffer()
    );
    const colourType = bytes[25];
    const name =
      { 0: "grayscale", 2: "RGB", 3: "palette", 4: "gray+alpha", 6: "RGBA" }[
        colourType
      ] ?? `unknown(${colourType})`;
    lines.push(`png colour type: ${colourType} (${name})`);
    lines.push(
      colourType === 6
        ? "VERDICT: alpha present — removeBackground is working; look upstream."
        : "VERDICT: NO ALPHA — removeBackground returned an opaque image."
    );
  } catch (err) {
    lines.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    lines.push("VERDICT: removeBackground threw — see error above.");
  }

  const report = lines.join("\n");
  console.log(report);
  writeFileSync("/tmp/bg-removal-check.txt", report + "\n");
}

main();
