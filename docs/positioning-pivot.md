# Positioning pivot — organizer-first (2026-06-18)

Outcome of the persona conversation with Manine. **No code changes yet** — this is the lens for the next round of design-system + UX work (PR #34 rewrite). Read before touching homepage/nav/funnel copy.

## Who PRNTD is for

The **organizer** — someone with a built-in audience (sports club, band, studio, reunion, class) who wants to set up merch **without buying inventory up front**. The person buying a single shirt is *downstream*, not the wedge.

## Two flows, not one funnel

1. **Organizer / setup flow (primary entry point).** An organizer creates a *named store* (e.g. "Manine's Baseball Club"), picks designs, gets a **shareable link** to send to their audience. They may also buy. This is the **store-hosting surface** — now the front door, not a later add-on.

2. **End-user / buyer flow (downstream).** The audience (e.g. parents) follows the link and orders their size. This is essentially the existing `/design` → `/preview` → `/order` funnel.

## Brand lens

Pro-social / community-benefit — **Newman's Own** model: a real product that stands on its own, where proceeds do good. Keep light; it's the lens, not the focus.

## What changes

The shift is **functional**, not just tonal: two distinct flows with the **organizer setup flow as the primary entry point**. Today's product is a single buyer funnel; the named-store / shareable-link surface doesn't exist yet.

## Status

- Persona question (PR #34 blocker) is **resolved** at the positioning level.
- Open: translate this into (a) the rewritten `docs/design-system.md`, (b) a concrete picture of the organizer setup surface, (c) Manine re-review.
- The earlier "Fresh Prints" storefront naming and the buy-existing path (#6) are now *downstream* of the organizer store concept — revisit how they fit.
