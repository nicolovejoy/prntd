# Product Architecture

How PRNTD models products and how to extend the system for new product types.

## Design Principles

1. **Config-driven catalog** — adding a product means adding a config object, not changing application logic. Pricing, sizes, colors, variant IDs, and print positioning all live in the product definition.
2. **Design-first, product-second** — the user creates a design (an image), then chooses what to put it on. A single design can be applied to multiple products. The design flow is product-agnostic; product selection happens at preview/order time.
3. **Printful as fulfillment layer** — every product maps to a Printful product ID and variant matrix. PRNTD doesn't hold inventory or manage shipping directly.
4. **Extensibility over completeness** — the Product type has the fields needed today. New capabilities (multi-placement, print method constraints, aspect ratio requirements) get added to the type when they're needed, not speculatively.

## Product Definition

Defined in `src/lib/products.ts`. The `PRODUCTS` array is the single source of truth.

```typescript
type Product = {
  id: string;                // Stable identifier (e.g. "bella-canvas-3001")
  name: string;              // Display name
  description: string;       // Short tagline
  printfulProductId: number; // Printful's catalog ID
  baseCost: Record<string, number>;  // Size → cost, or "*" for flat pricing
  premiumUpcharge: number;   // Added for "premium" quality tier
  sizes: string[];           // Available sizes in display order
  colors: ProductColor[];    // Available colors with hex values for UI
  variants: Record<string, Record<string, number>>;  // color → size → Printful variant ID
  mockupPosition: MockupPosition;  // Where the design lands on the product mockup
};
```

### Current Products

- **Classic Tee** (`bella-canvas-3001`) — Bella+Canvas 3001, unisex classic fit. 5 sizes, 13 colors. Flat pricing ($12.95 base).
- **Box Tee** (`cotton-heritage-mc1087`) — Cotton Heritage MC1087, oversized box fit. 7 sizes (S–4XL), 5 colors. Per-size pricing ($17.45–$23.45).

## How Each Layer Uses Products

### Design Generation (`/design`)

Product-agnostic. The AI generates a standalone image based on the user's description. The system prompt references a generic print area (12"×16" DTG) but doesn't know which product the design will go on.

**Future extension:** pass product context to the AI so it can tailor prompts (e.g., "this will be screen-printed on a poster" vs "DTG on cotton"). This would mean selecting a product *before* designing, or re-generating when the product changes. Not needed yet — all current products use the same print method and similar dimensions.

### Preview (`/preview`)

Product-aware. Generates Printful mockups using the product's `mockupPosition` and `variants`. Mockups are cached per `{productId}:{colorName}` on the design record.

**Current gap:** no product selector UI — defaults to Classic Tee. Next step is adding a product picker here.

### Order (`/order`)

Product-aware for pricing and checkout. Uses the product's `baseCost`, `sizes`, and `colors` to render options and calculate price. Passes `productId` to the Stripe checkout session and through to Printful fulfillment.

**Current gap:** sizes and colors in the UI are still partially hardcoded. Need to read from the selected product's config.

### Printful Submission (`src/lib/printful.ts`)

Fully product-driven. The variant ID (from `product.variants[color][size]`) tells Printful exactly what to produce. The mockup generator uses `product.mockupPosition` for design placement.

### Pricing (`src/lib/pricing.ts`)

Reads `baseCost` and `premiumUpcharge` from the product config. Formula: `(baseCost + generationCost) × 1.5` margin multiplier, rounded up.

## Adding a New Product

1. Run a variant discovery script against Printful's API to get variant IDs, available colors/sizes, and mockup template dimensions. See `scripts/fetch-variants-mc1087.ts` for the pattern.

2. Add an entry to `PRODUCTS` in `src/lib/products.ts`:
   ```typescript
   {
     id: "unique-slug",
     name: "Display Name",
     printfulProductId: 123,
     baseCost: { "*": 8.95 },  // or per-size
     premiumUpcharge: 0,
     sizes: ["S", "M", "L"],
     colors: [{ name: "White", value: "#ffffff" }],
     variants: { White: { S: 1001, M: 1002, L: 1003 } },
     mockupPosition: { area_width: 1800, area_height: 2400, width: 1800, height: 1800, top: 300, left: 0 },
   }
   ```

3. That's it for the backend. The pricing, order submission, and fulfillment flows pick up the new product automatically. The UI needs a product selector to expose it to users.

## Future: Non-Apparel Products

The current model assumes single-placement DTG printing on fabric. Extending to posters, stickers, hoodies, or canvas prints will require evolving the `Product` type. Likely additions:

**Placements** — products with multiple print areas (front/back, left chest, sleeve). The `mockupPosition` field would become an array of named placements, each with its own position and optional design.

```typescript
placements: [
  { id: "front", name: "Front", position: {...}, required: true },
  { id: "back", name: "Back", position: {...}, required: false },
]
```

**Print method** — DTG, sublimation, screen print, offset. Affects AI prompt constraints (what looks good), Printful file requirements (DPI, format), and pricing.

**Aspect ratio / dimensions** — a poster design shouldn't be square; a sticker might be die-cut. The design generation step would need to know the target aspect ratio. Could be derived from `mockupPosition` or specified explicitly.

**Quality tiers** — not every product needs standard/premium. Some might have material variants (matte/glossy poster, heavyweight/lightweight hoodie). The `quality` enum and `premiumUpcharge` field may need to generalize into a list of options with pricing.

**Quantity pricing** — stickers and posters often have volume discounts. The flat `baseCost` would need a quantity-aware pricing function.

None of these are needed now. When they are, the pattern is: add the field to `Product`, make the consuming code read it, and update existing product configs. The config-driven approach means no product-specific `if` branches in application code.

## What's Built vs. Planned

### Built
- Config-driven product catalog with full Printful variant mapping
- Two products: Classic Tee (13 colors) and Box Tee (5 colors)
- Product-aware pricing, mockup generation, and order submission
- Mockup caching per product/color combination
- Per-size and flat pricing models

### In Progress
- Product selector UI on preview page
- Dynamic color/size options from product config (removing hardcoded lists)
- Wire product selection through full preview → order → checkout flow

### Planned
- Product expansion: posters, canvas prints, stickers, hoodies
- Multi-placement support (front/back printing)
- Product-aware AI prompts
- Discount codes (Stripe promotion codes)
