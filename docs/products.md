# Adding and updating products

The product catalog lives in `src/lib/products.ts` as a single `PRODUCTS` array. Every product (tee, phone case, anything else) is a config-only entry; preview, order, mockup, checkout, and Printful submission flows pick up new entries automatically.

This doc covers two scenarios:

1. **Adding a new product** — a fresh garment or accessory not in the catalog yet.
2. **Updating an existing product** — most commonly, adding new colors that Printful has but `products.ts` doesn't list.

## Prerequisites

- `PRINTFUL_API_KEY` in `.env.local` (or `op inject` from 1Password).
- Source the env before running scripts: `source .env.local`.
- Discovery scripts live in `scripts/`. They print TypeScript-ready snippets to copy into `products.ts`.

## Adding a new product

### 1. Find the Printful product ID

```
npx tsx scripts/fetch-printful-catalog.ts "search term"
```

Search Printful's public catalog. Returns matching products with their numeric IDs. Use a distinctive substring of the product name (`"box tee"`, `"clear case iphone"`, `"hoodie"`).

### 2. Pull variants, sizes, prices, and color hexes

```
npx tsx --env-file=.env.local scripts/fetch-variants.ts <productId>
```

Prints two snippets ready to paste:

- A `colors:` array (Printful's color name + hex).
- A `variants:` map keyed by color name → size → variant ID.

Plus a pricing summary showing every distinct price by size — needed for the `baseCost` field. If all sizes are the same price, use `{ "*": 12.95 }`. If prices vary by size (most large sizes cost more), enumerate per size: `{ S: 17.45, M: 17.45, "2XL": 19.45, "3XL": 21.45 }`.

### 3. Pull placement geometry

```
npx tsx --env-file=.env.local scripts/fetch-mockup-templates.ts <productId>
```

Prints the available placements (`front`, `back`, `default` for phone cases, etc.), template image dimensions, and printable area in inches/mm.

For the `placements[]` entry in the product config:

- `id` — the Printful placement key (`"front"`, `"back"`, `"default"`).
- `aspectRatio` — pick the closest value from the `AspectRatio` union in `products.ts` based on `print_area_width / print_area_height`. For a 12×16 inch print area, that's `"3:4"`. For a phone case 2.5×5.2, that's `"1:2"`. The image generator targets this aspect so designs fit without crops.
- `mockupPosition` — `area_width`, `area_height`, `width`, `height`, `top`, `left` come from the template dimensions. For a centered front placement on a tee, `top` and `left` shift the image into the chest area.
- `printArea` — the physical print region in inches.
- `required: true` — set on the primary placement that fulfillment needs.

### 4. Add the entry to `PRODUCTS`

Open `src/lib/products.ts`. Add a new object to the `PRODUCTS` array, alongside the existing tees and case. Required fields:

```ts
{
  id: "kebab-case-slug",          // your slug; used in URLs (?product=...)
  name: "Display Name",           // shown in the product chip on /preview
  description: "Short tagline",
  type: "shirt" | "phone-case",   // extend the union if adding a new category
  printfulProductId: 71,          // from step 1
  baseCost: { "*": 12.95 },       // from step 2
  sizes: ["S", "M", "L", "XL", "2XL"],
  sizeLabel: "Size",              // optional; defaults to "Size". Phone cases use "Model"
  colors: [/* from step 2 */],
  variants: {/* from step 2 */},
  placements: [/* from step 3 */],
  // Phase-1 mirrors of placements[0] — keep these in sync until print-targets Phase 4
  // removes the deprecated top-level fields:
  mockupPosition: /* same as placements[0].mockupPosition */,
  printArea: /* same as placements[0].printArea */,
}
```

The deprecated top-level `mockupPosition` and `printArea` mirror `placements[0]` — see the existing entries. Keep them in sync; print-targets Phase 4 will remove them.

### 5. Verify

- `npm run dev`, hit `/preview?id=<existingDesignId>&product=<newSlug>` — the product chip should appear, color picker should populate, default-size mockup should render within ~10s.
- Place a Stripe test-mode order against the new product and confirm Printful accepts the submission. The `feedback_test_orders` memory has the full per-order checklist.

## Updating an existing product

The most common case: Printful added new colors and the catalog entry doesn't reflect them yet.

### 1. Re-pull variants

```
npx tsx --env-file=.env.local scripts/fetch-variants.ts <productId>
```

### 2. Diff against the current catalog entry

Compare the script's `colors:` and `variants:` output to what's in `products.ts` for that product. Add any missing color entries to both `colors` and `variants`. Don't delete colors Printful no longer offers without checking past orders first — old orders may reference those variant IDs.

### 3. Verify

- `/preview` should show the new color swatches.
- Click each new color — first render is on-demand (Printful mockup task) and takes a few seconds; subsequent renders are cached. The `ensureMockupsPrefetched` hook on `/preview` will warm the cache for new colors over the next minute.
- Place a test order against a new color to confirm fulfillment works end-to-end.

### 4. Updating prices, placements, or other fields

Same pattern: re-run the relevant script (`fetch-variants.ts` for prices, `fetch-mockup-templates.ts` for placement geometry), update the entry, verify with a test order. Be especially careful with placement geometry — a wrong `mockupPosition` will mis-align designs on every mockup until corrected.

## Reference

- `src/lib/products.ts` — catalog + helpers (`getProduct`, `getVariantId`, `getColorHex`, `getDefaultPlacement`, `needsAspectRegeneration`).
- `scripts/fetch-printful-catalog.ts` — search the catalog by name.
- `scripts/fetch-variants.ts` — variants + colors + pricing for any product ID.
- `scripts/fetch-mockup-templates.ts` — placements + dimensions for any product ID.
- The per-product `scripts/fetch-variants-*.ts` files are historical artifacts from each product's onboarding. Use the generic `fetch-variants.ts` going forward.
