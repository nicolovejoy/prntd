# Print Targets

How designs map onto physical products. This is a design doc for an unresolved problem, not a description of current behavior.

## The problem

A design is generated once at a fixed 1:1 aspect ratio (`src/lib/replicate.ts`) and then applied to whatever product the user picks at `/preview`. Print areas vary wildly:

- Bella+Canvas 3001 tee: 10×12 in (~1:1.2)
- Cotton Heritage MC1087 tee: similar
- Clear iPhone case: 2.5×5.2 in (~1:2.08)

Concrete failure: order #155282908-77750732 — a square "JUDGEMENT IS BAD" design rendered on an iPhone 17 Pro case as "UDGMEN IS BAD" with the scales icon clipped. Printful auto-fits and crops because the source image doesn't match the placement aspect.

Independently: shirts realistically want front + back (and sleeve, label). The data model only stores one `currentImageUrl` per design.

## Concepts

### Placement

A named region on a product where one image gets printed. A product has one or more placements; today every product has an implicit single placement. Made explicit, a placement carries:

- `id` — `front`, `back`, `sleeve-left`, `phone-back`
- `aspectRatio` — what the generator should target
- `printArea` — physical dimensions (inches), for UI hints and Printful submission
- `mockupPosition` — pixel coordinates for compositor
- `required` — must this slot have an image to fulfill?

`mockupPosition` and `printArea` already live on `Product` in `src/lib/products.ts` — the migration is moving them down a level into a `placements` array.

### Design vs. design-image (data model — agreed direction, not built)

Today: `design.currentImageUrl` is the design. Intermediate generations live inside `chat_history` JSON, which is convenient for chat replay but bad for queries and provenance.

Direction: a `design` is the creative thread (chat, intent). Every generated image is a row in a new `design_image` table, forming a tree via `parent_image_id`. Approval and product-placement pairing move out of `design`.

```
design
  id
  user_id
  chat_history     full conversation (image URLs may be duplicated here for
                   replay convenience; design_image is source of truth)
  status           draft / archived
  created_at

design_image
  id
  design_id           → design
  parent_image_id     → design_image, nullable
                       — exploratory regenerations chain off their predecessor
                         (so the iteration history is a real tree)
                       — placement renders point at the source they were derived
                         from
                       — only the very first generation of a design has null
  aspect_ratio        "1:1", "4:5", "1:2"
  product_id          nullable; only set if this generation targeted a product
  placement_id        nullable; same
  image_url           R2 URL — never deleted
  prompt              prompt used for this generation
  generation_cost
  is_approved         boolean — user has marked this image as "ready to print"
  created_at
```

Two image kinds, distinguished by columns rather than a type enum:

- **Exploratory generation** — `product_id IS NULL`. Aspect 1:1. May or may not have a parent depending on whether it was a regeneration.
- **Placement render** — `(product_id, placement_id)` set, parent points at the image it was derived from.

A design can have multiple `is_approved=true` rows (e.g. one approved front render and one approved back render).

Iteration tree: every regeneration sets `parent_image_id` to its predecessor. This includes regenerations *of placement renders* — if the user picks a phone case (auto-regen at 1:2) and then says "smaller and centered," the new image is a child of the 1:2 render, not the 1:1 source. See "Iteration on placement renders" below.

### Pairing images to placements happens on the order, not the design

A design is placement-agnostic. The order line is what binds specific design-images to specific placements:

```
order_line
  id
  order_id
  product_id
  variant_id            (resolved from product/color/size)
  placements            JSON: { "front": <design_image_id>, "back": <design_image_id> }
  ...
```

This means the same front design can pair with different back designs across separate purchases without forking the design tree. It also matches Printful's submission model (a `files` array keyed by placement).

### Iteration on placement renders

When the user iterates on an auto-generated placement render ("make the fox smaller"), the new generation is a child of the placement render, not the source. Pros: matches user intuition ("I'm tweaking *this* image"). Con: each generation in the chain uses the previous one as a style reference, so quality could drift.

Worth verifying empirically with Ideogram v3 Turbo — `style_reference_images` is supposed to pull style rather than content, so derived-from-derived chains should be more robust than img2img would be. If drift is real, we add a heuristic: when chain depth > N, re-derive from the original source instead.

### Existing data: small backfill + export facility

Only ~15 real orders today, so the backfill is a one-shot script (insert one `design_image` per existing `design.currentImageUrl`, link `order` rows to it). Clean slate is also viable but unnecessary at this size.

Separate (and more interesting): an **image export/import facility** so users own their generations independently of our schema. Surfaces:
- **Export** — on `/designs`, a "download all my designs (zip)" action. Each image filename encodes design ID, generation number, aspect, and approval status.
- **Import** — open question whether we need it at all. If it's only useful as a migration tool, we don't. If it's a customer-facing "bring your own design" feature, it's a much bigger project (tax/IP review, content moderation, prompt-less ordering flow). Filed separately.

## Where placement metadata is consumed

- **Image generation** (`src/lib/replicate.ts`) — needs `aspectRatio` to ask Ideogram for the right shape.
- **Mockup compositor** (`src/lib/mockup.ts` / Printful mockup API) — needs `mockupPosition`.
- **Printful submission** (`src/lib/printful.ts`) — needs `placement_id` per file when submitting multi-placement orders. Printful's API supports a `files` array keyed by placement.
- **Order line** — needs to know which placement-images were used so the right files get sent.

## When does the user pick a product?

**Decided: design-first, with auto-regeneration per placement.** When the user picks a product on `/preview`, the system silently regenerates the image at the placement's aspect ratio using the source prompt + reference image. Surface a brief "preparing this for a phone case…" affordance so the wait is legible and the user understands the result will look slightly different.

Rejected: product-first (kills the exploratory flow), and crop/outpaint (quality too unpredictable for printed goods).

Multi-placement on shirts (front + back) is a UX-journey question rather than a tech question — see the deep-dive issue. The data model below supports it either way.

## Pinned aspect ratios

Ideogram v3 Turbo's `aspect_ratio` enum is: `1:1, 1:2, 2:1, 1:3, 3:1, 9:16, 16:9, 10:16, 16:10, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4`.

- Exploratory (chat / `/design`): **1:1** (current default, keeps generations comparable)
- Tee front placement (10×12 in, true ratio 5:6): **4:5**
- iPhone case back (2.5×5.2 in, true ratio ~1:2.08): **1:2**

If we ever need finer control, Ideogram also accepts a `resolution` parameter with 73 discrete WxH values (mutually exclusive with `aspect_ratio`).

## Build order

1. Add `placements` array to `Product`. Backfill existing products with one front placement carrying their existing `mockupPosition`, `printArea`, and pinned `aspectRatio`.
2. Thread placement aspect ratio into `generateImage` so new generations target the right shape. (Quick win: at this point new orders no longer crop badly even though the data model is unchanged.)
3. Schema: new `design_image` table per the Data Model section. New `order_line.placements` JSON column. Backfill script for existing designs and orders. Drop `design.currentImageUrl` after one release of dual-read.
4. `/preview`: when the user picks a product whose placement aspect ≠ the current source image aspect, auto-regenerate at the placement aspect. Show "preparing for phone case…" affordance. Save as a child `design_image` row with `(product_id, placement_id)` set.
5. Printful submission: build the `files` array from `order_line.placements`, one entry per placement.
6. Multi-placement UI on `/preview` — one image slot per `placements[]` entry, each independently fillable, "add a back design" type action where applicable.
7. Image export facility on `/designs` (zip download). Independent of the rest; can ship anytime after step 3.

Steps 1–2 unblock the iPhone-case crop today without a schema change. Step 3 is the real foundation; 4–6 are the new-flow work.

## Out of scope for this doc

- DTG vs. sublimation vs. screen-print constraints.
- Per-placement pricing (an iPhone case + back-print premium is a separate question).
- Live mockup preview during generation (would help the user see crops before ordering, but that's a separate UX project).

## Decisions so far

- Design-first flow with auto-regeneration on product pick. Magic, brief loading affordance.
- Source images are kept forever; placement renders are derived images with a `parent_image_id` link back.
- iPhone case safe-area: one conservative template covering all listed iPhone models. Per-model templates only if customer feedback shows the conservative crop is leaving real space on the table.
- Aspect ratios pinned: 1:1 exploratory, 4:5 tee front, 1:2 phone case.
- Approval is per `design_image`, not per `design`. A design can have multiple approved images.
- Iteration history is a tree (`parent_image_id`), not a flat list. Includes iteration on placement renders.
- Front/back/sleeve pairing lives on the order line as a JSON `placements` map, not on the design.
- Backfill existing ~15 orders into `design_image` (small one-shot script). Clean-slate also viable but unnecessary at this size.
- Image export facility planned: users can download all their designs as a zip. Import is a separate question and probably out of scope until much later.

## Queued for dedicated sessions

- **Printful + checkout deep dive** — multi-placement semantics, multi-product orders, tax, shipping, multi-item discounts, team/cause group orders, the relationship between our `/order` page and Stripe checkout (and whatever Printful-supplied data shows up where). Filed as its own GitHub issue.
- **Camera cutout / safe-area UX** — how the user sees the actual phone-case layout before paying, where the safe-area guide lives, and how the prompt could bias toward leaving the camera region empty. Folded into the same deep-dive issue since it touches the preview/checkout surfaces.
- **UX comics for journeys** — Nico to run ChatGPT image gen against scripted journeys (single-buyer cross-product, returning customer, team/cause group). Will inform whether back-of-shirt is opt-in or default-visible, and whether multi-product browsing happens before or after a design exists.
