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

(appended per task below)
