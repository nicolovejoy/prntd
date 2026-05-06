/**
 * Discover variant IDs, sizes, prices, and colors for any Printful product.
 *
 * Run with: npx tsx --env-file=.env.local scripts/fetch-variants.ts <productId>
 * Example:  npx tsx --env-file=.env.local scripts/fetch-variants.ts 71
 *
 * Requires PRINTFUL_API_KEY env var.
 *
 * Output is structured for copy-paste into src/lib/products.ts:
 *   - The "colors" array (name + hex from Printful)
 *   - The "variants" map (color → size → variantId)
 *   - Pricing summary by size
 *
 * To find a product ID first, search the catalog:
 *   npx tsx scripts/fetch-printful-catalog.ts "search term"
 */

const PRINTFUL_API = "https://api.printful.com";

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
  const productIdArg = process.argv[2];
  if (!productIdArg) {
    console.error("Usage: npx tsx scripts/fetch-variants.ts <productId>");
    console.error(
      "Find product IDs with: npx tsx scripts/fetch-printful-catalog.ts <search>"
    );
    process.exit(1);
  }
  const productId = parseInt(productIdArg, 10);
  if (Number.isNaN(productId)) {
    console.error(`Invalid product ID: ${productIdArg}`);
    process.exit(1);
  }

  console.log(`Fetching product ${productId}...\n`);
  const data = await printfulFetch(`/products/${productId}`);
  const product = data.result.product;
  const variants = data.result.variants;

  console.log(`Product: ${product.title}`);
  console.log(`Type: ${product.type_name}`);
  console.log(`Variants: ${variants.length}\n`);

  // Group variants by color → size
  type Variant = {
    size: string;
    id: number;
    price: string;
    color_code: string;
  };
  const byColor: Record<string, Variant[]> = {};
  for (const v of variants) {
    if (!byColor[v.color]) byColor[v.color] = [];
    byColor[v.color].push({
      size: v.size,
      id: v.id,
      price: v.price,
      color_code: v.color_code,
    });
  }

  // Colors array — copy into PRODUCTS[].colors
  console.log("=== colors (copy into products.ts) ===");
  console.log("colors: [");
  for (const [color, sizes] of Object.entries(byColor)) {
    const hex = sizes[0]?.color_code ?? "#cccccc";
    console.log(`  { name: "${color}", value: "${hex}" },`);
  }
  console.log("],");

  // Variants map — copy into PRODUCTS[].variants
  console.log("\n=== variants (copy into products.ts) ===");
  console.log("variants: {");
  for (const [color, sizes] of Object.entries(byColor)) {
    const entries = sizes
      .map((s) => `"${s.size}": ${s.id}`)
      .join(", ");
    console.log(`  "${color}": { ${entries} },`);
  }
  console.log("},");

  // Pricing summary
  console.log("\n=== Pricing by Size ===");
  const priceBySize: Record<string, Set<string>> = {};
  for (const sizes of Object.values(byColor)) {
    for (const s of sizes) {
      if (!priceBySize[s.size]) priceBySize[s.size] = new Set();
      priceBySize[s.size].add(s.price);
    }
  }
  for (const [size, prices] of Object.entries(priceBySize)) {
    const list = [...prices].sort();
    console.log(
      `  ${size}: ${list.length === 1 ? "$" + list[0] : "$" + list.join(", $")}`
    );
  }

  console.log(
    `\nNext: run 'npx tsx scripts/fetch-mockup-templates.ts ${productId}' for placement geometry.`
  );
}

main().catch(console.error);
