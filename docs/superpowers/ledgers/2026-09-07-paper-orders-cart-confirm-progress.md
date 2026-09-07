# SDD ledger — plan: docs/superpowers/plans/2026-09-07-paper-orders-cart-confirm.md

Spec: `docs/ux-design-review-2026-09.md` (route verdicts for `/order/confirm`,
`/cart`, `/orders`; shared-components audit). Issue #188, rollout slice 7 part 1.
Worktree: `/Users/nico/src/prntd/.claude/worktrees/paper-orders-cart-confirm`,
branch `feat/188-paper-orders-cart-confirm`.
Model policy (binding): implementers sonnet, task reviewers sonnet, scoped
re-reviews haiku, final whole-branch review opus.

## Pre-flight conflict scan

### Cross-task rows

| A | B | shared | finding |
|---|---|---|---|
| T1 | T2 | none | disjoint directories (`src/app/orders` vs `src/app/cart`). Parallel-safe. |
| T1 | T3 | thumbnail-well styling (`border border-border`, no `rounded`) | same recipe, two files, no shared module. Divergence is a cosmetic risk only; the Opus pass checks it. |
| T2 | T3 | none | disjoint. |
| T1,T2 | T4 | the four CTA hrefs | T4 consumes what T1/T2 produce. Ordered after both. |
| all | `src/components/ui/*` | primitives | read-only by construction; other slices own them in parallel worktrees. |

### Per-task self-consistency

| task | check | finding |
|---|---|---|
| T1 | tests vs code | `statusTone` is asserted through the rendered element's class list, so the test does not duplicate the map. `aria-pressed` is the right ARIA for a toggle button (the Studio strip uses `aria-current` because those are links). OK. |
| T2 | e2e contract 2 | one `<img>` per line, conditional on `imageUrl`; the added fixture keeps `ONE_ITEM.imageUrl = null` intact so the "no placeholder img" case stays covered. OK. |
| T2 | e2e contract 3 | `Checkout — $X` preserved verbatim; `/^Checkout/` still matches. OK. |
| T3 | async component under vitest | `await ConfirmPage({searchParams: Promise.resolve(...)})` then `render(ui)`; `Breadcrumbs` needs `useRouter`+`usePathname` mocked. `src/app` tests run in jsdom (vitest.config `environmentMatchGlobs` only moves `src/lib/**` to node). OK. |
| T3 | actions.ts untouched | `getOrderBySession` stays a `"use server"` export; calling it from a server component runs it in-process. Its integration test is unaffected. OK. |
| T4 | duplication with T1/T2 | deliberate: this is the named, findable guard for ruling W1. OK. |

### Pre-flight rulings

**Ruling P1 — the `/orders` CTAs move from `/studio` to `/design`.** The slice
brief says the href "stays `/design`", but on current main both `/orders` CTAs
point at `/studio` (#219 retargeted them). The brief cites owner ruling W1, so
the intent is unambiguous even though the word "stays" is wrong about the
starting state. Ruling: retarget both to `/design`, as instructed, and pin them
in Task 4. Note that W1's original rationale (a guest cannot reach `/studio`)
does **not** apply to `/orders`, which is behind `requireRealUser` — so this is
a consistency call, not a bug fix, and it is called out in the PR body for the
owner to reverse in one line if he disagrees. Cost if wrong: one href.

**Ruling P2 — `getOrderBySession` gets no ownership gate.** The brief says to
"preserve its auth/ownership check exactly"; there is no such check. The
capability is the unguessable Stripe `session_id` in the success URL, which is
what lets a guest-funnel buyer (no real account yet) see their own
confirmation. Ruling: change nothing about it — neither add a gate (it would
break guest confirmations) nor remove anything. Out of scope for a re-skin;
if it is ever revisited it is a security decision with its own PR.

**Ruling P3 — no retry island on `/order/confirm`.** The brief allowed a
client island that re-fetches once after ~2s for the webhook race. There is no
race to cover: `src/app/order/actions.ts:225` writes `stripeSessionId` onto the
order row before the user is redirected to Stripe, and WP4 batches the
`order_item` rows with the order insert, so both the row and its lines exist
before the confirm page can ever be reached. The webhook only flips `status`
and books the ledger, and this page renders no field the webhook writes. A
not-found here means a foreign or stale `session_id`, which a retry cannot fix.
Ruling: render the existing not-found state directly, no island. Cost if
wrong: a customer who somehow arrives early sees "Order not found." and one
reload fixes it — the same outcome the client version had.

**Ruling P4 — the 5xl `✓` glyph is dropped.** A 48px decorative checkmark is
neither Paper (no ornament, mono labels carry state) nor persona C. The
heading "Order confirmed." is the confirmation. Ruling: drop it.

**Ruling P5 — the `/orders` `h1` stays "My Orders".** Nav model A labels the
menu item "Orders", so the page title mildly disagrees with the link that
reaches it. But the brief says to reuse existing strings and no copy decision
was made for this screen. Ruling: keep "My Orders"; flag as a one-word
deferred item rather than changing copy unasked.

**Ruling P6 — the filter order stays Active · Canceled · All.** The brief
describes them as "Active / All / Canceled"; that reads as a description of
the three, not a re-ordering instruction, and re-ordering a control set is
churn with no stated reason. Ruling: keep the shipped order.

**Ruling P7 — money renders in mono on all three screens.** The review asks
for mono ids/dates on `/orders` and mono totals on `/cart`, and "price in mono"
on `/preview`. Applying it to every money figure on these three screens is the
consistent reading and gives tabular alignment down a column of totals.

**Ruling P8 — the prod smoke's third clause is adapted.** The brief's smoke
ends "tapping an order still opens what it opened before". Order rows on
`/orders` are not links today and never have been (only the per-order
`Track shipment` link navigates), so that clause has no observable. Ruling:
the third clause becomes "the Active/Canceled/All tabs still filter the list",
which is a real behaviour this slice touches.

---

## Task log

### Task 1 — `/orders` (commit `c978e68`, implementer sonnet, reviewer sonnet)

Implemented as planned. `npx vitest run src/app/orders` → 7/7.

Implementer note: the plan's prose reads as "status · display name · short id
always visible"; the shipped code keeps the pre-existing conditional (the id
always renders once, the name only when there is one). Ruling: keep the
existing behaviour — the plan was describing the row's contents, not
prescribing a behaviour change, and the two untouched #167 fixtures set
`displayName: null`.

Review: **no Critical, no Important.** Two Minors, both accepted as
already-correct rather than fixed:
- the id/name conditional was restructured but produces identical output
  (verified against `c978e68^` side by side);
- the tracking link moved `text-accent` → `text-foreground`, which is a no-op
  because `--accent` is defined as `var(--foreground)`. Worth the swap anyway:
  "accent" now reads as the rose in this design system, and the rose is banned
  from this screen.

Reviewer confirmed the #167 contract (alts, `Front`/`Back` captions gated on
both images existing, `getColorHex` fills) is byte-identical, and that the new
status-tone assertion would catch a positive/negative swap.

### Task 2 — `/cart` (commit `7f72ade`, implementer sonnet, reviewer sonnet)

`npx vitest run src/app/cart` → 19/19 (10 in `cart-page.test.tsx`).

**Ruling T2-1 (reviewer finding, Important, accepted and fixed).** The
implementer changed the line thumbnail from `alt=""` to
`alt={item.productName}` because Testing Library's role query cannot see an
`alt=""` image (HTML-AAM maps it to `role="presentation"`). That is a test
query driving the markup: the product name is visible text one element away in
the same row, so the thumbnail is decorative-when-labeled and the alt made a
screen reader announce the name twice per line. Ruling: restore `alt=""` with
a comment saying why, and count the images with a DOM query
(`getByTestId("cart-line-item").querySelectorAll("img")`) — which is also how
`e2e/cart.spec.ts` counts them (`.locator("img")` is alt-agnostic), so no e2e
contract moves. Both assertions keep their strength (exactly one image when
there is one, zero when there is not). Fixed in a follow-up commit.

Reviewer verified the whole load/retry/checkout lifecycle is byte-identical to
`7f72ade^` (zero logic lines changed), the four original load-state tests are
untouched, the module-level router mock is reset per test, `text-text-faint`
on the disabled `Remove` is 4.74:1 on the ground (AA), and only one primary
action is ever on screen (Checkout / Retry / Start a design are mutually
exclusive branches).

Deferred (Minor, needs eyes not code): the `Remove` control's new `min-h-11`
changes the right column's height; the box model says the row still balances
against the 64px thumbnail, but that is a 390px claim no unit test can settle.
Carried into the PR body as an eyeball item.

### Task 3 — `/order/confirm` (commit `aa6a3f6`, implementer sonnet, reviewer sonnet)

`npx vitest run src/app/order/confirm` → 9/9, including the untouched
`get-order-by-session.integration.test.ts`.

Reviewer confirmed the conversion is sound: `Breadcrumbs` receives only
serializable `{label, href}` crumbs; no `dynamic`/`revalidate`/`fetchCache`
export anywhere in the chain (there is no layout under `src/app/order` at
all); awaiting `searchParams` is itself a Dynamic API
(`node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md:135`),
so the route cannot be statically prerendered and no build-time DB call is
possible. Field-by-field parity with the old page holds.

**Ruling T3-1 (reviewer finding, Important, accepted and fixed).** The
conversion traded an infinite spinner for a bare error screen. The old client
version had no `.catch` either, but an unhandled rejection there just left
`loading` true forever; in a server component the same rejection propagates
out of render, and there is no `error.tsx` anywhere under `src/app`, so the
customer who just paid gets Next's generic error page. That is not the P3
webhook race — it is DB availability, which P3 says nothing about. Ruling: a
server-side `try`/`catch` around the loader plus a **third** state, distinct
from the receipt and from "Order not found." (which would be a lie when the
truth is "we could not read the database"), that does not imply the payment
failed: the same mono `Order confirmed.` heading, one line "The receipt
couldn't be loaded. Your order is listed in My Orders.", and the existing
`View My Orders` primary. A route-level `error.tsx` was considered and
rejected for this slice: the loader is the only throw source here, and the
repo-wide absence of any error boundary is a bigger, separate decision (it
already bit `/design` in the 2026-09-06/07 session). Noted as deferred.

**Ruling T3-2 (Minor, accepted).** The not-found branch's `Start a new design`
link lacked the `min-h-11` tap target its sibling state's link has, though
both are the only action on their state. Normalised.

**Ruling T3-3 (Minor, accepted).** `session_id` arriving as an array
(`?session_id=a&session_id=b`) is already handled by `typeof raw === "string"`
but nothing pinned it, so a future looser guard would slip through. Test added.

### Task 4 — maker-CTA href guard (commit `a081e02`, implementer sonnet)

New `src/app/__tests__/maker-cta-hrefs.test.tsx`, 4/4 green.
Mutation-verified: flipping the `/orders` header href to `/studio` fails
exactly one assertion and leaves the other three green. No review dispatched —
the file is a test-only guard whose correctness is established by the mutation
run, and its four assertions were re-read by the controller.

## Whole-branch review (opus, once, after all four tasks)

**No Critical.** Two Important, four Minor. The reviewer independently
re-verified the e2e contracts, recomputed every token contrast pair from
`globals.css` (positive 6.55:1, negative 5.95:1, muted 8.25:1, faint 4.74:1 on
the ground), confirmed field-by-field money parity against `resolveOrderLines`
/ `resolveOrderLineIdentities` / `getUserOrdersData`, and confirmed no
`cacheComponents`/`dynamicIO` in `next.config.ts` so awaiting `searchParams`
outside a Suspense boundary is fine on 16.2.1.

**Ruling W-1 (Important, accepted and fixed) — the plan's premise about
`Badge` was already false, and following it duplicated a primitive.** The
design review said "Badge → mono uppercase text with no pill", and this slice
dutifully dropped the import and inlined a `statusTone` map. But Paper slice 1
(#213) had already *made* `Badge` exactly that. So the branch shipped the same
status label at two type ramps — `text-[11px] tracking-[0.08em]` on `/orders`
vs the primitive's `text-[10px] tracking-wide`, which `/admin` and
`/admin/orders/[id]` render — and the two tone tables had already diverged
(`badge.tsx` carries an `archived` tone the inline map lacked; harmless only
because `order.status` is a six-value enum). Ruling: put `Badge` back, delete
the map, and leave a comment saying the primitive IS the mono status label so
nobody re-inlines it. The existing tone test asserts on the rendered
`className` and passes unchanged. This is a per-task review's blind spot by
construction: nothing in Task 1's diff was wrong against Task 1's brief; the
brief was wrong against a primitive no task touched.

**Ruling W-2 (Important, accepted and fixed) — the 44px rule was applied to
this slice's new links but not to the buttons beside them.** `Button` sizes are
sm ≈ 28px, md ≈ 36px, lg ≈ 48px. `/cart`'s three buttons are all `lg`, but
`/order/confirm`'s sole `View My Orders` was `md` (36px) sitting directly above
a link this slice had just given `min-h-11`, and `/orders`' empty-state CTA was
`md`. Three screens shipped in one slice disagreeing about the project's stated
phone-first tie-breaker. Ruling: `size="lg"` on the confirm primary (both the
receipt and the load-failed branch — same sole action) and on the `/orders`
empty-state CTA; the `/orders` header button stays `sm` (it is secondary chrome
beside an `h1`) and gets `min-h-11` instead.

**Ruling W-3 (Minor, accepted) — doc drift this branch created.**
`docs/design-system.md`'s per-page inventory is actively maintained (it took
edits on 2026-09-06), and it still described `/order/confirm` as a card with a
checkmark and a loading state, and `/orders` as cards with a status Badge and
filter chips. `docs/d-buy-checkout-plan.md:66` called `/order/confirm` "a
client page … polling `getOrderBySession`" — and that plan's slice 2, on the
Next-steps list, adds a branch to this exact file, so an implementer reading it
would have planned a client fetch. Both corrected (the confirm entry now names
all three states). `docs/ux-design-review-2026-09.md`'s "(client, `Loading…`)"
line is deliberately left: that document is a dated snapshot of what existed
when it was written, and it is the spec this slice executed.

**Ruling W-4 (Minor, accepted) — the receipt's total was not the emphasized
element on the screen where it matters most.** `Total paid` rendered at the
same size as the `Order ID` value one row above, inside a block where every
row carried the same rule. Fixed: the amount goes to `text-base font-medium`
and the total row drops its `border-b`, so the ruled block closes on the total
the way a receipt does. `/cart`'s totals keep their own `border-t … pt-2`
treatment — correct as-is, and not worth aligning for its own sake.

**Ruling W-5 (Minor, accepted with a deliberate limit) — the caught receipt
failure is log-only.** A caught error never reaches `instrumentation.ts`'s
`onRequestError`, so no `app_error` row is written and `/admin/errors` will
never show a receipt-load failure. Ruling: emit the *structured*
`appErrorLogLine(shapeAppError(…))` so `vercel logs | grep app_error` finds it,
but do NOT write the row: the likeliest cause of this catch firing is the
database being unreachable, which is exactly what the row write needs, and a
page render must not spend a 3s DB timeout logging to the DB that just failed.
Stated in the code comment and in the PR body so "why is there nothing in
/admin/errors" has an answer.

**Not fixed, carried to the PR body:** the `/cart` `Remove` control's new
`min-h-11` changes the right column's height against the 64px thumbnail — the
box model says the row still balances, but that is a 390px claim no unit test
can settle. One eyeball item.

**Ruling P1 REVERSED by the main session before merge.** The brief mis-stated
W1: it covers the cart (a guest on the purchase path cannot reach `/studio`),
not `/orders`, which sits behind `requireRealUser`. `/orders` CTAs are back on
`/studio` and the Task 4 pin now asserts `/studio`; `/cart` keeps `/design`.
