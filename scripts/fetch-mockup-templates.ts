/**
 * One-time script to discover available mockup templates for Bella+Canvas 3001.
 *
 * Run with: npx tsx scripts/fetch-mockup-templates.ts
 * Requires PRINTFUL_API_KEY env var (source .env.local first).
 */

const PRINTFUL_API = "https://api.printful.com";
const PRODUCT_ID = 71; // Bella+Canvas 3001

async function printfulFetch(path: string) {
  const res = await fetch(`${PRINTFUL_API}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Printful API error: ${res.status} ${error}`);
  }
  return res.json();
}

async function main() {
  console.log(`Fetching mockup templates for product ${PRODUCT_ID}...\n`);

  const data = await printfulFetch(
    `/mockup-generator/templates/${PRODUCT_ID}`
  );
  const result = data.result;

  console.log(`Variant count: ${result.variant_mapping?.length ?? 0}`);
  console.log(`Placement count: ${result.placement_options?.length ?? 0}`);
  console.log(
    `Template count: ${result.templates?.length ?? 0}\n`
  );

  // Show placement options
  if (result.placement_options) {
    console.log("=== Placement Options ===");
    for (const p of result.placement_options) {
      console.log(`  ${p.id}: ${p.title} (${p.type})`);
    }
    console.log();
  }

  // Show templates grouped by placement
  if (result.templates) {
    console.log("=== Templates ===");
    for (const t of result.templates) {
      console.log(
        `  ID: ${t.template_id} | Placement: ${t.placement} | ` +
          `Size: ${t.image_width}x${t.image_height} | ` +
          `Print area: ${t.print_area_width}x${t.print_area_height} | ` +
          `Variants: ${t.variant_ids?.length ?? 0} | ` +
          `Background: ${t.background_url ? "yes" : "no"}`
      );
    }
    console.log();
  }

  // Show first few variant mappings
  if (result.variant_mapping) {
    console.log("=== Variant Mapping (first 5) ===");
    for (const v of result.variant_mapping.slice(0, 5)) {
      console.log(
        `  Variant ${v.variant_id}: templates [${v.templates?.map((t: { template_id: number }) => t.template_id).join(", ")}]`
      );
    }
  }

  // Also fetch printfiles for dimension info
  console.log("\n=== Printfiles ===");
  const pfData = await printfulFetch(
    `/mockup-generator/printfiles/${PRODUCT_ID}`
  );
  const pfResult = pfData.result;
  if (pfResult.printfiles) {
    for (const pf of pfResult.printfiles) {
      console.log(
        `  Printfile ${pf.printfile_id}: ${pf.width}x${pf.height} | ` +
          `DPI: ${pf.dpi} | Variants: ${pf.variant_ids?.length ?? 0}`
      );
    }
  }

  // Dump full JSON for reference
  console.log("\n=== Full response (templates only) ===");
  console.log(JSON.stringify(result.templates?.slice(0, 3), null, 2));
}

main().catch(console.error);
