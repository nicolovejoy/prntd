# Template for LOCAL development (.env.local). Production and preview secrets
# live in Vercel env vars, not here.
#
# Generate:  op inject -i .env.tpl -o /tmp/env.local.new
#            diff /tmp/env.local.new .env.local     # review before overwriting
#            mv /tmp/env.local.new .env.local
#
# Every vault reference below was verified against dev-secrets on 2026-08-02
# (issue #154). A reference to a NONEXISTENT item does not fail — it injects
# an EMPTY value, which surfaces later as a confusing 401. If you add a key
# here, confirm the item and field label exist first:
#   npx tsx scripts/check-op-refs.ts
#
# Do not write a bare reference prefix in a comment: the injector scans the
# whole file for them and errors on anything it cannot parse.
#
# No `export ` prefixes: Node's --env-file does not strip them (dotenv does),
# so prefixed lines break `npx tsx --env-file=.env.local …`.

# --- Database -----------------------------------------------------------
# Local dev targets the isolated prntd-dev branch, NOT preview or prod:
# `npm run db:push` writes to whatever this points at, and pushing schema to
# a shared DB bypasses migration discipline (#27, #154).
DATABASE_URL=libsql://prntd-dev-nicolovejoy.aws-us-west-2.turso.io
DATABASE_AUTH_TOKEN=op://dev-secrets/prntd-dev-turso-token/credential

# --- Image generation ---------------------------------------------------
REPLICATE_API_TOKEN=op://dev-secrets/Replicate.API.Key/credential
IDEOGRAM_API_KEY=op://dev-secrets/Ideogram.API.Key/credential
ANTHROPIC_API_KEY=op://dev-secrets/prntd-anthropic/credential

# --- Storage (Cloudflare R2) --------------------------------------------
R2_ACCOUNT_ID=op://dev-secrets/prntd-r2-account-id/credential
R2_ACCESS_KEY_ID=op://dev-secrets/prntd-r2-access-key-id/credential
R2_SECRET_ACCESS_KEY=op://dev-secrets/prntd-r2-secret-access-key/credential
R2_BUCKET_NAME=prntd-designs
NEXT_PUBLIC_R2_PUBLIC_URL=https://pub-7389d029733346daa7c3196cad2f5288.r2.dev

# --- Payments -----------------------------------------------------------
# Local uses Stripe TEST mode. The live key is in Vercel only — never here.
STRIPE_SECRET_KEY=op://dev-secrets/prntd-stripe-secret-test/password
STRIPE_WEBHOOK_SECRET=op://dev-secrets/prntd-stripe-webhook-secret/credential

# --- Fulfilment + email -------------------------------------------------
PRINTFUL_API_KEY=op://dev-secrets/prntd-printful/credential
RESEND_API_KEY=op://dev-secrets/prntd-resend-API-key/credential

# --- Auth + ops ---------------------------------------------------------
BETTER_AUTH_SECRET=op://dev-secrets/prntd-better-auth-secret/credential
# Item is titled "prntd CRON_SECRET" — referenced by item ID because the
# space in its title makes an unquoted reference ambiguous.
CRON_SECRET=op://dev-secrets/4lydsnmxyh7be3boglu5qoeczy/credential
NEXT_PUBLIC_APP_URL=http://localhost:3000

# --- Admin --------------------------------------------------------------
# Gates /admin. Nico's gmail is the admin account; the me.com account is a
# regular user.
ADMIN_EMAIL=nicholas.lovejoy@gmail.com

# --- Optional flags (non-secret; default off when unset) -----------------
# Guest funnel (#26): open design/preview/order to signed-out visitors, with
# the auth gate at checkout. The caps guard the ungated generation.
# GUEST_FUNNEL_ENABLED=true
# GUEST_GEN_DAILY_CAP=8
# USER_GEN_DAILY_CAP=50
# IP_GEN_DAILY_CAP=20
# Short-circuit Printful submission so local orders never reach fulfilment.
# PRINTFUL_DRY_RUN=true
