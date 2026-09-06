# Plan: image detail page — browse the thread's images in the lightbox (#157)

**Spec authority:** issue #157, decided 2026-08-03: **lightbox only**, no
inline chat. Its blocker (#135 slice 1, the `buy-hero.tsx` client wrapper) has
shipped, so this is unblocked. **Branch:** this one
(`cloud/157-image-page-lightbox`). Migration-free, small.

## What changes

On `/d/[imageId]`, the owner's "Other images from this design" strip
(`src/app/d/[imageId]/conversation-images.tsx`, data from
`getConversationImages(designId)` in `src/app/d/actions.ts` — owner-gated,
seeds included) gains a lightbox: tapping a strip thumbnail opens the
existing `src/app/design/image-lightbox.tsx` over that image with prev/next
across the strip's images (plus the page's own image), instead of only
swapping the primary. "Use this one" (setPrimaryImage) stays where it is and
is also reachable from inside the lightbox for the shown image.

- Reuse `image-lightbox.tsx`; if its props are thread-specific, generalise
  them minimally (a `images: {imageId,imageUrl,label}[]` + `index` +
  `onClose` + optional actions slot) and keep `/design`'s usage compiling
  and its tests green. Do not build a second lightbox.
- Owner-only, matching the strip: a cross-owner Shop viewer sees neither.
- The lightbox must `preventDefault` on Escape (see `ui/modal.tsx`) so
  Breadcrumbs' Escape-to-go-up does not fire underneath.

## Global constraints

- Phone-first: full-bleed image, swipe or ≥44px prev/next targets, close
  target top-right, safe-area aware.
- Copy: The Clean Label. Labels are the existing `#N` generation labels.
- Tests: RTL for open/prev/next/close/Escape and the owner gate; existing
  `/design` lightbox tests unchanged. `npm run lint`, `typecheck`, `test`,
  `build` green. No prod/preview access from a cloud session — list the
  one smoke for Nico in the PR body.
- `/d/[imageId]/page.tsx` and `buy-hero.tsx` are also touched by the #167
  branch (both-sides preview). Keep your edits to `conversation-images.tsx`
  and the lightbox; if `page.tsx` needs a prop, make it a one-line change.

## Tasks

1. Generalise `image-lightbox.tsx` props (if needed) + tests.
2. Wire the strip: open on tap, prev/next, "Use this one" inside.
3. CLAUDE.md Next line + close-out note in the PR body.

Use superpowers:subagent-driven-development to execute. Open a normal PR.
