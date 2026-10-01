# Adding and updating products

The product catalog lives in `src/lib/blanks.ts` as a single `BLANKS` array. Every product (tee, phone case, anything else) is a config-only entry; preview, order, mockup, checkout, and Printful submission flows pick up new entries automatically.

This doc covers two scenarios:

1. **Adding a new product** — a fresh garment or accessory not in the catalog yet.
2. **Updating an existing product** — most commonly, adding new colors that Printful has but `blanks.ts` doesn't list.

## Prerequisites

- No API key is needed for `fetch-variants.ts` or `check-blank-variants.ts`: Printful's `/products/{id}` endpoint is public. `PRINTFUL_API_KEY` is sent when set and ignored otherwise. Other scripts in `scripts/` may still need it.
- Discovery scripts live in `scripts/`. They print TypeScript-ready snippets to copy into `blanks.ts`.

## Adding a new product

### 1. Find the Printful product ID

```
npx tsx scripts/fetch-printful-catalog.ts "search term"
```

Search Printful's public catalog. Returns matching products with their numeric IDs. Use a distinctive substring of the product name (`"box tee"`, `"clear case iphone"`, `"hoodie"`).

### 2. Pull variants, sizes, prices, and color hexes

```
npx tsx scripts/fetch-variants.ts <productId>
```

Prints two snippets ready to paste:

- A `colors:` array (Printful's color name + hex).
- A `variants:` map keyed by color name → size → variant ID.

Plus a pricing summary showing every distinct price by size — needed for the `baseCost` field. If all sizes are the same price, use `{ "*": 12.95 }`. If prices vary by size (most large sizes cost more), enumerate per size: `{ S: 17.45, M: 17.45, "2XL": 19.45, "3XL": 21.45 }`.

### 3. Pull placement geometry

```
npx tsx scripts/fetch-mockup-templates.ts <productId>
```

Prints the available placements (`front`, `back`, `default` for phone cases, etc.), template image dimensions, and printable area in inches/mm.

For the `placements[]` entry in the product config:

- `id` — the Printful placement key (`"front"`, `"back"`, `"default"`).
- `aspectRatio` — pick the closest value from the `AspectRatio` union in `blanks.ts` based on `print_area_width / print_area_height`. For a 12×16 inch print area, that's `"3:4"`. For a phone case 2.5×5.2, that's `"1:2"`. The image generator targets this aspect so designs fit without crops.
- `mockupPosition` — `area_width`, `area_height`, `width`, `height`, `top`, `left` come from the template dimensions. For a centered front placement on a tee, `top` and `left` shift the image into the chest area.
- `printArea` — the physical print region in inches.
- `required: true` — set on the primary placement that fulfillment needs.

### 4. Add the entry to `BLANKS`

Open `src/lib/blanks.ts`. Add a new object to the `BLANKS` array, alongside the existing tees and case. Required fields:

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
npx tsx scripts/fetch-variants.ts <productId>
```

### 2. Diff against the current catalog entry

Compare the script's `colors:` and `variants:` output to what's in `blanks.ts` for that product. Add missing colors to both `colors` and `variants`. Don't delete or rename colors Printful no longer offers: old orders reference them by name, and `resolveOrderVariant` needs them to resolve.

Colour rules (decision 8, 2026-09-28):

- **Only add a color that has a variant for every size the product sells**, each in stock for the US (`in_stock` true and a `US` entry with status `in_stock` in `availability_status`). A color missing a size, or out of stock in one, is skipped. Printful's response has no discontinued flag; a variant that disappears from the response is how discontinuation shows up (the checker below reports it).
- Hex comes from Printful's `color_code`; `color_code2` (heathers) is ignored.
- Order in the file does not matter: `BLANKS` sorts each shirt's `colors` light to dark (`sortLightToDark`: relative luminance, name as tiebreak), so every picker and list reads the same order. `colors[0]` is the default in several places and is White for every shirt.
- `BACKGROUND_PALETTE` (the publish backdrop list) is a pinned literal of 25 colors, not derived from the Classic Tee. New shirt colors do not appear in it; `blanks-colors.test.ts` fails if it changes.
- New colors use the product's existing `baseCost` / `retailPrice`. If Printful prices a color differently for a size we sell, don't add it without deciding the price.
- `prefetchProductMockups` sends one bulk Printful mockup task per `/preview` load, for the colors in the blank's `prefetchColors` (all colors when unset). The Classic Tee lists its original 25 so the task stays that size. A new color is not prefetched unless you add it to `prefetchColors`; it renders on demand when picked. Keep White (the default) in the list.

Check that every variant id in `blanks.ts` is still listed by Printful (read-only; exits 1 on any missing or mismatched id, out-of-stock is only a warning):

```
npx tsx scripts/check-blank-variants.ts
```

### 3. Verify

- `/preview` should show the new color swatches.
- Click each new color — first render is on-demand (Printful mockup task) and takes a few seconds; subsequent renders are cached. New colors outside `prefetchColors` are not warmed by the `/preview` prefetch (`ensureMockupsPrefetched`), so expect that wait on every first pick per design.
- Place a test order against a new color to confirm fulfillment works end-to-end.

### 4. Updating prices, placements, or other fields

Same pattern: re-run the relevant script (`fetch-variants.ts` for prices, `fetch-mockup-templates.ts` for placement geometry), update the entry, verify with a test order. Be especially careful with placement geometry — a wrong `mockupPosition` will mis-align designs on every mockup until corrected.

## Reference

- `src/lib/blanks.ts` — catalog + helpers (`getProduct`, `getVariantId`, `getColorHex`, `getDefaultPlacement`, `needsAspectRegeneration`).
- `scripts/fetch-printful-catalog.ts` — search the catalog by name.
- `scripts/fetch-variants.ts` — variants + colors + pricing for any product ID.
- `scripts/check-blank-variants.ts` — checks every variant id in `blanks.ts` against Printful's public catalogue.
- `scripts/fetch-mockup-templates.ts` — placements + dimensions for any product ID.
- The per-product `scripts/fetch-variants-*.ts` files are historical artifacts from each product's onboarding. Use the generic `fetch-variants.ts` going forward.
