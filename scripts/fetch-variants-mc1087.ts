/**
 * Discover Cotton Heritage MC1087 variant IDs and mockup templates.
 *
 * Run with: source .env.local && npx tsx scripts/fetch-variants-mc1087.ts
 * Requires PRINTFUL_API_KEY env var.
 */

const PRINTFUL_API = "https://api.printful.com";
const PRODUCT_ID = 917; // Cotton Heritage MC1087

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
  // 1. Get product info and variants
  console.log(`Fetching product ${PRODUCT_ID} info...\n`);
  const productData = await printfulFetch(`/products/${PRODUCT_ID}`);
  const product = productData.result.product;
  const variants = productData.result.variants;

  console.log(`Product: ${product.title}`);
  console.log(`Type: ${product.type}`);
  console.log(`Variants: ${variants.length}\n`);

  // Group variants by color → size
  const byColor: Record<string, { size: string; id: number; price: string }[]> = {};
  for (const v of variants) {
    const color = v.color;
    if (!byColor[color]) byColor[color] = [];
    byColor[color].push({ size: v.size, id: v.id, price: v.price });
  }

  console.log("=== Variants by Color ===");
  for (const [color, sizes] of Object.entries(byColor)) {
    console.log(`\n  ${color}:`);
    for (const s of sizes) {
      console.log(`    ${s.size}: variant ${s.id} ($${s.price})`);
    }
  }

  // Output as TypeScript-ready map
  console.log("\n=== TypeScript Variant Map ===");
  console.log("const MC1087_VARIANTS = {");
  for (const [color, sizes] of Object.entries(byColor)) {
    const entries = sizes.map((s) => `"${s.size}": ${s.id}`).join(", ");
    console.log(`  "${color}": { ${entries} },`);
  }
  console.log("};");

  // 2. Get mockup templates
  console.log("\n=== Mockup Templates (first 3) ===");
  const templateData = await printfulFetch(
    `/mockup-generator/templates/${PRODUCT_ID}`
  );
  const templates = templateData.result.templates ?? [];
  console.log(`Total templates: ${templates.length}`);
  for (const t of templates.slice(0, 3)) {
    console.log(JSON.stringify(t, null, 2));
  }

  // 3. Get printfiles
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
