# Progress — image detail page lightbox (#157)

Plan: `docs/superpowers/plans/2026-09-05-157-image-page-lightbox.md`.
Branch: `cloud/157-image-page-lightbox`. Pattern: subagent-driven —
one implementer per task, a reviewer per task, fix rounds, controller
runs the gate.

## Rulings (before Task 1)

- **Generalise by subtraction, not renaming.** `ImageLightbox` keeps its
  `images` / `currentIndex` / `onClose` / `onNavigate` contract and its
  field names (`id`, `number`, `url`) so `design-client.tsx` compiles
  untouched. The thread-specific callbacks (`onDelete`, `onMakeProducts`,
  `onPublish`, `onStartFrom`) become optional and each button renders only
  when its callback is given; a new optional `actions` slot carries
  consumer-specific controls for the shown image. New exported
  `LightboxImage` type = the structural subset `DesignImage` already
  satisfies.
- **`#N` labels come from position in the full sibling list.**
  `getConversationImages` and `/design`'s gallery both read
  `getDesignSourceImages(designId, { includeSeeds: true })` in the same
  order, so index+1 in the strip's full list is the same `#N` the thread
  shows. No change to `d/actions.ts` needed.
- **Strip tap opens the lightbox; the sibling's own page stays reachable
  from inside it** via a plain link in the actions slot (judgment call —
  the strip's previous tap navigated there, and nothing else on the page
  does). Flagged in the PR body.
- **Owner gate at the component level:** an empty sibling list (what a
  non-owner gets back from `getConversationImages`) renders nothing.
  `page.tsx` already gates the strip on ownership; this is the backstop.
- Phone-first: prev/next/close targets ≥44px, safe-area padding on the
  overlay. The side-by-side toggle and keyboard handling stay as they are.

## Task 1 — generalise `image-lightbox.tsx` + tests — DONE, reviewed

Implementer: `LightboxImage` exported; the four thread callbacks optional
and each button gated on its callback; `actions` slot first in the row;
no row when empty; 44px prev/next/close with aria-labels; `role="dialog"`;
safe-area padding. `design-client.tsx` untouched and compiles.
18 tests in `src/app/design/__tests__/image-lightbox.test.tsx`.
Gate: typecheck clean, eslint 0 errors (3 pre-existing `no-img-element`
warnings), full suite 1378 passed.

Review: 0 blocking / 3 minor, all test gaps (published image with
`onPublish` absent; built-in button order; Escape's stopPropagation
unobservable when dispatched at window) — fix round applied. Notes, no
action here: `env(safe-area-inset-*)` is inert repo-wide (no
`viewportFit: "cover"` viewport export); `aria-modal` without focus
management is pre-existing shape; the side-by-side toggle stays small.

## Task 2 — wire the strip — DONE, reviewed

Implementer: strip thumbnails are buttons opening the lightbox at their
index in the FULL sibling list (`others` carries `{ img, index }`);
`lightboxImages` = full list with `number = index + 1`; lightbox gets
only `images`/`currentIndex`/`onClose`/`onNavigate`/`actions`; `actions`
= current-image copy or "Use this one" (`handleUse(shown.imageId)`) plus
"Open" to the sibling's page when shown ≠ the page's image; ring driven
by `primaryImageId` state; empty sibling list renders nothing.
12 tests in `src/app/d/[imageId]/__tests__/conversation-images.test.tsx`
(next/image renders fine under jsdom, left unmocked).

Review: 0 blocking / 1 minor — the "Use this one from inside the
lightbox on the page's OWN image flips the top-level block" case was not
pinned; fix round adds it. Note, no action: Link→button drops the desktop
pointer cursor, matching every other image-button in the app.

## Task 3 — CLAUDE.md line + PR — DONE

One paragraph in CLAUDE.md before the Next list. PR body carries the
judgment call ("Open" link inside the lightbox), the gate, the one prod
smoke, and the three follow-ups the reviews surfaced (safe-area padding
inert repo-wide without `viewportFit: "cover"`; dialog without focus
management is pre-existing; side-by-side toggle target is small).

## Gate

`npm run lint` 0 errors (24 pre-existing warnings), `npm run typecheck`
clean, `npm test` green (count in the PR body), `npm run build` OK with
CI's placeholder env (without any env the build fails at "collect page
data" because the Resend client throws at import — environmental, same
on main).
