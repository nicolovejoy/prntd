# #266 ledger
- Gate lives in handleStripeCheckoutCompleted (real-DB testable), not the route. StripeSessionData.paymentStatus is required so no caller can fail open; toStripeSessionData fills it from session.payment_status.
- Unpaid returns action "awaiting_payment": no claim, ledger, Printful, emails. Route sends emails only for submitted/paid/paid_printful_failed, so none.
- async_payment_succeeded shares the completed branch (same retrieve + handler); idempotence comes from the existing conditional claim.
- async_payment_failed reuses handleStripeCheckoutExpired (conditional UPDATE on pending + not abandoned).
- recover-pending-order now uses isSettledPaymentStatus (accepts no_payment_required).
- e2e-stripe.sh listener filter gets the two async events.
- Not fixed: /order/confirm copy for complete+unpaid (see report). No schema change.
