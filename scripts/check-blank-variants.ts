/**
 * Read-only check of every shirt variant id in src/lib/blanks.ts against
 * Printful's public catalogue (no API key needed).
 *
 * Run with: npx tsx scripts/check-blank-variants.ts
 *
 * Reports, per product:
 *   - MISSING: a variant id Printful no longer lists (discontinued or removed),
 *     or one whose colour/size no longer matches the entry in blanks.ts.
 *   - out of stock (warning only): listed, but not in_stock for the US. These
 *     are usually temporary, so they do not change the exit code.
 *
 * Exits 1 if anything is MISSING or mismatched.
 */
import { BLANKS } from "../src/lib/blanks";

type ApiVariant = {
  id: number;
  color: string;
  size: string;
  in_stock: boolean;
  availability_status: { region: string; status: string }[];
};

async function main() {
  let failures = 0;

  for (const blank of BLANKS) {
    if (blank.type !== "shirt") continue;

    const res = await fetch(
      `https://api.printful.com/products/${blank.printfulProductId}`
    );
    if (!res.ok) {
      console.error(`${blank.id}: Printful returned ${res.status}`);
      failures++;
      continue;
    }
    const data = (await res.json()) as { result: { variants: ApiVariant[] } };
    const live = new Map(data.result.variants.map((v) => [v.id, v]));

    let checked = 0;
    const lines: string[] = [];
    for (const [color, sizes] of Object.entries(blank.variants)) {
      for (const [size, id] of Object.entries(sizes)) {
        checked++;
        const v = live.get(id);
        if (!v) {
          lines.push(`  MISSING   ${color} / ${size}  (variant ${id})`);
          failures++;
        } else if (v.color !== color || v.size !== size) {
          lines.push(
            `  MISMATCH  ${color} / ${size}  (variant ${id} is now ${v.color} / ${v.size})`
          );
          failures++;
        } else if (
          !v.availability_status.some(
            (a) => a.region === "US" && a.status === "in_stock"
          )
        ) {
          lines.push(`  out of stock (US)  ${color} / ${size}  (variant ${id})`);
        }
      }
    }

    console.log(
      `${blank.id} (Printful ${blank.printfulProductId}): ${checked} variant ids checked`
    );
    for (const l of lines) console.log(l);
  }

  if (failures > 0) {
    console.error(`\n${failures} problem(s) found.`);
    process.exit(1);
  }
  console.log("\nNo missing or mismatched variants.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
