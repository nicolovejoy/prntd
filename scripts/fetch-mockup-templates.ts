/**
 * Discover mockup templates and printfile dimensions for a Printful product.
 * Use the output to fill in `placements[].mockupPosition` and `printArea` in
 * src/lib/products.ts.
 *
 * Run with: npx tsx --env-file=.env.local scripts/fetch-mockup-templates.ts <productId>
 * Example:  npx tsx --env-file=.env.local scripts/fetch-mockup-templates.ts 71
 *
 * Defaults to product 71 (Bella+Canvas 3001) if no arg is given.
 */

const PRINTFUL_API = "https://api.printful.com";
const PRODUCT_ID = process.argv[2] ? parseInt(process.argv[2], 10) : 71;

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

  // Authoritative placement keys (e.g. "front", "back") + their labels. These
  // are the strings the order API (`files[].type`) and mockup generator
  // (`files[].placement`) expect — don't assume, read them here.
  if (pfResult.available_placements) {
    console.log("\n=== Available placements (key → label) ===");
    for (const [key, label] of Object.entries(pfResult.available_placements)) {
      console.log(`  ${key} → ${label}`);
    }
  }

  // Per-variant placement → printfile map. Confirms which printfile backs each
  // placement (we saw front=printfile 333, back=printfile 1 in the templates).
  const sampleVp = pfResult.variant_printfiles?.[0];
  if (sampleVp) {
    console.log(
      `\n=== Variant ${sampleVp.variant_id} placement → printfile ===`
    );
    for (const [key, pfId] of Object.entries(sampleVp.placements ?? {})) {
      console.log(`  ${key} → printfile ${pfId}`);
    }
  }

  // Dump full JSON for reference
  console.log("\n=== Full response (templates only) ===");
  console.log(JSON.stringify(result.templates?.slice(0, 3), null, 2));
}

main().catch(console.error);
