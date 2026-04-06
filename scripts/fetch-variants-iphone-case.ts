/**
 * Discover Clear Case for iPhone variant IDs and mockup templates.
 *
 * Run with: source .env.local && npx tsx scripts/fetch-variants-iphone-case.ts
 * Requires PRINTFUL_API_KEY env var.
 */

const PRINTFUL_API = "https://api.printful.com";
const PRODUCT_ID = 181; // Clear Case for iPhone®

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
  console.log(`Fetching product ${PRODUCT_ID} info...\n`);
  const productData = await printfulFetch(`/products/${PRODUCT_ID}`);
  const product = productData.result.product;
  const variants = productData.result.variants;

  console.log(`Product: ${product.title}`);
  console.log(`Type: ${product.type}`);
  console.log(`Variants: ${variants.length}\n`);

  // Group variants by color → size (size = iPhone model)
  const byColor: Record<string, { size: string; id: number; price: string }[]> = {};
  for (const v of variants) {
    const color = v.color || "Clear";
    if (!byColor[color]) byColor[color] = [];
    byColor[color].push({ size: v.size, id: v.id, price: v.price });
  }

  console.log("=== Variants by Color ===");
  for (const [color, sizes] of Object.entries(byColor)) {
    console.log(`\n  ${color}:`);
    for (const s of sizes.sort((a, b) => a.size.localeCompare(b.size))) {
      console.log(`    ${s.size}: variant ${s.id} ($${s.price})`);
    }
  }

  // Output as TypeScript-ready map
  console.log("\n=== TypeScript Variant Map ===");
  console.log("const IPHONE_CASE_VARIANTS = {");
  for (const [color, sizes] of Object.entries(byColor)) {
    const entries = sizes
      .sort((a, b) => a.size.localeCompare(b.size))
      .map((s) => `"${s.size}": ${s.id}`)
      .join(", ");
    console.log(`  "${color}": { ${entries} },`);
  }
  console.log("};");

  // Mockup templates
  console.log("\n=== Mockup Templates (first 3) ===");
  const templateData = await printfulFetch(
    `/mockup-generator/templates/${PRODUCT_ID}`
  );
  const templates = templateData.result.templates ?? [];
  console.log(`Total templates: ${templates.length}`);
  for (const t of templates.slice(0, 3)) {
    console.log(JSON.stringify(t, null, 2));
  }

  // Printfiles
  console.log("\n=== Printfiles ===");
  const pfData = await printfulFetch(
    `/mockup-generator/printfiles/${PRODUCT_ID}`
  );
  const printfiles = pfData.result.printfiles ?? [];
  for (const pf of printfiles) {
    console.log(
      `  Printfile ${pf.printfile_id}: ${pf.width}x${pf.height} | DPI: ${pf.dpi}`
    );
  }
}

main().catch(console.error);
