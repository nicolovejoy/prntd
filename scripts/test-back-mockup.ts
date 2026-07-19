/**
 * 2.0 smoke test (#25): does Printful actually render a BACK mockup with the
 * `back` placement key + geometry we put in products.ts? Renders the front
 * (control) and the back for one shirt and prints both mockup URLs to eyeball
 * — no app, no order, just the catalog data + createMockupTask against live
 * Printful. Validates the key/geometry before 2.1 builds UI on top.
 *
 * Run (PRINTFUL_API_KEY comes from the env file):
 *   npx tsx --env-file=.env.local scripts/test-back-mockup.ts
 *
 * Optional args: [productId] [color] [size] [imageUrl]
 *   npx tsx --env-file=.env.local scripts/test-back-mockup.ts bella-canvas-6400 Black M
 */
import { getBlankOrThrow, getVariantId, getPlacement } from "../src/lib/blanks";
import { createMockupTask, pollMockupTask } from "../src/lib/printful";

const productId = process.argv[2] ?? "bella-canvas-3001";
const color = process.argv[3] ?? "Black";
const size = process.argv[4] ?? "M";
const imageUrl =
  process.argv[5] ??
  "https://pub-7389d029733346daa7c3196cad2f5288.r2.dev/designs/6f5599a3-9736-40a9-903f-892e66de5cf2/1.png";

async function render(placementId: string) {
  const product = getBlankOrThrow(productId);
  const variantId = getVariantId(product, color, size);
  if (!variantId) throw new Error(`No variant for ${color}/${size} on ${productId}`);
  const placement = getPlacement(product, placementId);
  console.log(
    `\n[${placementId}] printfulProduct=${product.printfulProductId} variant=${variantId} ` +
      `area=${placement.mockupPosition.area_width}x${placement.mockupPosition.area_height}`
  );
  const taskKey = await createMockupTask(
    product.printfulProductId,
    [variantId],
    imageUrl,
    placement.mockupPosition,
    placement.id
  );
  const results = await pollMockupTask(taskKey);
  for (const r of results) console.log(`  ${placementId} mockup → ${r.mockupUrl}`);
}

async function main() {
  console.log(`Mockup smoke test: ${productId} ${color}/${size}`);
  console.log(`Design image: ${imageUrl}`);
  await render("front"); // control
  await render("back");
  console.log(
    "\nOpen both URLs: the same design should appear on the FRONT in the first" +
      " and on the BACK in the second. If back errors or lands wrong, the back" +
      " placement geometry/key needs fixing before 2.1."
  );
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
