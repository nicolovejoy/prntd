/**
 * 2.3 discovery (#25): what does Printful charge for an additional BACK print?
 * Calls the live Orders API `/orders/estimate-costs` twice for the same
 * variant — front-only vs front+back — and prints the cost breakdowns + the
 * total delta. That delta is the real additional-placement fee that
 * BACK_PLACEMENT_COST (the customer upcharge) should be set from.
 *
 * Estimate-costs does NOT place an order — it's a dry pricing call.
 *
 * Run (PRINTFUL_API_KEY comes from the env file):
 *   npx tsx --env-file=.env.local scripts/estimate-back-cost.ts
 *
 * Optional args: [productId] [color] [size] [frontUrl] [backUrl]
 *   npx tsx --env-file=.env.local scripts/estimate-back-cost.ts bella-canvas-6400 Black M
 */
import { getProductOrThrow, getVariantId } from "../src/lib/products";

const productId = process.argv[2] ?? "bella-canvas-3001";
const color = process.argv[3] ?? "Black";
const size = process.argv[4] ?? "M";
const frontUrl =
  process.argv[5] ??
  "https://pub-7389d029733346daa7c3196cad2f5288.r2.dev/designs/6f5599a3-9736-40a9-903f-892e66de5cf2/1.png";
const backUrl = process.argv[6] ?? frontUrl;

const recipient = {
  name: "Estimate Test",
  address1: "11025 Westlake Dr",
  city: "Charlotte",
  state_code: "NC",
  country_code: "US",
  zip: "28273",
};

async function estimate(
  variantId: number,
  files: { type: string; url: string }[]
) {
  const res = await fetch("https://api.printful.com/orders/estimate-costs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient,
      items: [{ variant_id: variantId, quantity: 1, files }],
    }),
  });
  if (!res.ok) {
    throw new Error(`estimate-costs ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.result.costs as Record<string, string | number>;
}

async function main() {
  const product = getProductOrThrow(productId);
  const variantId = getVariantId(product, color, size);
  if (!variantId)
    throw new Error(`No variant for ${color}/${size} on ${productId}`);

  console.log(
    `${product.name} (${productId}) variant=${variantId} ${color}/${size}\n`
  );

  const frontOnly = await estimate(variantId, [{ type: "default", url: frontUrl }]);
  const frontBack = await estimate(variantId, [
    { type: "default", url: frontUrl },
    { type: "back", url: backUrl },
  ]);

  console.log("front-only costs:", JSON.stringify(frontOnly, null, 2));
  console.log("\nfront+back costs:", JSON.stringify(frontBack, null, 2));

  const d = (k: string) =>
    Number(frontBack[k] ?? 0) - Number(frontOnly[k] ?? 0);
  console.log(
    `\nDELTA  total=$${d("total").toFixed(2)}  subtotal=$${d("subtotal").toFixed(2)}  ` +
      `additional_fee=$${d("additional_fee").toFixed(2)}  fulfillment_fee=$${d("fulfillment_fee").toFixed(2)}`
  );
  console.log(
    `\n→ Back-print COGS basis = the SUBTOTAL delta ($${d("subtotal").toFixed(2)}, ` +
      `destination-independent). The total delta also folds in incremental tax ` +
      `($${(d("total") - d("subtotal")).toFixed(2)}) that varies by address. Set the ` +
      `customer upcharge (BACK_PLACEMENT_UPCHARGE) above the subtotal basis for margin.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
