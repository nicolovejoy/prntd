# Homepage + navigation rework (two-flow model)

Direction set 2026-05-30. Frames issue #18 and a follow-on nav/nomenclature
pass. Builds on `docs/ux-two-flow-model.md` (buy-existing vs design-your-own).
Nothing here is built yet — this is the plan to execute after the handoff.

## Part A — Homepage (issue #18, ready to build)

Today `src/app/page.tsx` + `src/components/home-hero.tsx` render, in order:
HomeHero (logged-in: your own "Recent designs" grid) → promo → "How it works"
→ discover feed (others' published, also titled "Recent designs") → Pricing →
footer. So there are **two sections titled "Recent designs"** and "How it
works" shows to everyone.

Changes:

1. **Remove your own "Recent designs"** from `HomeHero`'s logged-in view. Keep a
   slim "Welcome back / New Design" CTA. Your designs stay reachable via the
   existing "My Designs" nav link.
2. **Hide "How it works" when logged in.** Make `page.tsx` session-aware
   (server-side `auth.api.getSession`); logged-out visitors still see it,
   returning users don't.
3. **Lead with the purchasable feed.** Move the discover section directly under
   the hero so published community designs are the focus. Cards already link to
   `/d/[imageId]` (the buy page).
4. **Differentiation language.** The public feed is reframed as purchasable:
   - Heading: **"Designs from the community"**
   - Subtext: **"Browse and buy designs other makers have published."**
   - Each card keeps "by &lt;maker&gt;". Optional refinement: tag the viewer's
     own designs in the feed as "by you".

Scope guard: layout + labels only. No data-model change — `getDiscoverFeed`
already returns what's needed. The larger new-user/onboarding hero is out of
scope here (later, with Manine).

## Part B — Navigation + nomenclature rework (to design after handoff)

The deeper need: the app's navigation and naming don't yet reflect the two
flows. We have **buy-existing** (buy a published design, account-gated — #6,
now shipped) and **design-your-own** (chat → generate → order). The nav,
section headings, and labels should make those two paths legible and
consistent, and clearly separate **"my designs"** (my own work — drafts and
published) from **"designs I can buy"** (the community storefront).

Open questions to work through (not yet decided):

- Top-level nav structure for the two flows — what are the primary entry
  points, and how do they read when logged in vs out?
- Canonical names: "My Designs" vs a storefront name (e.g. "Shop", "Browse",
  "Community", "Marketplace") — pick one vocabulary and apply it everywhere
  (nav, headings, breadcrumbs, CTAs).
- Where a user's *own published* designs live — under "My Designs", in the
  community feed, or both (with a "by you" tag).
- How "Make one like this" (fork) and "Buy this design" coexist as the two CTAs
  on `/d/[imageId]` once the storefront framing is consistent.

This is a naming/IA pass across the app, not just the homepage — do it as its
own focused session. Coordinate with `docs/ux-two-flow-model.md` and Manine's
design input (#17/#18).
