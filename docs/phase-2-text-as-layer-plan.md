# Phase 2 — Text-as-layer

Implementation plan for the heaviest phase of the design-loop rethink.

Source of truth for the broader plan:
`/Users/nico/.claude/plans/feedback-for-the-coding-woolly-snowflake.md`

Phases shipped before this one:

- Phase 0 — Ideogram native-transparent swap (commit `cf5f93f`)
- Phase 1 — Negation rewriting in chat advisor system prompt (commit `9647622`)
- Phase 4 — Doc updates to `design-loop-rethink.md` (commit `26f2b88`)

## Goal

Text in finished designs is rendered by the app as a deterministic layer composited on top of the AI illustration. Solves the "asked for solid black, got bubble letters" failure class by removing text from the image model's responsibilities.

AI-rendered text remains available as an opt-in escape hatch (set per generation).

## Non-goals (do not scope-creep)

- Multi-text element layouts. v1 = single text element only. Stored as `[layer]` array for forward compatibility.
- Inpainting / mask edits / region select.
- Font auto-syncing or runtime font upload by users.
- A general-purpose layer compositor — only what's needed for one illustration + one text layer.
- Migrating off `@anthropic-ai/sdk` or changing the model stack.

## Locked decisions (do not relitigate)

- Compositing engine: `@vercel/og` (Satori) for text-only render → `sharp` for composite. Server-side. No browser/canvas dependency.
- Font catalog: Google Fonts only. License non-issue per user. ~6–8 fonts grouped by intent.
- Text scope v1: single text element.
- State storage: new `textLayers` JSON column on `design_image` (per-generation provenance).
- Print resolution: 12×16 in × 300 dpi → 3600×4800 for tee front. Per-product via `Product.printArea`.
- Phone-first stacked column layout for the text controls.

## Files to touch (current repo paths verified)

### Schema

- `src/lib/db/schema.ts` — add `textLayers` column to `designImage` (line 61–78 today).
- Migration: `npm run db:push` (Drizzle-Kit pushes to Turso directly, no migration file).
- Existing rows have `textLayers = null` cleanly (column nullable).

### New modules

- `src/lib/text-layers.ts` — type definitions for `TextLayer`.
- `src/lib/fonts.ts` — curated catalog (6–8 fonts), grouping by intent.
- `src/lib/composite.ts` — `composeWithText(illustrationUrl, textLayers, printAreaSize)` returning a `Buffer`.

### Touched server actions

- `src/app/design/actions.ts` — `generateDesign()` (line 63–154). After the existing
  `generateTransparent` + R2 upload + `insertDesignImage` chain, if `textLayers` is non-empty
  and `useNativeText` is true, run `composeWithText`, upload composited PNG, write a *child*
  `design_image` row whose `parentImageId` is the raw, set `currentImageUrl` to the composite.
- `src/app/design/actions.ts` — new action `updateTextLayer(designImageId, layer)`. No AI call;
  re-composes from the parent illustration + new layer, writes new child design_image, updates
  `design.currentImageUrl`.

### Touched UI

- `src/app/design/page.tsx` — mount text-layer panel conditionally when an image is selected
  in the gallery / lightbox.
- `src/app/design/text-layer-panel.tsx` (new) — text controls component.
- `src/app/design/text-preview.tsx` (new) — client-side live preview overlay (CSS positioning
  + `next/font/google`); commits via `updateTextLayer`.

### Print export

No changes needed in `src/lib/printful.ts` or webhook order submission. They consume
`design.currentImageUrl` (or `order.placements.front` → design_image lookup), which by then
points at the composited PNG.

## Schema additions

```ts
// In src/lib/db/schema.ts, designImage table
textLayers: text("text_layers", { mode: "json" }).$type<TextLayer[] | null>(),
```

```ts
// src/lib/text-layers.ts
export type TextLayer = {
  text: string;             // <= 20 chars for tee front (UI-enforced)
  font: string;             // Google Font family name (must be in catalog)
  weight: number;           // 400 / 600 / 700 / 800
  color: string;            // hex, e.g. "#000000"
  layout: "top" | "bottom" | "center" | "arched-top" | "arched-bottom";
  scale: number;            // 0.1–1.0; fraction of design width
};
```

## Font catalog (initial)

```ts
// src/lib/fonts.ts
export const FONT_CATALOG = [
  { family: "Bebas Neue",       intent: "Bold Block",       weights: [400] },
  { family: "Anton",            intent: "Bold Block",       weights: [400] },
  { family: "Oswald",           intent: "Bold Block",       weights: [700] },
  { family: "Lobster",          intent: "Vintage Script",   weights: [400] },
  { family: "Pacifico",         intent: "Vintage Script",   weights: [400] },
  { family: "Permanent Marker", intent: "Hand-lettered",    weights: [400] },
  { family: "Caveat",           intent: "Hand-lettered",    weights: [700] },
  { family: "Inter",            intent: "Clean Modern",     weights: [700] },
] as const;
```

Client side: load via `next/font/google` for live preview. Server side: bundle `.ttf` files in
the repo (or use `@vercel/og`'s built-in font fetching) for Satori rendering.

## Compositing function

```ts
// src/lib/composite.ts
export async function composeWithText(
  illustrationUrl: string,
  textLayers: TextLayer[],
  printAreaSize: { width: number; height: number },
): Promise<Buffer>;
```

Steps:

1. Fetch illustration buffer from R2 (`fetch().arrayBuffer()`).
2. For each layer, render text-only PNG via `@vercel/og` `ImageResponse` Satori at print
   resolution. Returns RGBA PNG.
3. Composite layers over illustration with `sharp.composite([{ input: textPng, top, left }])`.
   Position derived from `layout`:
   - `top` → near top of frame (vertical offset 5–10% of design height).
   - `bottom` → near bottom (~85–90%).
   - `center` → centered.
   - `arched-top` / `arched-bottom` → SVG path text in the Satori template before rasterizing.
4. Return final RGBA PNG buffer.

Resolution targets pulled from `Product.printArea` × 300 dpi:

- Tee front: 3600 × 4800.
- Phone case: 750 × 1560 (2.5 × 5.2 in × 300 dpi).

## Server action wiring

In `generateDesign()`, after the existing `insertDesignImage` call (~line 141 today):

```ts
if (textLayers && textLayers.length > 0 && !useAiText) {
  const composedBuffer = await composeWithText(r2Url, textLayers, product.printArea);
  const composedR2Url = await uploadDesignImage(designId, newGeneration, composedBuffer, "composite");
  await insertDesignImage({
    designId,
    imageUrl: composedR2Url,
    aspectRatio: "1:1",
    prompt: aiResponse.fluxPrompt,
    generationCost: 0,
    productId: null,
    placementId: null,
    // textLayers field on the new row stores the layers used
  });
  finalImageUrl = composedR2Url;
}
```

Note: `uploadDesignImage` in `src/lib/r2.ts` may need a third overload taking a `kind`
discriminator ("composite" vs "generation") so composite filenames don't collide with the
existing per-generation naming. Check `src/lib/r2.ts:uploadDesignImage` before assuming.

`updateTextLayer(designImageId, layer)` action:

1. Look up the design_image row, follow `parentImageId` to the raw illustration row.
2. `composeWithText(rawUrl, [layer], printArea)`.
3. Upload as a new design_image (parent = raw illustration, not the previous composite —
   keeps the chain shallow).
4. Update `design.currentImageUrl` to the new composite.

## UI

A "Customize text" panel visible when a design is selected. Lives below the chat composer on
phone, beside the gallery on desktop.

Inputs (all phone-tappable):

- **Text field** — single line, char limit ~20 enforced live.
- **Font picker** — chips grouped by intent (Bold Block, Vintage Script, Hand-lettered,
  Clean Modern). Tapping a chip changes preview instantly.
- **Weight toggle** — Regular / Bold / Heavy (only shown when font has multiple weights).
- **Color picker** — limited palette (Black, White, Red, Yellow, Blue, custom hex via expand).
- **Layout chips** — Top / Bottom / Center / Arched-top / Arched-bottom.
- **Scale slider** — 30% – 100%.
- **Use AI-rendered text instead** — toggle. When on, the panel collapses and the next
  generation goes through the original "text inside the image" path. Text-layer state still
  stored for round-tripping if the user toggles back.

Live preview: client-side overlay using the same Google Font (`next/font/google`) and
absolute-positioned `<span>` over the gallery image. Commits via `updateTextLayer` server
action when the user taps "Apply" — re-composes server-side at full print resolution.

Keep the chat composer at the top; text panel below the gallery on phone, in a sidebar on
desktop.

## Verification

### Unit tests

- `composeWithText` — snapshot a known illustration + layer → known output buffer.
- Font catalog / type check — every font in catalog has a Satori-loadable file or fetch URL.
- `updateTextLayer` — re-composes from raw, not the previous composite (provenance shallow).

### Manual / local

- Start dev. Generate a design with text. Open text panel; toggle each font, weight, color,
  layout, scale. Confirm live preview matches eventual server-side composite within
  pixel-perfect accuracy for position and reasonably close on rasterization.
- Toggle "AI-rendered text" → confirm next generation goes through the text-in-image path
  and the layer panel hides.
- Switch to iPhone case in `/preview`. Confirm the text layer survives `regenerateForPlacement`
  (chain: raw illustration regenerated at 1:2; text layer re-composited at 1:2 print area).

### Production smoke

- One real test-mode order with text "BEST BOY". Confirm:
  - Text renders deterministically (font/color/position match preview).
  - Print resolution adequate (zoom into Printful submission preview).
  - Composited PNG URL flows through to Printful (PRINTFUL_DRY_RUN logs confirm).
- One real live-mode order with a known short text. Compare shipped shirt against on-screen
  design.

## Effort

~1 week of focused work. Heaviest phase by far. Don't downsize on grounds of "keep it simple"
— the complexity is the price of permanently retiring the loudest failure mode.

Realistic order within the week:

1. Day 1 — schema + types + R2 upload helper update + composite skeleton with one font.
2. Day 2 — full font catalog + `composeWithText` for all layout modes + unit tests.
3. Day 3 — server action wiring (`generateDesign` + `updateTextLayer`) + integration tests.
4. Day 4 — text-layer panel UI + live preview + apply round-trip.
5. Day 5 — `/preview` integration (text survives product switch + regenerateForPlacement).
6. Day 6 — verification, real-order smoke tests, doc updates.
7. Buffer day — Satori font edge cases, sharp resolution mismatches, mobile layout polish.

## Risks & mitigations

- **Satori arched-text quality.** SVG path text in Satori may render uneven. Mitigation: ship
  Top / Bottom / Center first; arched as a stretch target inside the same week.
- **Live preview drift.** Client `next/font/google` and server-side Satori may disagree on
  baseline / kerning by a pixel or two. Mitigation: the server-side composite is the source
  of truth; preview is approximate. UI should label preview as "approximate" if drift is
  visible.
- **R2 storage growth.** Each text-bearing generation now writes 2 PNGs (raw + composite).
  Mitigation: TTL on raw illustrations after the design ships? Out of scope for v1; track if
  storage cost becomes meaningful.
- **Provenance chain depth.** If `updateTextLayer` is called repeatedly, naive impl could
  chain composite → composite → composite. Plan re-composites from `parentImageId` (the raw
  illustration) every time — keeps chain depth = 2.
- **Cross-product regen.** When `regenerateForPlacement` fires, the new illustration is at a
  different aspect. The text layer must re-composite at the new print-area dimensions. The
  function's existing flow already updates `currentImageUrl`; need to fold the text-composite
  step into it the same way `generateDesign` does.

## Out-of-scope follow-ups (file as GH issues if needed during build)

- Multi-text element support.
- Custom font upload by users.
- Gradient / outlined / stroked text.
- Curve-along-arbitrary-path text.
- Text alignment within a chosen line (left/center/right inside the box).

## Dependencies to install

- `@vercel/og` — Satori wrapper.
- `sharp` — already in repo? Check `package.json`. If not present, install (it's a
  Vercel-supported native module).

Verify with `npm ls @vercel/og sharp` before starting.
