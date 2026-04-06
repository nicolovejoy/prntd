# Product Architecture

How PRNTD models products and how to extend the system.

## Core Concepts

### 1. Product = Config Object

A product is a data record, not a code path. Adding a product means adding a config entry to `src/lib/products.ts` — no `if` branches, no product-specific logic anywhere in the application. Every layer (pricing, mockups, fulfillment, UI) reads from the same `Product` definition and adapts automatically.

### 2. Design and Product Are Independent

A design is a standalone image. The user creates it first, then decides what to print it on. One design can become a tee, a poster, or a sticker — the design flow knows nothing about products. Product selection happens at preview time, not design time.

This decoupling is intentional: it means we never throw away creative work when the user changes their mind about the product.

### 3. Variant ID Is the Atom of Fulfillment

The entire Printful fulfillment chain collapses to a single integer: `product.variants[color][size]` → variant ID. That number tells Printful the product, the color, and the size. Everything upstream (product selector, color picker, size picker) exists to resolve to that one number.

### 4. Placement Is the Unit of Customization

A placement is a named slot on a product where a design can go: front, back, sleeve, label. Each placement has a position (coordinates within the print area) and an optional design image. Today every product has one implicit placement (front). The extension path is making placements explicit and plural.

### 5. Extend the Type, Not the Code

When a new capability is needed (multi-placement, print method, aspect ratio constraints), the pattern is always: add a field to `Product`, make the consuming code read it, update existing product configs. No product-specific branches.

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
  mockupPosition: MockupPosition;  // Where the design lands on the product
};
```

### Current Products

- **Classic Tee** (`bella-canvas-3001`) — Bella+Canvas 3001, unisex classic fit. 5 sizes, 13 colors. Flat pricing ($12.95 base).
- **Box Tee** (`cotton-heritage-mc1087`) — Cotton Heritage MC1087, oversized box fit. 7 sizes (S–4XL), 5 colors. Per-size pricing ($17.45–$23.45).

## How Products Flow Through the System

### Design Generation (`/design`)

Product-agnostic. The AI generates an image based on the user's description. The system prompt references a generic print area but doesn't know which product the design will go on.

### Preview (`/preview`)

Product-aware. Generates Printful mockups using the product's `mockupPosition` and `variants`. Mockups are cached per `{productId}:{colorName}` on the design record.

### Order (`/order`)

Product-aware for pricing and options. Reads `baseCost`, `sizes`, and `colors` from the selected product. Passes `productId` through to Stripe checkout and Printful submission.

### Pricing (`src/lib/pricing.ts`)

`(baseCost[size] + generationCost) × 1.5` margin multiplier, rounded up. Premium adds `premiumUpcharge` to `baseCost`. All values come from the product config.

### Printful Submission (`src/lib/printful.ts`)

Resolves `product.variants[color][size]` → variant ID, submits with the design image URL. Printful handles the rest.

## Adding a New Product

1. Run a variant discovery script against Printful's API. See `scripts/fetch-variants-mc1087.ts` for the pattern.
2. Add an entry to `PRODUCTS` in `src/lib/products.ts`.
3. Done. Pricing, fulfillment, and mockups work automatically. The UI needs a product selector to expose it.

## Extension Points

These aren't built yet. When they're needed, the approach is always: add a field to `Product`, read it where relevant.

### Placements

Today: one implicit front placement per product. Future: explicit array of named placements.

```typescript
placements: [
  { id: "front", name: "Front", position: {...}, required: true },
  { id: "back", name: "Back", position: {...}, required: false },
]
```

The design-product boundary still holds — the user creates designs, then assigns them to placements. An order could reference multiple designs (one per placement) or the same design on multiple placements.

### Print Method and Design Constraints

DTG, sublimation, screen print, offset — each has different constraints on what designs look good. If the product carried a `printMethod` field, the AI prompt could adapt ("this will be sublimation-printed — gradients and photographic images work well" vs "this is screen-printed — keep to 3-4 solid colors").

This would also affect image generation parameters: resolution, background handling, color space.

### Product-Specific Options

Not every product fits the `standard/premium` quality model. A poster might offer matte/glossy. A hoodie might offer zip/pullover. Stickers might have quantity tiers. The `premiumUpcharge` field would generalize into a list of named options with pricing impact.

### Aspect Ratio

Current designs are generated square-ish for the 12"×16" DTG print area. A poster needs a different ratio. The design generation step would need a target aspect ratio — derivable from `mockupPosition` or specified explicitly on the product.

