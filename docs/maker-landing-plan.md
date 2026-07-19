# Maker landing ("Type It, Wear It") — implementation plan

2026-07-05. Direction locked with Nico: focus on maker UX now; organizer/white-label
gets only rudimentary readiness (tracked separately in issue #45). Landing concept
chosen from the four-reframe exploration (artifact `9dcf1d3a`): the landing page IS
the composer — describe a shirt, land in the design chat with the first turn already
firing. Persona-neutral copy throughout (Manine persona call still pending).

## Decisions locked

- **Seed fires Draw-it, not chat.** `/design?prompt=…` auto-fires `generateDesign`
  (the Draw-it path), because "type an idea → watch it get drawn" is the promise.
  The existing readiness thin-check already guards this: a thin prompt gets a
  ~1s clarifying question instead of a wasted generation (`isClarificationOnly`
  path in `design/actions.ts`). No new guard code needed.
- **No feature flag.** Signed-in homepage is untouched; the signed-out landing is
  low-risk and fully reversible. Ship via PR + preview e2e + live verify.
- **Server-side branch, no session flash.** `page.tsx` already fetches the session
  server-side; it renders `MakerHero` (signed-out) vs the existing personal hero
  (signed-in) directly instead of letting a client component flash between states.
- **Honest proof strip.** No invented "prompts" — recovered designs don't have
  them. The strip shows real published designs (title, backdrop, designer) framed
  as "made by chatting here". Omitted entirely if the feed is empty.
- **Organizer door stays quiet**: one "Open a shop →" link in the footer → `/dashboard`.

## Slice M1 — `/design?prompt=` seed

`src/app/design/page.tsx` (`DesignPageInner`):

- Read `searchParams.get("prompt")`. If present AND no `?id=` (new designs only):
  - Fire once via a ref guard (Strict-Mode double-effect safe).
  - `router.replace("/design")` immediately to strip the param, so refresh/back
    doesn't resubmit.
  - Call `handleGenerate(prompt)` — it already runs `ensureGuestSession()` first,
    appends the optimistic user turn, and handles the clarification-only response.
- No server-action changes. Quota: generation burns `consumeGenerationQuota` as
  usual; landing makes generation one tap closer, worth watching after launch.

## Slice M2 — landing v2

New `src/lib/design-examples.ts`: move the `EXAMPLES` array out of
`chat-panel.tsx` (which imports it back) so the landing chips and the in-chat
chips share one list.

New `src/components/maker-hero.tsx` (client):

- H1 "Type an idea. Wear it." / sub "AI draws your design in seconds. Free to
  try — pay only if you order."
- Composer: text input + primary **Draw it** button. Submit →
  `router.push("/design?prompt=" + encodeURIComponent(text))`.
- Chips: first 3 `EXAMPLES`, always visible (no 8s delay here). Tap = navigate
  immediately (on the landing, chips demo; in the chat they prefill — different
  jobs, keep both behaviors).
- ≥44px touch targets, phone-first.

`src/app/page.tsx`:

- Signed-out: `<MakerHero />`, then proof strip (first 2 `getDiscoverFeed` items:
  tee card on its backdrop + title + designer, header "Made by chatting here"),
  promo banner slot unchanged, Fresh Prints teaser unchanged, **How-it-works
  section deleted** (the hero demonstrates it), pricing line updated.
- Signed-in: existing personal hero + sections, unchanged.
- Footer: add "Open a shop →" → `/dashboard`.

`src/components/home-hero.tsx`: delete the signed-out branch (page decides);
keep the signed-in personal hero. Rename only if it falls out naturally.

`src/lib/blanks.ts`: add pure `minRetailPrice()` (cheapest retail floor across
`ACTIVE_PRODUCTS`) + unit test, so the landing's "Tees from $X" can never go
stale again. Fixes the current `$15` (real floor: $19.43).

## Tests / verification

- Unit: `minRetailPrice()`; EXAMPLES module import doesn't break chat-panel tests.
- New `e2e/landing.spec.ts`:
  1. Signed-out homepage shows the hero composer (placeholder text).
  2. Submitting a deliberately THIN prompt ("something cool") lands on `/design`,
     shows it as the first user message, and gets an assistant reply — the
     thin-check answers with a clarifying question, so CI never pays for an
     image render. Assert no `?prompt=` remains in the URL.
  3. Chip tap navigates to `/design` with the chip text as the first user turn.
- Existing guest-funnel/cart specs don't assert landing content (checked) — no updates.
- Local: `npm run e2e`, then Playwright live-smoke on the Vercel preview.
- Live verify after merge: prntd.org signed-out hero, one real seed → image.

## Sequencing

1. M1 + its e2e assertions (small PR-able on its own, but fine to combine)
2. M2 + landing spec
3. One PR (`feat/maker-landing`), preview e2e green, live verify, merge.

## Deferred (do NOT build now)

- Organizer landing page (Shop Link concept stays a mock; footer link only)
- `store.prntd.org` / host-based middleware routing
- Store identity/white-label slice → **issue #45**
- Stripe Connect, logo upload, custom domains
- Occasion chips (`?seed=` variant) — M1's `?prompt=` covers the mechanism if wanted later
