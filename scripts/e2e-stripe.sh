#!/usr/bin/env bash
# Run the one Stripe test-mode e2e (e2e/stripe-money-path.spec.ts).
#
# Spawns a `stripe listen` forwarder so the real, signed
# checkout.session.completed event reaches the local webhook, exports the
# listener's signing secret for the server, and runs the tagged spec against
# the compiled build on :3100. See docs/stripe-e2e.md.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v stripe >/dev/null 2>&1; then
  echo "stripe CLI not found. Install: brew install stripe/stripe-cli/stripe" >&2
  exit 1
fi

# Local dev reads DB creds + STRIPE_SECRET_KEY from .env.local. CI (the
# nightly stripe-e2e.yml workflow) has none — it exports DATABASE_URL /
# DATABASE_AUTH_TOKEN / STRIPE_SECRET_KEY as job env instead, so only source
# the file when it's there.
if [ -f .env.local ]; then
  set -a
  . ./.env.local
  set +a
elif [ -z "${DATABASE_URL:-}" ]; then
  echo ".env.local not found and DATABASE_URL not set — the spec needs the dev/preview DB + test-mode Stripe key" >&2
  exit 1
fi

# A stale server on :3100 would be reused (reuseExistingServer) with the wrong
# webhook secret / NEXT_PUBLIC_APP_URL — refuse instead of debugging that.
if lsof -nP -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3100 is busy. Kill whatever is listening there and re-run." >&2
  exit 1
fi

case "${STRIPE_SECRET_KEY:-}" in
  sk_test_*) ;;
  *)
    echo "STRIPE_SECRET_KEY is missing or not test-mode (sk_test_…). Refusing to pay." >&2
    exit 1
    ;;
esac

# The server must verify events with the CLI listener's signing secret, not
# the dashboard endpoint's. Exported before Playwright boots the webServer;
# process env beats .env.local in Next's env loading.
STRIPE_WEBHOOK_SECRET="$(stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret)"
export STRIPE_WEBHOOK_SECRET

stripe listen --api-key "$STRIPE_SECRET_KEY" \
  --events checkout.session.completed \
  --forward-to localhost:3100/api/webhooks/stripe &
LISTENER_PID=$!
trap 'kill "$LISTENER_PID" 2>/dev/null || true' EXIT

# Stripe's success/cancel URLs build from NEXT_PUBLIC_APP_URL — point them at
# the server under test so the post-payment redirect lands back on :3100.
export NEXT_PUBLIC_APP_URL="http://localhost:3100"
# Belt over the playwright.config suspenders: never submit a real Printful order.
export PRINTFUL_DRY_RUN=true
# Suppress real order emails (invalid key; the send helper swallows failures).
export RESEND_API_KEY="re_dummy_e2e"
# Opt the tagged spec in (it self-skips without this).
export E2E_STRIPE=1

# One project only — phone-first, and one payment per run is enough.
npx playwright test e2e/stripe-money-path.spec.ts --project=mobile
