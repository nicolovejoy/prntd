# Paper slice 5 — image detail page (#188) — SDD progress ledger

Branch `feat/188-paper-image-detail`. Plan: `docs/superpowers/plans/2026-09-07-paper-image-detail.md`.
Controller: Opus. Implementers/task reviewers: Sonnet. Re-reviews: Haiku. Whole-branch final: Opus.

## Rulings made before any code (from the plan)

- **R1 — PRICE is the item floor, `From $19.43`, never "shipped".** `minRetailPrice()` was
  orphaned when PR #214 deleted the landing price line; this page adopts it. The #214 defect
  was the word *shipped* claiming flat shipping was included, not the number. Shipping stays
  broken out in the expanded panel one tap away.
- **R2 — one identity block for both branches** (published and the owner's unpublished work).
  PRICE is a catalogue floor, true either way.
- **R3 — "Forked from …" is provenance, not an action.** It becomes a `FORKED FROM` row in the
  identity block rather than joining the OWNER row, which would owner-gate a public line.
- **R4 — Un-publish moves into the OWNER row.** It lived in `published-image-view.tsx`, which
  only renders while the hero is collapsed, so today it disappears the moment the buyer taps
  Order. The BackgroundPicker does not move (direct manipulation beside the artwork).
- **R5 — media wells are `bg-surface-well`, in the strip too, not white.** The brief said
  "white squares"; the design review's own summary point 4 is that white-ink art on a white
  ground is a live defect. `.bg-checkerboard` already resolves to `--surface-well`; each site
  names its own border because the CSS rule deliberately carries none.
- **R6 — corner radii unchanged.** Paper is bordered-no-shadow, not sharp-cornered; the frozen
  primitives are `rounded-md`/`rounded-lg`.
- **R7 — `SizePicker`/`ColorPicker` labels NOT converted.** They live in the shared
  `src/components/product-options.tsx`, which `/order` renders and this slice does not own.
  Passing `label="SIZE"` would give uppercase in the wrong typeface. Deferred, in the PR body.
- **R8 — Feedback launcher already off this page.** `/d` joined `FUNNEL_PREFIXES` in #219 and
  `src/lib/__tests__/funnel-routes.test.ts` already asserts `isFunnelRoute("/d/abc123")`.
  Verified, no change, no new test.

## Task log

(filled in as tasks complete)
