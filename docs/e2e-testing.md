# End-to-end testing on Stripe — runbook

Audience: Nico and Max. Goal: place a real-feeling order through PRNTD without real money moving and without Printful printing a real shirt.

## The mental model

There are two parallel worlds:

- **Live mode** — real card, real charge, real Printful fulfillment, real shipping label, real money to/from Nico's bank.
- **Test mode** — fake card numbers, fake charges, the Stripe dashboard shows the order under "Test data," nothing settles to a bank, but webhooks still fire and our app cannot tell the difference except by the API key it was built with.

Stripe gives you two separate API key pairs (publishable + secret) for the two modes. The webhook signing secret is also separate per mode. Switching modes = switching three env vars and restarting the dev server.

The thing that trips people up: a test-mode checkout would still hit our real Printful API unless we stub it. Set `PRINTFUL_DRY_RUN=true` in `.env.local` for any local testing — the order submission is short-circuited and returns a fake `dry-run-…` id without contacting Printful. Catalog reads (variants, mockups) stay real. Make sure the flag is **unset** in production env vars; if it ever leaks to prod, real customer orders silently won't fulfill.

## Prerequisites (one-time setup)

Stripe CLI installed:

```
brew install stripe/stripe-cli/stripe
```

Log in (opens browser, links your Stripe account):

```
stripe login
```

Both should report success against Nico's Stripe account.

## Test cards to know

These are universal Stripe test cards — they only work against test-mode keys.

- `4242 4242 4242 4242` — succeeds. Any future date, any CVC, any ZIP.
- `4000 0000 0000 0002` — generic decline. Useful for the "card declined" path.
- `4000 0025 0000 3155` — requires 3DS authentication. Useful for the "customer left mid-checkout" path.
- `4000 0000 0000 9995` — insufficient funds.

Full list: https://docs.stripe.com/testing.

## The full-flow test

This is one round trip. Run it on a feature you want to validate; expect ~10 minutes.

### 1. Switch the app into test mode

In `.env.local`, swap `STRIPE_SECRET_KEY` from `sk_live_…` to `sk_test_…` and `STRIPE_WEBHOOK_SECRET` from the live signing secret to the **CLI** signing secret (you'll get this from step 3). Save. Restart the dev server.

If you keep both sets of keys handy in 1Password, this becomes a 30-second swap.

### 2. Start the dev server

In one terminal:

```
npm run dev
```

### 3. Forward Stripe webhooks to localhost

In a second terminal:

```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

The first line of output is the webhook signing secret (`whsec_…`). Copy it into `.env.local` as `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`. Leave `stripe listen` running — every event Stripe sees gets relayed here.

### 4. Place the order

Open http://localhost:3000, sign in, generate a design, go through `/preview` → `/order` → checkout. At the Stripe page:

- Card: `4242 4242 4242 4242`
- Any future expiry, any 3-digit CVC, any ZIP
- Use a real-looking shipping address (Stripe collects it; Printful will validate it)

If testing a discount code, enter the code at the Stripe checkout (the "Add promotion code" link). The "Launch Special" coupon is set up in test mode too — confirm in the Stripe dashboard under Test → Coupons.

### 5. Watch the webhook fire

In the `stripe listen` terminal you'll see something like:

```
checkout.session.completed   → 200 OK
payment_intent.succeeded     → 200 OK
charge.succeeded             → 200 OK
```

A non-200 means our handler crashed — go look at the dev server logs.

### 6. Walk the per-order checklist

After the webhook fires, verify each of these against the test order. This is the same checklist regardless of which feature you're testing — it's the contract every order has to satisfy.

1. Order appears at `/orders` (customer) and `/admin` (admin) with status `paid`.
2. Status advances `pending → paid → submitted` within a few seconds (or `paid_printful_failed` if Printful errored).
3. `/admin/orders/[id]` shows ledger rows: `sale`, `stripe_fee`, `cogs`.
4. The `sale` row equals the **actual paid amount** (post-discount), not the list price.
5. If a discount was applied: `discountCode` and `discountAmount` columns on the order row are populated.
6. Customer confirmation email arrived (check the inbox you signed up with).
7. Owner alert email arrived; if discount applied, it's reflected in the alert.
8. `printfulOrderId` is populated on the order row; the order shows up in the Printful dashboard.
9. Shipping address on the Printful order matches what was typed at Stripe checkout.
10. The original design's status flipped to `ordered`.
11. After Printful ships: `package_shipped` webhook updates status, `trackingNumber` and `trackingUrl` populated, shipping notification email sent.

A failure anywhere in this list is a real bug. Don't paper over it — capture the order ID and the failing step.

### 7. Clean up

Cancel the order in the Printful dashboard if it's about to fulfill. Or — if you were testing the cancel flow — let the `order_canceled` webhook do its thing and verify item 11's analogue.

If you forget and Printful actually ships it: that's a ~$5–10 mistake, classify the order as `test` in the admin so it doesn't pollute revenue numbers.

### 8. Switch back to live mode

Revert the three env vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and any test-only flags). Restart. Stop `stripe listen`.

If you forget this step you'll get a confusing-looking failure the next time someone tries to actually buy something. Consider a sticky note.

## Variants worth practicing

Each of these is the same flow, different card or input:

- **Decline.** Use `4000 0000 0000 0002` at checkout. Order should not be created in our DB; verify nothing leaks past the webhook (no Printful submission, no email).
- **Discount code at 50%.** Apply the launch coupon. Confirm `discountAmount` row is populated and the `sale` ledger entry equals the discounted total.
- **3DS challenge.** `4000 0025 0000 3155`. Practice the "customer abandoned mid-flow" path; check no half-finished order rows.
- **Webhook replay.** With `stripe listen` running, find an event in the dashboard and run `stripe events resend evt_…`. Our handler is supposed to be idempotent — verify a re-fire does **not** create a second ledger entry or a second Printful submission.

## What "good" looks like

A passing test = all 11 checklist items green, both emails arrived, Printful order was canceled before fulfillment, no warnings in the dev server logs, no non-200s in `stripe listen`. Anything else is worth filing.

## Common pitfalls

- Forgetting to update `STRIPE_WEBHOOK_SECRET` after starting `stripe listen` — webhook handler will reject events with a signature error. Symptom: `stripe listen` shows non-200s.
- Using a live-mode coupon code in test mode — they're separate. Coupons must be created in test mode too.
- Closing the `stripe listen` terminal mid-test — webhooks queue up but aren't delivered. Restart it and use `stripe events resend` to replay.
- Real card by accident. Always check the Stripe dashboard's mode toggle (top-left) before hitting "Pay" — if it says "Live data," you're about to spend money.
