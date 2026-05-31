# Funnel back navigation is broken on mobile

Captured 2026-05-05 alongside the design/image data-model gap.

## Resolved 2026-05-30

Built a centralized hierarchy instead of the chip-only middle ground. One
source of truth — `breadcrumbTrail(pathname, params)` in `src/lib/nav.ts`
(unit-tested) — drives a shared `<Breadcrumbs>` component: mobile shows a
single `← Parent` back chip, desktop shows the full trail. Escape navigates
to the immediate parent via deterministic `router.push` (the old global
`EscBack` did `router.back()` and is removed). Overlays (modal, lightbox,
mobile drawer) now `preventDefault` on Escape so close-overlay wins over
go-up. Detail pages (`/d/[id]`) derive their parent from `?from`, falling
back to Fresh Prints. `/order/confirm` sends "up" to `/orders`, not the
stale funnel `/order`. Wired across the funnel, both detail pages, and admin
detail pages; top-level hubs rely on the global `SiteHeader` nav.

The original analysis below is kept for context.

## Symptom

Going through `/design` → `/preview` → `/order` → `/order/confirm`,
there's no reliable way to step back one stage on a phone. Browser back
sometimes lands on a stale URL state (because `/preview` calls
`router.replace` with product/aspect params on mount and on every product
switch). There is no in-page back affordance on mobile.

## Why it's broken today

- Breadcrumbs exist on `/preview` (`src/app/preview/page.tsx:281`) and
  `/order` (`src/app/order/page.tsx:117`), but both are
  `hidden md:flex` — desktop only. Phone-first project; this is the
  wrong default.
- `/design` doesn't have breadcrumbs at all on either viewport.
- `router.replace` calls in `/preview` mutate the URL on product/aspect
  changes, which makes browser back unpredictable (you may step back
  *within* /preview's own history rather than to /design).
- The "Refine design" link at the bottom of /preview is functionally a
  back link to /design but isn't labeled or positioned as one.

## What "needs to work like with breadcrumbs" probably means

Two interpretations worth keeping separate:

1. **Show breadcrumbs on mobile.** Drop `hidden md:flex` and let the same
   trail render on phone. Pros: cheap, consistent across viewports.
   Cons: breadcrumbs eat vertical space above the fold on a 4-stage
   funnel; they were hidden originally for that reason
   (memory: `feedback_mobile_ux.md` — "hide breadcrumbs on mobile").
2. **Add a one-step back affordance** — a `← Preview` style button at
   the top of each funnel page on mobile, instead of full breadcrumbs.
   Pros: small footprint, clear meaning, matches iOS expectation.
   Cons: doesn't communicate where you are in the funnel.

A reasonable middle ground: a single back chip at the top-left
(`← Design`, `← Preview`, etc.) that disappears on the entry stage
(`/design`). Tapping it navigates by `router.push` (not
`router.back`) so the destination is deterministic regardless of how
the user arrived.

## Where the chip should live (sketch)

- `/design` — no chip (entry; "My Designs" lives elsewhere).
- `/preview?id=…` — `← Design` → `/design?id=…`.
- `/order?id=…` — `← Preview` → `/preview?id=…&product=…`.
- `/order/confirm?id=…` — `← Order` → `/order?id=…&product=…&color=…`.

## Adjacent: stop using `router.replace` for product switches?

`/preview` uses `router.replace` so refresh/bookmark of
`?product=phone-case&aspect=1:2` doesn't redundantly regenerate. That's
a real requirement, but it's the reason browser back is unreliable.
Worth thinking about whether `router.push` + URL-aware regen guard would
preserve the bookmark behavior without breaking back. Out of scope for
the chip but on the same surface.

## Non-goals

- Changing the funnel structure.
- Adding a hamburger / global nav.
- Fixing the desktop breadcrumbs.

## Related

- `docs/design-image-data-model-gap.md` — also covers /preview's
  fragility, but on a different axis (data, not nav).
- Memory: `feedback_mobile_ux.md` — established the original
  hide-breadcrumbs-on-mobile rule. The new pattern (back chip) is
  consistent with that — it's not "show full breadcrumbs," it's
  "show the one previous step."
