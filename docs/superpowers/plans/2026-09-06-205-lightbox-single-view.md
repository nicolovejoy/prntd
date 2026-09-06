# Plan: image lightbox — single view, opaque scrim (#205)

**Spec authority:** issue #205 (Nico's decision 2026-09-06: remove the
dark/light comparison entirely) and the precedents it cites — #151 dropped
the Dark/Light backdrop toggle from the thread view (judging art on a real
shirt colour is `/preview`'s job) and #188's Paper direction is light-only
with the checkerboard gone. Migration-free. One PR.

## Global Constraints

- Only `src/app/design/image-lightbox.tsx` and its tests change
  (`src/app/design/__tests__/image-lightbox.test.tsx`,
  `src/app/d/[imageId]/__tests__/conversation-images.test.tsx` if it asserts
  on the removed toggle). Both consumers (`design-client.tsx`,
  `d/[imageId]/conversation-images.tsx`) are untouched — the component's
  props do not change.
- Copy is Clean Label (`docs/design-system.md` Part 1): no new copy is
  needed; nothing playful.
- Tap targets ≥ 44px stay ≥ 44px. No new colour literals: use the existing
  semantic tokens (`bg-background`, `bg-surface`, `text-text-muted`…) — the
  Paper re-skin (#188) will sweep scrims sitewide and must find tokens, not
  hex.
- `data-testid="image-lightbox"` and `data-testid="lightbox-actions"` stay.
- `npm run lint`, `npm run typecheck`, `npm test` green.

## Task 1 — one image, opaque scrim, focus on open

Files: `src/app/design/image-lightbox.tsx`,
`src/app/design/__tests__/image-lightbox.test.tsx` (extend; read it first —
it is the existing behaviour contract).

1. Delete the side-by-side mode: the `sideBySide` state, the header toggle
   button ("Single view" / "Side by side"), and the two backdrop panels
   (`bg-gray-900` / `bg-white`). The image container renders exactly one
   `<img>` — the current single-view markup (`max-h-[70vh] max-w-full
   object-contain rounded-lg`, `alt` = `Design #N`).
2. Scrim: replace `bg-black/90` on the dialog root with an opaque ground,
   `bg-background`, so the page beneath (often the same artwork as the
   hero) cannot bleed through. No blur.
3. Focus: on mount, focus the Close button (a `useRef` + `useEffect`
   focusing once). Do not add a focus trap — out of scope.
4. The `hover:text-white` literals on Close / arrows: leave as they are
   (Paper slice 1 sweeps `text-white` sitewide per its plan; touching them
   here creates a conflict for nothing).

Tests (vitest + testing-library, jsdom — follow the existing file):
- renders exactly one `<img>` for the current image (query all `img`s).
- no element with text "Side by side" or "Single view".
- Close button has focus after mount (`document.activeElement`).
- existing tests for Escape, arrows, `#N of M`, action gating stay green.

Commit: `Image lightbox: one image, opaque scrim, focus Close on open (#205)`.
