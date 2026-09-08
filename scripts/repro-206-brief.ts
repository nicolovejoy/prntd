/**
 * #206 repro: run `constructDesignBrief` on the three verbatim slogan first
 * turns and print what the brief decides — `clarify`, or `generate` with /
 * without a `text` element. Decides the fix shape (see the issue comment).
 *
 * Needs ANTHROPIC_API_KEY (three Sonnet calls, ~$0.03 total). No DB.
 * Prints no secrets.
 *
 *   node --env-file=.env.local --import tsx scripts/repro-206-brief.ts
 */
import { constructDesignBrief } from "@/lib/ai";

const PROMPTS = [
  "statements are pointless",
  "Partisanship averse",
  "big dogs don't jiggle",
];

async function main() {
for (const prompt of PROMPTS) {
  const brief = await constructDesignBrief([], [], prompt);
  console.log(`\n## "${prompt}" → operation=${brief.operation}`);
  console.log(`   message: ${brief.message}`);
  if (brief.operation === "generate") {
    const text = brief.spec.elements.filter((e) => e.type === "text");
    console.log(`   subject: ${brief.spec.subject}`);
    console.log(`   text elements: ${text.length}${text.length ? " → " + JSON.stringify(text) : ""}`);
    console.log(`   spec: ${JSON.stringify(brief.spec)}`);
  } else if (brief.operation === "edit") {
    console.log(`   editInstruction: ${brief.editInstruction}`);
  }
}
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
