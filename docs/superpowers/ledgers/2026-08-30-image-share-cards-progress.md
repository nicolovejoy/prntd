# Progress — per-image link preview cards

Plan: `docs/superpowers/plans/2026-08-30-image-share-cards.md`.

## Task 1 — `src/lib/image-share.ts` — DONE

`canShareImageCard` (pure) + `getImageShareCard` (one joined read).
8 tests in `src/lib/__tests__/image-share.integration.test.ts`: the pure
gate's three cases, and the reader against a real DB for published /
private / hidden / unknown-id / null-backdrop.

## Task 2 — the card routes — DONE

`src/app/d/[imageId]/opengraph-image.tsx` + `twitter-image.tsx`, plus
`src/lib/og-site-card.tsx` holding the shared branded card and the
`designCardPalette` decision. The root `opengraph-image.tsx` now renders
`<SiteCard />` instead of its own copy of that markup.

## Task 3 — `generateMetadata` — DONE

In `src/app/d/[imageId]/page.tsx`. Published → listing title +
"Designed by X. Put it on a shirt."; anything else returns `{}` and
inherits the site defaults.

## Task 4 — verification — DONE

Gate: 1097 tests (109 files), lint 0 errors, typecheck clean, build OK.

Rendered for real rather than asserted about. Applied the migration chain
to a file-backed libSQL, seeded three images (published on Navy,
published with a legacy null backdrop, never published), served the
artwork over HTTP, ran `next build` + `next start`, and fetched each
card. All three returned `200 image/png`; the twitter route returned the
OG card byte-for-byte. Eyeballed all three PNGs:

- Navy: artwork composited on the pinned navy, light wordmark.
- Null backdrop: White per #76, wordmark flips to dark.
- Never published: the branded site card.

Meta tags on the published page carry `og:title` "Rocket Cat",
`og:description` "Designed by Nicholas Lovejoy. Put it on a shirt.",
and per-design `og:image` / `twitter:image`. The private page 404s for an
anonymous requester and inherits the site defaults — nothing leaked.

## Rulings made during the build

**Route segment config cannot be re-exported.** `twitter-image.tsx`
re-exporting `revalidate` from `opengraph-image` failed the Turbopack
build — Next reads segment config statically. It is declared as a literal
in both files now, with a comment tying them together. `alt`, `size` and
`contentType` are metadata exports and re-export fine.

**No rasterizing test.** A test that called the route and asserted on PNG
bytes got satori all the way to valid SVG and then died inside resvg's
wasm under vitest ("Unsupported input"). That is a harness limitation, not
a defect, and working around it would have tested the harness. Dropped it
in favour of testing `designCardPalette` (the only real decision in the
card) and verifying the raster against a real server, as above. If the
markup ever needs regression cover, an e2e fetch of the route is the
honest place for it — CI has a real server there.

**The card's artwork box is 520×520 with `objectFit: contain`.** Designs
are square today but `image.aspectRatio` allows otherwise; contain
letterboxes a non-square design inside the box rather than distorting it.

## Not done, deliberately

Everything under the plan's "Deliberately not in scope". Also: no issue
was filed — this went straight from Nico's message to the branch.
