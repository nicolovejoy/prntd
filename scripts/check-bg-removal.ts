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

const BG_REMOVER = "851-labs/background-remover";

async function main() {
  const input = process.argv[2] ?? DEFAULT_SAMPLE;
  const token = process.env.REPLICATE_API_TOKEN;
  const lines: string[] = [
    `REPLICATE_API_TOKEN: ${
      token ? `present (${token.length} chars, starts ${token.slice(0, 4)}…)` : "MISSING"
    }`,
    `input:  ${input}`,
  ];

  if (!token) {
    lines.push(
      "VERDICT: no token in the environment — add REPLICATE_API_TOKEN to .env.local and re-run."
    );
    finish(lines);
    return;
  }

  // What does the pinned knockout model actually accept? If background_type
  // has no "rgba" option, the current call in replicate.ts is asking for
  // something the model ignores.
  try {
    const { default: Replicate } = await import("replicate");
    const model = await new Replicate({ auth: token }).models.get(
      "851-labs",
      "background-remover"
    );
    const props =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any).latest_version?.openapi_schema?.components?.schemas?.Input
        ?.properties ?? {};
    for (const key of ["background_type", "format", "threshold"]) {
      const p = props[key];
      if (!p) {
        lines.push(`${BG_REMOVER} input "${key}": NOT IN SCHEMA`);
        continue;
      }
      const allowed = p.enum ?? p.allOf?.[0]?.enum ?? p["$ref"] ?? p.type;
      lines.push(
        `${BG_REMOVER} input "${key}": allowed=${JSON.stringify(allowed)} default=${JSON.stringify(p.default)}`
      );
    }
  } catch (err) {
    lines.push(
      `schema lookup failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

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

  finish(lines);
}

function finish(lines: string[]) {
  const report = lines.join("\n");
  console.log(report);
  writeFileSync("/tmp/bg-removal-check.txt", report + "\n");
}

main();
