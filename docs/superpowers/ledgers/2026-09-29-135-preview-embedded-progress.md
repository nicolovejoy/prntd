# #135 slice 3 — /preview on embedded checkout: SDD ledger

Branch claude/135-preview-embedded (base origin/main ca8c294). Controller: batch-3 slice 6.

## Design decisions (spec silent)
- New flag PREVIEW_EMBEDDED_CHECKOUT_ENABLED, read by `previewEmbeddedCheckoutFlag()` (flags.ts) and
  resolved by `previewEmbeddedCheckoutConfig()` (embedded-checkout.ts) through the same pure fail-closed
  resolver as the image detail page's switch. EMBEDDED_CHECKOUT_ENABLED keeps gating only the image detail page's buy.
- The shared surfaces (/checkout page, loadEmbeddedCheckout, /order/confirm open-session branch) are on when
  EITHER switch is on (`embeddedCheckoutPageFlag()` / `embeddedCheckoutPageConfig()`), so /preview can flip on while
  the image detail page's switch is off and vice versa. Both off = today's code paths.
- Review pane: /preview's default front caches its mockup under the source-less key
  (`v2:<product>:front:<color>:100`); the image detail page's under the keyed-by-source key. loadCheckoutSummary
  tries the source key first, then the source-less key when the pinned front equals the design's current
  primary image. Scale: orders carry no scale; lookup stays at 100 (matches fulfillment).
- Cart stays hosted (decision 4). Webhook untouched.
- e2e: the cart test stays hosted; a second test buys one design from /preview and pays in the embedded iframe
  when PREVIEW_EMBEDDED_CHECKOUT_ENABLED=true (hosted path otherwise).

## Outside the fence
- src/app/order/confirm/page.tsx: its open-session branch is gated on EMBEDDED_CHECKOUT_ENABLED only; with just the
  /preview switch on, a returning buyer with an open (unpaid) embedded session would see "Order confirmed.".
  Gate widened to either switch. Not the webhook.

## Tasks
- T1 implement (sonnet, claude -p): flags, configs, createCheckoutSession wiring, /checkout + loader + confirm gates,
  review-pane source-less lookup, tests, e2e second test, nightly env. First launch failed (prompt via "$(cat)" arrived
  empty); relaunched with the brief on stdin.
- Controller fixes after reading the diff: e2e iframe candidates get `.first()` (several js.stripe.com frames trip
  strict mode) plus an `iframe[src*="embedded-checkout"]` candidate; CLAUDE.md env line said "both off" (the image
  detail page's switch is on in prod). Commit b1c0810.
- T1 review (sonnet): 1 Important, 5 Minor.
  - Important: setPrimaryImage (src/app/design/actions.ts) changes primary_image_id without clearing
    design.mockupUrls, so a source-less front mockup rendered for the previous primary can show in the review pane.
    NOT fixed here: pre-existing, same defect already affects /preview itself and order emails
    (src/lib/email-images.ts uses the identical source-less-when-front-is-primary rule), and the fix belongs in
    design/actions.ts, outside the fence. Reported to the main session for a separate issue/PR.
  - Minor fixed (ceacb3f): CLAUDE.md Stripe line still said embedded was off; /checkout docblock rewrap.
  - Minor accepted: expected hosted params built by the same builder (literal cancel_url is the pin; checkout.ts has
    only comment changes); e2e embedded selectors uncalibrated (fails loud); second headers() call on embedded branch only.
  - Haiku re-review of ceacb3f: OK.
- Gate (controller, on HEAD after npm ci): lint 0 errors / 33 warnings (none in touched files), typecheck clean,
  209 files / 2527 tests, db:generate "No schema changes", build with CI dummy env exit 0 on b1c0810 (/checkout and
  /order/confirm dynamic; ceacb3f is comment/docs only).
- Not run: npm run e2e:stripe (needs sk_test + Stripe CLI). One calibration run expected (nightly or Nico).

## Fix round (main session's Opus whole-branch + money-path reviews)
- Rulings: (1) clear design.mockupUrls wherever an existing design's primary moves: setPrimaryImage (no-op early
  return when the image is already primary) and the delete path's primary move; closes #264. Fence extended to
  src/app/design/actions.ts and src/lib/delete-image.ts plus tests. (2) /order/confirm reads Stripe for any pending
  order with a session id, switches or not. (3) stale docblocks (flags.ts, embedded-checkout.ts,
  checkout-session-status.ts, ReviewBlock). (4) docs/stripe-e2e.md embedded section. (5) nightly coverage comment,
  spec timeout message names the pk/sk account mismatch.
- Accepted as-is by the main session: resumeHref on /order/confirm lacks &from= (Back goes to /shop); the e2e does not
  compare the sale amount to totalPrice.
- Implementer (sonnet) → 953a6b9. Tests: set-primary-image (cache cleared, /checkout loader null, email falls back to
  artwork; same-primary keeps cache), delete-images (primary delete clears, non-primary keeps), confirm page with both
  switches off (open hosted → resume to Stripe url; open embedded → no resume; complete → confirmed; paid → no call).
- Scoped re-review (sonnet): ready; 3 Minor. Fixed: ReviewBlock docblock overstated "cleared" (in-flight render can
  write back). Accepted: Stripe read failure still fails open to "Order confirmed." (pre-existing, documented) and adds
  up to 3 s to hosted confirm on a slow Stripe; setPrimaryImage same-primary check reads before the update (harmless
  no-op on a race); in-flight render write-back race (pre-existing, same on the generate path).
- Gate (controller, 953a6b9): lint 0 errors / 33 warnings, typecheck clean, 209 files / 2532 tests,
  db:generate "No schema changes", build with CI dummy env exit 0.
