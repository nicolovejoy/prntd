# Contributing to PRNTD

Short guide for collaborators. Keep it open while you work.

## Setup

```
git clone https://github.com/nicolovejoy/prntd.git
cd prntd
npm install
```

Get `.env.local` from Nico (it has secrets — not in the repo). Run:

```
npm run dev
```

App boots at http://localhost:3000.

## Before you start

1. Read `CLAUDE.md` and `AGENTS.md` at the repo root. The Next.js version differs from your training data — heed the deprecation notices.
2. Skim `docs/e2e-testing.md` for the local-dev + Stripe-test-mode workflow.
3. Set `PRINTFUL_DRY_RUN=true` in `.env.local` while testing the order flow. This short-circuits Printful submission so you can place real-looking orders without burning fulfillment.

## Branch + PR workflow

- Branch off `main`. Naming: `<type>/<short-slug>` — e.g. `fix/ordered-design-routing`, `feat/order-auto-naming`, `docs/contributing-guide`.
- One feature per PR. Small PRs land faster.
- PR title should match the issue or be self-descriptive. Reference the issue number in the body (`Closes #3`).
- Direct pushes to `main` are blocked. All changes go through PR review.

## Before opening a PR

```
npm run lint
npm test
npm run build
```

All three should pass clean. CI runs lint + test automatically on every PR.

## Code style

- Prefer editing existing files over creating new ones.
- Don't add comments that describe *what* the code does — well-named identifiers do that. Only add a comment when the *why* is non-obvious (a workaround, a hidden constraint).
- Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust framework guarantees. Validate at system boundaries (user input, external APIs).
- No backwards-compat shims for code that's still in flight. If something is unused, delete it.
- Phone-first. When prioritizing between desktop and mobile UX, mobile wins.
- No hyperbole or "the X is the Y" declarations in docs/comments. State things plainly.

## Testing

- Unit tests live next to the code in `__tests__/` directories.
- Hit the real database in integration tests, not mocks.
- Test before moving on — don't batch a feature and a fix in the same PR if you can split them.

## Secrets

- Never commit `.env*`, `*.pem`, `*.key`, or anything matching `credentials*`. The `.gitignore` covers the common ones; if you're not sure, ask.
- Never paste secrets into PR descriptions, issue comments, or chat. If a secret needs updating, tell Nico which file and line; don't share the value.

## Working with Printful, Stripe, Replicate, etc.

- Use Stripe test mode and test cards (`4242 4242 4242 4242`) for any e2e checkout work.
- Use `PRINTFUL_DRY_RUN=true` to skip real fulfillment.
- Replicate and Anthropic API calls cost real money — keep dev iteration tight.

## Asking questions

Ping in chat. Faster than guessing. Include:
- What you're trying to do
- What you've tried
- The exact error or unexpected output

That's it. When in doubt, keep PRs small and ship often.
