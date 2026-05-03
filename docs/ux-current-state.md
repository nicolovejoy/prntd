# PRNTD — Current UX, end to end

Snapshot for a UX design session. This describes the flow as it actually behaves today (2026-05-02), with the friction points called out where they hit. Not a wishlist.

## Pages and what they do

```
/                  → landing OR personal home (logged in)
/design            → chat with AI, generate + iterate on the design image
/designs           → list of past design threads
/preview           → pick product + color, see real Printful mockup
/order             → pick size, see price breakdown, go to Stripe
/order/confirm     → post-checkout confirmation
```

Linear flow: `/design → /preview → /order → /order/confirm`. Breadcrumbs at the top of each page.

## /design — chat + generation

- Single-turn chat. User types a description ("a vintage scale of justice with the words JUDGMENT IS BAD").
- Claude (Sonnet 4.6) translates the casual message into an Ideogram prompt, optionally with a reference to a prior generation.
- Replicate runs Ideogram v3 Turbo → returns a square (1:1) PNG with whatever background Ideogram chose (often white or near-white, sometimes textured).
- Server-side, we then call Bria's bg-remove model on Replicate to strip the background.
  - **Known regression**: Bria silently returns the un-removed image for a meaningful share of hand-painted / soft-edge designs. We catch the error, fall back to the original, and the user sees the un-removed white-bg image with no warning. This is the bug behind the "JUDGMENT IS BAD" iPhone case showing a white rectangle around the scale on a clear case (screenshot 11:46:13).
- Each generation is stored in R2 keyed by `designs/{design_id}/{generation_number}.png`. Chat history + image references live on the `design` row.
- Image gallery on the right (mobile: drawer) shows every prior generation. User can click "Use as reference" to feed it back into Claude for the next turn.

### Pain points on /design
- No indication of bg-removal status. User can't tell whether the white area is "Ideogram chose a white background" or "bg-remove failed" — they look identical.
- No retry-bg-remove button. If Bria fails on this image, user has to re-prompt to try again.
- Chat tone is fine, but there's no scaffolding around _design intent_ — color palette guidance, "must look good on dark + light shirts", text-vs-illustration choice, etc. The system prompt currently doesn't push the model to produce designs that read on both light and dark backgrounds.
- One-shot iteration loop: every prompt costs a generation. No "tweak only this corner" or inpainting.

## /preview — product + color + size slider

- URL params: `?id={designId}&product={productId}&aspect={W:H}`
- Top: three product chips (Box Tee / Women's Relaxed Tee / Clear iPhone Case) — click to switch product.
- Below product chips: color swatches for the selected product.
- Big preview pane:
  - On first paint, shows a CSS silhouette of the product with the design overlay (cheap, instant). This is the "fallback" preview.
  - In parallel, fires a `generateMockup` server action that calls Printful's mockup generator → polls until done → caches the resulting JPG in R2 keyed by `productId:colorName:scale`.
  - When the real Printful mockup arrives, it replaces the silhouette.
- **Design-size slider** ("Design size 30–100%"): only visible while the silhouette is showing. As soon as the real Printful mockup loads, the slider disappears.
- CTA: "Use this design" (enabled only when a real mockup is on screen, gated by recent reliability fix).
- Secondary: "Refine design" → back to /design.

### Pain points on /preview
- **Slider disappears once the real mockup loads.** The user has no way to adjust scale on the canonical render — they have to either (a) move the slider _before_ the mockup arrives (a race), or (b) change product/color to bust the cache, then move it before the new mockup loads. Today's screenshot was the user managing to get to ~50% by restarting the flow.
- **Default scale of 100% is wrong for most products.** The print area on a Box Tee is ~12×16in; the design is centered and fills the print area. On a clear iPhone case the print area is 2.5×5.2in but the design still ships at 100% width — visually, this lands as a giant centered rectangle on the case back.
- **The white-background bug shows here in full color.** Even with bg-remove "succeeding", a flat-bg design sits as a hard white block on transparent products (case) and as a hard white block on colored shirts. This is the user's #1 complaint in this session.
- **Aspect routing is opaque.** `?aspect=1:2` is set silently when the user picks a phone-case product. There's no UI affordance saying "we'll regenerate this design at 1:2 to fit the case" or "we re-cropped the original square design to 1:2." The user found out this was happening because their old square design got refit visually.
- **Switching products mid-preview doesn't communicate anything about regeneration.** Switching from shirt (1:1) to case (1:2) silently triggers a new image generation in the background; the cost meter ticks up; the user just sees the preview pane spin.
- Product chip row scrolls horizontally on narrow screens but the active chip doesn't auto-scroll into view — the iPhone-case chip is partially off-screen on phone widths.

## /order — size, color recap, price

- Size picker (M/L/XL for shirts, "iPhone 15 Pro" / etc. for cases).
- Color recap (read-only — the color was chosen on /preview).
- Mockup thumbnail on the left.
- Price breakdown on the right: base × 1.5 = total. Generation cost is tracked internally but not shown to the user.
- "Continue to checkout" → Stripe Checkout Session.
- Sticky bottom CTA on mobile.

### Pain points on /order
- **No design-size control here.** Once you're past /preview, the rendered scale is locked. If the user realizes during checkout that the design is too big on the case, they have to back out to /preview, time the slider race, and come back.
- **No real Printful mockup on /order today.** Only on /preview. So the last visual the user sees right before paying is from a different page — they can lose confidence.
- Pricing breakdown is bare: just total. No "what's included", no shipping line, no tax preview.

## /order/confirm — post-checkout

- Stripe redirects here with `session_id`.
- Server-side: verify session, kick off Printful order (via webhook in prod, direct call in DRY_RUN), email confirmation via Resend.
- Page shows order ID and "we'll email you" message.

### Pain points on /order/confirm
- Confirmation email subject historically said "shirt"/"t-shirt" even for case orders. Audit was done in the prior commit — verify it now uses the actual product name end to end.
- No tracking link in the confirmation page (only in email later).

## Cross-cutting issues called out this session

1. **Background removal is broken often enough to be the dominant visible failure.** Hand-painted / soft-edge designs come through with a flat white block. Affects every product but is most visually catastrophic on clear iPhone cases. **Highest priority UX fix.**
2. **Design-size slider is in the wrong place in the flow.** It belongs at the same point where the user is making their final visual judgment — i.e., right next to the canonical Printful mockup, persistently — not as a transient pre-render control that disappears the moment the real preview shows up.
3. **Default scale is too big.** ~50% lands well on the case in today's test. There's no per-product default — everything starts at 100%.
4. **The chat-driven generation flow lost some prior UX scaffolding** when it was rewritten to use Claude as a prompt-construction intermediary. Specifically, the previous flow had clearer signaling around bg-removal status and "this is your design vs this is your design on a product." Today the user has to infer state from the absence of UI elements.
5. **Aspect/regeneration choices are silent.** Switching products can trigger a regeneration with a different aspect ratio, costing tokens, with no explicit user consent or progress messaging.
6. **The design's relationship to "the product" is fuzzy.** The same design becomes different physical artifacts depending on the product chip. There's no model in the UI of "this is the source design, here are the renders per product." The user can't see what's going to print, separate from what they're previewing on a mockup.

## Files of interest (for the coding session that follows)

- `src/app/design/actions.ts` — generation + bg-removal pipeline
- `src/app/design/page.tsx`, `chat-panel.tsx`, `image-gallery.tsx` — chat UI
- `src/app/preview/page.tsx` — product/color picker, mockup preview, scale slider
- `src/app/preview/actions.ts` — Printful mockup generation, R2 caching by `productId:colorName:scale`
- `src/app/order/page.tsx` — size picker, price, checkout entry
- `src/lib/products.ts` — product catalog (placements, print area, default mockup positions)
- `src/lib/replicate.ts` — `generateImage` (Ideogram) + `removeBackground` (Bria)
- `docs/print-targets.md`, `docs/print-targets-plan.md` — Phase 1 (shipped) and Phase 2 (not yet) for aspect-correct generation per product

## What the next session is for

User stories / journey cartoons that re-imagine: (a) bg-removal as a visible, retry-able state; (b) design-size control as a persistent part of the canonical preview rather than a fleeting pre-render control; (c) the user's mental model of "the design" vs "the design on the product"; (d) explicit signaling when switching products triggers regeneration.
