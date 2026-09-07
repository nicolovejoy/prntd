# Hero copy, anonymous publish gate, and a 300-prompt example library

Three independent slices from Nico's 2026-09-06 smoke round. No migration.

## Context

- `src/components/maker-hero.tsx` is the landing composer (`data-testid="maker-hero"`
  is the prod-smoke marker — never remove or rename it).
- `src/lib/design-examples.ts` exports `EXAMPLES`, four strings, consumed by the
  hero chips, the `/design` chat-panel chips (two places), and `e2e/landing.spec.ts`.
- `publishImage` lives in `src/app/designs/actions.ts`. The guest funnel (#26)
  gives every signed-out browser a real Better-Auth anonymous user, so a bare
  `if (!session) throw` does NOT keep guests out. `isAnonymousUser` from
  `src/lib/auth.ts` is the existing gate used by checkout and Studio.

## Global Constraints

- Persona C ("The Clean Label", `docs/design-system.md` Part 1) governs all new
  copy EXCEPT the headline and subline given verbatim below, which are Nico's
  own words and are used exactly as written.
- Headline, verbatim, capitalization exact: `PRiNT your brAIn`
- Subline, verbatim, em dashes (U+2014) with single spaces: `Type it — See it — Wear it`
- No `any` in product code (CLAUDE.md lint policy). `catch (err)` + narrow.
- Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` before
  reporting DONE. `npm run typecheck` is NOT optional — agent PRs have shipped
  type errors past lint/test/build before.
- Do not touch `drizzle/`, `src/lib/schema.ts`, or anything requiring a migration.
- Do not run `db:push`, `db:migrate`, or any command against a real database.

---

## Task 1 — Hero copy: new tagline, delete the false price claim

### Why

`minRetailPrice()` returns the ITEM price ($19.43). Shipping is a separate
`FLAT_SHIPPING_USD` ($4.69) Stripe line. The hero's "From $19.43, shipped."
therefore claims a delivered price nobody has paid — the real delivered floor is
$24.12. The line is removed, not corrected.

### Changes

1. `src/components/maker-hero.tsx`
   - `<h1>` text becomes exactly `PRiNT your brAIn`.
   - The `<p>` under it becomes exactly `Type it — See it — Wear it` (keep the
     existing `text-text-muted` styling and element).
   - Delete the `minRetailPrice` import — it becomes unused here.
   - Update the component docblock: the sub-line is a tagline now, not "the
     one-line basics of the offer (#75)", and no longer carries a price.
2. `src/lib/og-site-card.tsx` — the line currently reading `Your idea, on a shirt.`
   becomes `PRiNT your brAIn`.
3. `src/app/opengraph-image.tsx` — `export const alt` becomes
   `"PRNTD — PRiNT your brAIn"`.
4. `src/app/layout.tsx` — the `description` constant becomes
   `"Type it — See it — Wear it"` (currently "Design a shirt by describing it.").
   Leave `title` as `"PRNTD"`.
5. `e2e/landing.spec.ts` — the test "signed-out homepage shows the hero composer"
   asserts the hero contains the `minRetailPrice()` amount. That assertion moves
   OUT of the hero and onto the page: the `/` Pricing section still renders
   "Tees from $19.43" (accurate — it does not claim shipping is included), so
   assert `page.getByText(new RegExp(...))` at page scope instead of
   `hero.getByText(...)`. Update the file's docblock accordingly.
   Do not assert the headline or subline text — that is what the existing
   docblock warns against and what a future copy sweep would break.

### Do NOT change

- The `/` Pricing section copy in `src/app/page.tsx` ("Tees from $19.43") — it is
  accurate as written.
- `data-testid="maker-hero"`.

### Verification

- `npm test` green.
- `grep -rn "shipped" src/components/maker-hero.tsx` returns nothing.
- `grep -rn "Your idea, on a shirt" src/` returns nothing.

---

## Task 2 — Gate publishing behind a real account

### Why

`publishImage` only checks `if (!session) throw new Error("Unauthorized")`. An
anonymous guest HAS a session, so any signed-out visitor can put images on the
public `/` feed and `/prints`, attributed to a ghost account with no email. The
generation caps are 8/day per identity (resettable by clearing cookies) and
`IP_GEN_DAILY_CAP` = 20/day per IP. Moderation is reactive only
(`setImageHidden`). This was never a decision — publishing simply inherited the
funnel's session check. The fix mirrors the existing checkout gate exactly.

### Changes

1. `src/app/designs/actions.ts` — in `publishImage`, after the existing
   `if (!session)` check, reject anonymous sessions:
   `if (isAnonymousUser(session.user)) throw new Error("Sign in to publish");`
   Import `isAnonymousUser` from `@/lib/auth` (already exported there).
   Add a comment explaining why a session check alone is insufficient (the
   anonymous plugin mints a real user row), so the next reader does not
   "simplify" it away.
2. Gate ONLY `publishImage`. `unpublishImage` and `updatePublishedNaming` act on
   already-published images owned by the caller and stay as they are — a guest
   who somehow owns a listing must still be able to take it down.
3. UI: the two surfaces that open the publish modal must not offer Publish to a
   guest, and must say why.
   - `src/app/d/[imageId]/publish-cta.tsx` (the "Not published" + Publish button
     on the image detail page)
   - `src/app/design/design-client.tsx` (Publish from the thread/lightbox)
   For each, thread a boolean down from the server page (both are rendered from
   server components that already read the session — reuse that read, do not add
   a second `auth.api.getSession` call inside a client component). When the
   viewer is anonymous, render a link to `/sign-in?next=<current path>` labelled
   `Sign in to publish` in place of the Publish control. Follow the existing
   Paper/persona-C button and link styling in each file; do not invent a new
   variant.
4. Tests: add integration coverage in the existing `src/app/designs/__tests__/`
   style (real in-memory libSQL via `src/lib/__tests__/test-db.ts`) asserting
   that `publishImage` throws for an anonymous session and still succeeds for a
   real one, and that the image has no listing row after the anonymous attempt.
   Mock `@/lib/auth` the way the neighbouring integration tests already do
   (`getSession` + `isAnonymousUser`) rather than inventing a new harness.

### Verification

- New tests green; full `npm test` green.
- `npm run typecheck` clean.

---

## Task 3 — 300 example prompts in 12 categories, three shown at random

### Why

Three hardcoded chips ("Minimalist mountain landscape", "Retro sunset, palm
silhouettes", …) are the same on every visit. A large library shown three at a
time makes the landing feel alive and demonstrates range.

### Shape

Rewrite `src/lib/design-examples.ts` as:

- `EXAMPLE_CATEGORIES`: exactly 12 categories, each with exactly 25 prompts —
  300 total. Suggested categories (rename freely if a better cut emerges, but
  keep 12 × 25): animals & creatures; nature & landscapes; typography &
  lettering; space & astronomy; food & drink; music; sport & motion; retro &
  vintage; geometric & abstract; myth & folklore; ocean & marine; machines &
  vehicles.
- `EXAMPLES`: the flattened 300, kept as a named export so nothing that imports
  it breaks.
- `pickExamplePrompts(count, rand)`: a PURE function — takes an injectable
  `rand: () => number` (defaults to `Math.random`) so it is deterministic under
  test. Returns `count` prompts drawn from `count` DISTINCT categories, so three
  chips are never three animals. Must behave sanely when `count` exceeds the
  category count (fall back to allowing repeats rather than throwing).

### Prompt-writing rules (these are the quality bar; a reviewer will check them)

- Each entry is the literal generation prompt, so each keeps a subject AND a
  style — the existing contract in the file's docblock. "A wolf" is not
  acceptable; "Geometric wolf head" is.
- Maximum 38 characters, so a chip stays on one line in the mobile scroll row.
- No real brands, trademarks, logos, celebrities, or copyrighted characters.
- Safe for a general storefront: no gore, no politics, no slurs, nothing sexual.
- Must work as a t-shirt graphic on a transparent background: a discrete subject,
  not a full-bleed photographic scene.
- No duplicates and no near-duplicates (two entries differing only by an
  adjective are a duplicate for this purpose).
- Sentence case, no trailing period. Quoted words for typographic prompts follow
  the existing `'"HELLO" in graffiti letters'` shape.

### Wiring

Server/client boundary matters here. `MakerHero` and `chat-panel` are client
components; picking randomly during render would make the server HTML and the
client's first render disagree (hydration mismatch).

Use ONE mechanism in both places: render a deterministic trio for SSR and the
first paint, then randomize in a mount effect. Put it in a small hook in
`src/lib/design-examples.ts`'s consumer layer — a new
`src/components/use-example-prompts.ts` (or equivalent) exporting
`useExamplePrompts(count)` that returns `pickExamplePrompts(count, …)` seeded
deterministically on the server (e.g. the first prompt of the first `count`
categories) and re-picks randomly inside `useEffect` on mount.

- `src/components/maker-hero.tsx`: replace `EXAMPLES.slice(0, 3)` with the hook.
- `src/app/design/chat-panel.tsx`: BOTH chip rows use the hook. The composer row
  (currently `EXAMPLES.slice(0, 3)`) shows 3. The empty-state row currently
  renders `EXAMPLES` in full — with 300 that would be a wall of chips; it shows
  3 from the hook as well.
- `e2e/landing.spec.ts`: the chips assertion currently pins
  `EXAMPLES.slice(0, 3)` by exact text. That is no longer predictable. Re-anchor
  it: assert that the hero renders exactly 3 chip buttons and that each button's
  text is a member of `EXAMPLES`. Give the chip container or the buttons a
  `data-testid` if that makes the locator honest rather than fragile.

### Tests

Unit tests for `src/lib/design-examples.ts`:

- exactly 12 categories, exactly 25 prompts each, 300 flattened
- no duplicate prompts across the whole library
- every prompt ≤ 38 characters and non-empty
- `pickExamplePrompts(3, rand)` returns 3 prompts from 3 distinct categories,
  with an injected deterministic `rand`
- `pickExamplePrompts` does not throw when `count` > 12

### Verification

- `npm test` green, `npm run lint` clean, `npm run typecheck` clean,
  `npm run build` succeeds.
