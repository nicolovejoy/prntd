# SDD ledger — plan: docs/superpowers/plans/2026-10-05-289-order-cart-bookkeeping.md
Preflight: 3 tasks. T1 and T2 share abandonSessionlessOrder (T1 produces in order-checkout.ts, T2 consumes from cart/actions.ts) — consistent. T3 touches webhook-handlers.ts and money-path tests only — no overlap with T1/T2 files except tests. Ruling: Task 2 (checkoutCart) kept though #289 names only createStripeCheckoutForOrder — same defect, same helper — costs nothing if wrong beyond review time. Ruling: cleanup batch separate from the claim batch (plan) — a cart error must not roll back a paid claim.
Task 1+2: implemented (commits 537a421..02e72a8), awaiting review
Task 1: complete (commits 537a421..02e72a8, review clean). Task 2: complete (same range, review clean).
Task 1: minor (deferred): dbWithFailingUpdate Proxy fault-injects the real DB — beyond the mock list; deliberate exception (only way to test the swallow path).
Task 1: minor (deferred): user-orders.ts comment "could never have been paid" → "could never have been paid and still be pending"; order/confirm/page.tsx:18 comment wrong about stripeSessionId backfill (pre-existing).
Task 1: minor (deferred): "paid anyway" test could also assert getUserOrdersData shows the late-paid order.
Task 1: minor (deferred): `Awaited<ReturnType<typeof stripe.checkout.sessions.create>>` → `Stripe.Response<Stripe.Checkout.Session>`.
Cannot-verify, pre-existing, not worsened: paid-anyway order with no webhook delivery stays pending/session-less/abandoned, invisible on /orders, admin Recover needs a session id.
Task 3: implemented (commits 02e72a8..e915a43), awaiting review
Task 3: complete (commits 02e72a8..e915a43, review clean).
Task 3: minor (deferred): unbounded delete batch (no cart line cap; non-fatal); malformed placements JSON would fail the batch every run (theoretical, drizzle writes valid JSON); cart-line-match.ts:11-14 doc comment awkward; under-delete when the primary changed between add and a /preview buy, or a null-placements line after a pinned buy (safe direction, documented); duplicate identical lines all deleted (out of scope).
All tasks complete. Next: controller gate, then final whole-branch review + adversarial money-path review (Opus).
Gate at e915a43 PASSED. Final reviews dispatched (whole-branch Opus, adversarial money-path Opus).
Adversarial money-path review (Opus): no Critical/Important; would merge. Minors: (1) one malformed placements row (unreachable from the app) now blocks the whole cleanup batch where the old loop committed earlier deletes; (2) cart-line-match.ts comment says "unpaid line left behind" but a legacy null-placements line that IS the paid one can linger (buyer could pay twice; intended, tested; wording wrong); (3) duplicate identical lines all deleted (pre-existing); (4) abandoned-then-paid order keeps abandoned_at (harmless, every reader keys on status first). Awaiting the whole-branch review before the single fix wave.
Whole-branch review (Opus): no Critical/Important. Fix wave dispatched: user-orders.ts comment (1a, 1b, name checkoutCart); extend the cart-throws test (cart row survives) + batch-failure variant via malformed matching row; cart-line-match.ts comment ('unpaid' → a paid legacy null line can linger); order/confirm/page.tsx:18 comment; docstrings 'If Stripe throws' → also the params builders. Leave: everything else per triage. FIX_BASE=e915a43
Fix wave committed 5013caf; scoped re-review + gate running.
Fix wave re-review: 5/5 ADDRESSED, no logic change. Gate at 5013caf PASSED (3395 tests). Pushing; PR.
