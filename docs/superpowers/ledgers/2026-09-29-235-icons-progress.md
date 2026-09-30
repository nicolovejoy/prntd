# #235 icons — SDD ledger (batch 3, slice 5)

Branch `claude/235-icons` from origin/main `5fcb872`. Controller implemented directly (one small, visual task); review by a `claude -p` Sonnet subprocess.

## Mark

Nico's pick 2026-09-29 ("variant 5", mock variant `pixel`): P R [i] / N T D ink tiles on Paper.

- Grid maths: 240 − 2×22 = 196; three columns with two 8px gaps give 60px cells (the brief's "≈61.3" was off), two rows give 94px.
- Letters: Geist 900 from Google Fonts' static instance (`fonts.gstatic.com/s/geist/v5/…ttf`, the same family the mock loaded; the generator checks `usWeightClass === 900`). Outlined with opentype.js 2.0.0; placed the way Chrome's flex layout placed them in the mock (line-box centring from the font's vertical metrics, advance + letter-spacing for the inline width).
- i-block: 7×7 rose dot, 4 gap, 7×18 Paper stem; the 26.5/32.5 half-pixel centring offsets round up, as Chrome's layout did.
- Checked against the mock: rendered the mock HTML in Playwright Chromium at 4× and pixel-diffed it with the generated icon.svg. First pass caught opentype.js 2's `toPathData` y-flip (letters upside down; fixed with `flipY: false`) and the i-block's half-pixel rounding. After the fixes the only differences are 1px anti-aliasing edges.

## Files

- `scripts/generate-icons.ts` (run: `npx tsx scripts/generate-icons.ts`) writes all of:
  - `src/app/icon.svg` — master, rects + one path, no text/fonts
  - `src/app/favicon.ico` — hand-written ICO container, PNG entries 16/32/48
  - `src/app/apple-icon.png` — 180, square, opaque
  - `public/icons/icon-192.png`, `icon-512.png` — manifest `any`
  - `public/icons/icon-maskable-512.png` — mark scaled to 0.68 of the full-bleed icon (tile grid ≈284px of 512) so the grid corners sit inside the 0.4×size circle with a 2% margin
- `src/app/manifest.ts` — PRNTD / standalone / `#f8f5ef` theme + background / three icons.
- `src/app/layout.tsx` — `appleWebApp: { title: "PRNTD", capable: false }` so the iOS home-screen label is PRNTD whichever page it is added from.
- `src/app/__tests__/app-icons.test.ts` — manifest fields and entries, each manifest file exists with matching PNG dimensions, apple-icon 180 and fully opaque, maskable safe zone by pixel scan, favicon.ico directory sizes, icon.svg has no text/font/style/image and only Paper/ink/rose fills.
- `package.json` — `opentype.js` devDependency (outlining only; no runtime use). `sharp` is used by the script and the test but is not a direct dependency: it comes in through `next` (0.35.4 in the lockfile, linux binaries included).

## Not changed: `src/lib/og-site-card.tsx`

The brief asked to replace the card's "small mark". The site card has none: it is a large rose "PRNTD" text wordmark, the tagline, the URL and an ink strip. Replacing the wordmark with the tile mark would be a card redesign, and #235 says the wordmark is decided not-now. The small square beside a shared link on phones comes from the site's icons (apple-touch-icon / favicon), which this branch does change. Left for Nico to decide.

## Gate (controller-run)

- `npm ci`; lint 0 errors (33 warnings, pre-existing; changed files clean); typecheck clean; `npm test` 209 files / 2519 tests passed; `db:generate` "No schema changes"; `npm run build` with CI's dummy env OK (routes `/apple-icon.png`, `/icon.svg`, `/manifest.webmanifest` static).
- `next start -p 3217`, `curl /` head:
  - `<link rel="manifest" href="/manifest.webmanifest"/>`
  - `<meta name="apple-mobile-web-app-title" content="PRNTD"/>` (+ Next's default `apple-mobile-web-app-status-bar-style` `default`)
  - `<link rel="icon" href="/favicon.ico?…" sizes="48x48" type="image/x-icon"/>`
  - `<link rel="icon" href="/icon.svg?…" sizes="any" type="image/svg+xml"/>`
  - `<link rel="apple-touch-icon" href="/apple-icon.png?…" sizes="180x180" type="image/png"/>`
  - each URL 200 with image/x-icon, image/svg+xml, image/png, application/manifest+json; public/icons PNGs 200 image/png and byte-identical to the files.

## Review

Sonnet (`claude -p`, brief in the controller scratch dir), 2026-09-29. Verdict READY, six Minor findings. Acted on:

1. `appleWebApp` also emitted `mobile-web-app-capable=yes` (Next defaults `capable` to true). Now `capable: false`; the rebuilt head has only the title and status-bar-style metas. Display mode comes from the manifest.
3. Font bytes weren't pinned. The generator now checks a SHA-256 of the downloaded TTF and throws on mismatch.
5. Added a test that decodes each favicon.ico entry as a PNG at its stated size.

Not acted on:

2. Add `sharp` as a direct devDependency. Tried it: npm re-flagged sharp's platform packages in the lockfile as `dev: true`, which would drop them under `--omit=dev` installs, and next uses sharp at runtime. Reverted; the test and script rely on next's copy.
4. The i-block rounding comment is verified: the Chromium render of the mock put the dot at x=185, y=55, the same as the rounded values.
6. Adding the icon URLs to prod-smoke.yml is outside this slice's fence. Left as a suggestion.

The re-run of the full gate after the fixes: lint 0 errors, typecheck clean, 209 files / 2520 tests, "No schema changes", build OK, head tags and URLs as above. The generator re-run left every icon file byte-identical.
