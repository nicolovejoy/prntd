# Print Targets — Implementation Plan

Companion to `docs/print-targets.md`. The design doc describes *what* and *why*; this is *how* and *in what order*. Each phase is independently shippable and verifiable.

## Constraints

- Solo dev, no PRs (push direct to main per `feedback_pr_workflow`).
- Every shipped phase verified with a real test-mode order per `feedback_test_orders`.
- Phone-first: every UI change validated on iPhone Safari before declaring done.
- ~15 historical orders to backfill. Cheap, do it carefully.
- Existing customers (Knute) get no regressions: their `/orders` page must keep showing their order.

## Phase 1 — Aspect-correct generation (no schema change) — SHIPPED 2026-05-02

**Goal:** stop the iPhone-case crop bug. New orders generate at the right aspect for the picked product. Existing data model unchanged.

Status: implemented and committed. Pending real-world verification with a test-mode iPhone case order.

### Changes

1. **`src/lib/products.ts`** — add `placements` array to the `Product` type. Each placement carries `id`, `aspectRatio` (Ideogram enum value), `printArea`, `mockupPosition`, `required` boolean. Backfill all current products with one front placement each. Move existing `mockupPosition` and `printArea` fields onto the placement.
2. **`src/lib/replicate.ts`** — `generateImage` takes an optional `aspectRatio` param (default `"1:1"`).
3. **`/preview` server action** — when the user picks a product whose front-placement aspect ≠ `"1:1"`, kick off a regeneration at the placement aspect. Update `design.currentImageUrl` to the new render. Show "preparing for {productName}…" affordance with a spinner.
4. **`/preview` UX** — keep the previous (1:1) image visible alongside the new render with a small "original" / "for this product" caption so the user understands what changed.
5. Update `docs/products.md` to reflect the placement field on `Product`.

### Verification

- Place a real test-mode order for an iPhone case. Confirm the design fits the case aspect end-to-end (Ideogram render, /preview mockup, Printful submission, shipped product ideally — or at least the Printful preview after submission).
- Place a tee order. Confirm it still works and the new 4:5 aspect doesn't break the existing mockup composition.
- Knute's existing /orders view still renders correctly (no schema change so this should be free, but verify).

### Out of phase

- No data model changes. `currentImageUrl` is still the source of truth. Iteration history not yet tracked. Multi-placement not yet possible.
- Acceptable side effect: when the user picks a phone case after generating a 1:1 design, the 1:1 source is overwritten in `currentImageUrl`. Going back to a tee will require another regeneration. We accept this temporarily because Phase 2 fixes it.

## Phase 2 — `design_image` table + backfill — IN PROGRESS

Schema + backfill script committed 2026-05-03. Awaiting user to push schema and run backfill before code-side dual-read changes ship.



**Goal:** every generated image becomes a first-class row. Iteration history is preserved as a tree. Order lines reference the specific image that shipped.

### Schema changes (`src/lib/db/schema.ts`)

```typescript
export const designImage = sqliteTable("design_image", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  designId: text("design_id").notNull().references(() => design.id),
  parentImageId: text("parent_image_id").references(() => designImage.id),
  aspectRatio: text("aspect_ratio").notNull(),  // "1:1", "4:5", "1:2"
  productId: text("product_id"),    // nullable
  placementId: text("placement_id"), // nullable
  imageUrl: text("image_url").notNull(),
  prompt: text("prompt"),
  generationCost: real("generation_cost").notNull().default(0),
  isApproved: integer("is_approved", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

`order` gets:

```typescript
placements: text("placements", { mode: "json" }).$type<Record<string, string>>(),
// e.g. { "front": "<design_image_id>", "back": "<design_image_id>" }
```

`design.status` enum tightens from `draft / approved / ordered / archived` to `draft / archived`. Approval moves to `design_image.isApproved`. `design.currentImageUrl` stays for one release as a fallback (dual-read).

### Backfill script

`scripts/backfill-design-image.ts`. For each `design`:
- Insert one `design_image` row using `currentImageUrl`, `aspectRatio="1:1"`, no parent, `isApproved = (status === "approved" || "ordered")`. Inherit `generationCost` from design.
- For each `order` referencing this design, set `order.placements = { "front": <new_design_image_id> }`.

Idempotent (skip designs that already have a `design_image` row). Run in dry-run mode first, eyeball the output, then for real.

### Code changes

- All read paths that hit `design.currentImageUrl` now prefer the latest `design_image` for the design (or the explicit `order.placements.front` for order pages). Fallback to `currentImageUrl` if no `design_image` rows exist (paranoia).
- `chat_history` URLs stay duplicated; no change to how chat replay works.
- Generation flow: every Ideogram call now writes a `design_image` row, sets `parent_image_id` to the previous generation in the chat thread.

### Verification

- Backfill against a Turso branch first. Compare row counts and link integrity.
- Re-render `/orders` for the test-mode user and Knute. Visually identical.
- Place a test order from a fresh design. Confirm `order.placements.front` is set, `design_image` row exists with `isApproved=true`.
- Run `npm test` — add a test that asserts `placements` resolves correctly from a Phase 2 order and from a Phase 1 backfilled order.

### Out of phase

- Multi-placement UI. Phase 2 just makes `placements` *capable* of holding multiple keys; the UI still only sets one (`"front"`).
- `design.currentImageUrl` removed. Stays one more release.

## Phase 3 — Placement-aware regeneration with provenance

**Goal:** when the user picks a different product after generating a design, regenerate as a child of the source rather than overwriting. Phase 1's hack goes away.

### Changes

- `/preview` product-pick action: instead of overwriting, insert a new `design_image` row with `parent_image_id` pointing at the source 1:1 generation, `(product_id, placement_id)` set, aspect from the placement. Mark this image as the "active" one for that product on the design.
- `design.currentImageUrl` field is now removed. The "current image for product X" is computed: latest `design_image` row matching `(designId, productId, placementId="front")`, falling back to the latest exploratory generation.
- `mockup_urls` cache key changes from `{productId}:{colorName}` to `{designImageId}:{colorName}`. Old cache invalidated.
- A small "iteration tree" debug view in admin (not customer-facing) for sanity checks. Optional but cheap.

### Verification

- Generate a design (1:1). Pick a tee — confirm a new 4:5 child row appears, source 1:1 row preserved. Pick a phone case — confirm a 1:2 child off the same source. Switch back to the tee — confirm we reuse the existing 4:5 child rather than regenerating.
- Iterate inside chat after picking a phone case ("smaller, centered"). Confirm the new image's parent is the 1:2 render, not the 1:1 source.
- Empirical chain-depth check: regenerate 5 times in a chain, eyeball quality. If degrades visibly, file an issue and add the chain-depth heuristic from `print-targets.md`.

### Out of phase

- Multi-placement (front + back). That's Phase 4.
- Image export. That's Phase 5.

## Phase 4 — Multi-placement UI

**Goal:** shirts can have a front and a back design (and later sleeves). `order.placements` finally holds more than one key.

Scope and UX questions deferred to the Printful + checkout deep-dive issue (#11) and the UX comics. This phase doesn't start until those produce concrete decisions, especially:

- Is back opt-in or default-visible?
- Does back design get its own chat thread, or is it generated from the front design with an instruction like "make a back-of-shirt complement"?
- How does pricing surface the back upcharge to the customer?

Once the answers exist, this phase is mostly UI work + a Printful submission tweak (the `files` array gets more entries).

## Phase 5 — Image export facility

Filed as #12. Independent of phases 3–4 and can ship any time after Phase 2 lands.

## Risks and mitigations

- **Ideogram chain-depth quality drift**: caught by the empirical check in Phase 3. Mitigation is a heuristic that re-derives from the original source after N iterations.
- **Backfill mistake corrupts historical orders**: mitigated by dry-run mode first, by idempotency, and by the small dataset (15 orders — easy to spot-check by hand).
- **Auto-regeneration on product pick feels slow on phone**: 8-second wait with no feedback is bad. Phase 1's "preparing for {productName}…" affordance is the mitigation; if it still feels bad, consider pre-rendering common placements speculatively as soon as the user views `/preview`.
- **`mockup_urls` cache invalidation in Phase 3**: low risk because mockups are cheap to regenerate; worst case is a one-time recomputation per existing design when first viewed.

## Sequencing

Phase 1 is the only phase the iPhone-case bug strictly requires. Everything past Phase 1 is foundation for multi-placement and provenance.

Recommended order: Phase 1 → ship → real iPhone case test order → Phase 2 → Phase 3 → pause to run the deep-dive session (#11) and UX comics → Phase 4. Phase 5 (export) slots in any time after Phase 2.
