# Composition first-class: generalizing `product` (direction B made concrete)

Written 2026-08-17. Successor to `docs/object-model-composition.md`, which names
the gap and should be read first. This doc is the plan that lets question 2
("generalize organizer `product`, or two separate storefronts?") be answered
with real information.

Decisions already made:

- **2026-08-04 (Nico): direction B.** The Shop sells shirts, not
  art-you-can-put-on-a-shirt. Composition becomes first-class.
- **2026-08-17 (Nico): generalize `product` in place.** No parallel
  `composition` table — `product` is already ~80% of the object, and a second
  table would recreate the two-storefronts split at the schema level.

## 1. The observation that shapes everything: `listing` has two jobs

A full read-site sweep (2026-08-17, against main at 2c70022) shows `listing`'s
columns serve two unrelated consumers:

**Job A — the Shop sellable.** `title`, `description`, `backgroundColor`,
`feedRank`, plus `publishedAt` as feed sort. Read by four surfaces: the feed
(`discover-feed.ts`), the image detail page (`d/actions.ts` `getImagePage`),
admin moderation (`admin/actions.ts` + `/admin/published`), and order-line
naming (`order-line-identity.ts`).

**Job B — the image-visibility grant.** `publishedAt` + `isHidden` as inputs
to the pure guards in `design-publish.ts` (`canBuyPublishedImage`,
`canUseAsPlacementSource`, `canStartFromImage`, `canViewImagePage`) and their
DB feeders: `getDesignImageWithOwner`, `getDesignSourceImages`, the back/front
source pools (`back-sources.ts`), seed gating in `startConversationFromImage`,
My Designs badges (`user-designs.ts`), `/preview`'s color default
(`getDesign`). This is about the *image* — may other people see this art and
print it — and has nothing to do with any particular shirt.

Direction B moves job A onto `product`. Job B stays image-keyed, because
"this art is public" is not a property of a composition. So:

**`listing` survives, reduced to the visibility grant** (`imageId`,
`publishedAt`, `isHidden`), and every sellable field moves to `product`. The
~8 job-B files don't change at all. That is the difference between a migration
that touches four read surfaces and one that touches fifteen.

(Rename: `listing` is a bad name for the reduced table — the *product* is the
listing under B. Proposed rename to `image_publication` in the final drop
slice, one migration, mechanical. Open question 4.)

## 2. Target schema

### `product` after

```
id           text PK
ownerId      text notNull → user.id      -- who composed / sells it
storeId      text → store.id             -- null = the PRNTD Shop
blankId      text                        -- NOW NULLABLE: null = buyer picks the garment
placements   json Record<placementKey, imageId>  -- notNull, ≥1 entry (front required)
price        real                        -- null = computed; non-null REQUIRES blankId
status       enum draft|listed|hidden    -- unchanged; listed = public
position     integer notNull default 0   -- ordering within an organizer store
title        text                        -- moved from listing
description  text                        -- moved from listing (unused in UI since #130)
backdropColor text                       -- moved from listing.backgroundColor
feedRank     integer                     -- moved from listing (PRNTD feed ordering)
listedAt     timestamp                   -- moved from listing.publishedAt (feed sort)
createdAt / updatedAt                    -- unchanged
-- designId: DROPPED (final slice; nullable during transition)
```

Invariants, enforced at the write layer:

1. `placements.front` is always present (front is the required placement,
   same rule as checkout today).
2. `price` non-null ⇒ `blankId` non-null. A fixed price needs a known COGS;
   with a buyer-picked blank the price is computed per pick
   (`computePrice(0, blankId, size, { back: !!placements.back })`), which is
   exactly today's `/d` behavior — including the +$8 back line arriving for
   free on two-sided compositions.
3. `status = "listed"` requires every placement image to be publicly usable
   (job-B check) OR owned by `ownerId`. Prevents listing a shirt whose back
   is someone's private image that later gets guard-blocked at checkout.

Why `blankId` goes nullable: today's Shop buyer picks the garment on `/d`
(three blanks, all colors). A migrated listing with a forced blank would
silently remove that. Null means "buyer's choice, present on the default
blank for the card"; organizers keep setting it (their flow is unchanged —
`createProduct` already requires it and continues to). The degenerate case —
front-only, no blank, no price — is exactly a today's-Shop listing, which is
the point: one object, today's listing as its simplest form.

Why keep `ownerId` when contributors derive from placement images: the owner
is the *seller* (whose dashboard it appears in, who gets organizer proceeds,
who may curate a shirt from two other people's published images). Contributor
≠ seller is a real case and both need a column-level home.

`designId` is dropped, not kept nullable forever. Its three jobs all have
better homes: ownership validation at create time → validate the placement
images instead; the design-deletion guard (`designs/actions.ts:93`) →
collapses into the existing image-level probe (`product.placements LIKE`,
same file :128); compose-picker hydration → via `image.sourceDesignId`. A
composition drawing on two threads then stops being inexpressible.

### `listing` after (→ `image_publication`)

```
imageId      text PK
publishedAt  timestamp notNull
isHidden     boolean notNull default false
createdAt    timestamp
```

Row exists iff the image is public. All four pure guards keep their exact
inputs. Zero behavioral change for back/front source pickers,
start-from-image, `/d` visibility, or the #95 security posture.

### Untouched

`order`, `order_item`, `cart_item`, `image`, `conversation_image`,
`placement_render`, `store`, ledger — no schema change. `order_item` is
already the composition-at-purchase and stays authoritative for orders.
`order.storeProductId` finally earns its keep: every Shop purchase (not just
organizer-storefront ones) can now reference the product row it bought,
which is where a future payout/royalty phase hangs.

## 3. Attribution

**Rule: the contributor set of a shirt is the distinct owners of its
placement images, ordered front-first.** Derived at read time from
`placements` → `image.ownerId`. Never from `order.designId` /
`order_item.designId` (which name the *conversation context*, and give the
wrong answer the moment one shirt carries two owners' images — #138 Q5).

Display (C voice — flat, no ampersand flourish beyond the minimum):

- One contributor: `Designed by {name}` — unchanged, including the existing
  suppress-when-it's-you rule (`designerAttribution`).
- Two contributors: `Designed by {front-owner} & {back-owner}`.
- Seller not a contributor (an organizer curating others' published art):
  the attribution line names contributors only. The seller is the store
  context the buyer is already standing in; they never appear in
  "Designed by".
- Suppression generalizes per-name: if the viewer is one of two
  contributors, show the other name alone (`Designed by {other}`), not
  "you & X".

Read-site changes (all in slice 3): `order-line-identity.ts` (currently
`order_item.designId → design.userId`), `user-orders.ts` (same),
`admin/actions.ts` order detail (same). The feed and `/d` already attribute
from `image.ownerId` and are correct as-is; under B the product card shows
the contributor set of its placements instead of the single image owner —
same derivation, one-or-two entries.

`image.originalDesignerId` (the seed-lineage root) has **zero display read
sites today** (confirmed in the sweep). It stays what it is — provenance,
"based on art by X" if we ever want it — and is not part of the contributor
rule.

## 4. What the migration touches

Row counts as of the Model B slice-5 verification (2026-08-03): 148 images,
52 designs, 63 orders, 13 listings; plus a handful of test-era `product`/
`store` rows. (Turso CLI on this laptop is logged out post-swap; refresh the
counts before running the backfill.)

- **13 `listing` rows → 13 `product` rows.** Backfill:
  `ownerId = image.ownerId`, `storeId = null`, `blankId = null`,
  `placements = { front: imageId }`, `price = null`,
  `status = isHidden ? "hidden" : "listed"`, `title`/`description`/
  `backdropColor`/`feedRank`/`listedAt` carried over. Idempotent, keyed on a
  provenance marker (see slice 1).
- **Existing organizer `product` rows** gain nothing but nullable columns;
  `designId` values are preserved until the drop slice.
- **Orders and order lines: untouched.** They already pin image ids in
  `placements`; nothing about historical orders changes meaning.
- **Read swaps** are confined to the four job-A surfaces plus the three
  attribution sites (§3). The ~8 job-B files and the entire
  purchase/fulfillment/email pipeline (which reads `order_item.placements`,
  inventoried at ~20 sites) don't change.
- **Write funnel is already narrow**: every listing write goes through
  `listingSyncStatement` (`model-b-writes.ts`), so dual-write is one
  function growing a second statement — the same shape that made Model B's
  dual-write slice small.

## 5. Slices (Model B shape: additive → read swap → attribution → cutover → drop)

Each is a PR; 1–2 are safe to ship the same week; nothing user-visible until 2.

**Slice 1 — additive schema + dual-write + backfill.** Migration adds the
five moved columns to `product`, makes `designId` nullable. `publishImage` /
`updatePublishedNaming` / `unpublishImage` / `setImageHidden` /
`setImageFeedRank` dual-write the mirror product row (create/update/status
via one new statement builder next to `listingSyncStatement`). Idempotent
backfill script converts the 13 listings; provenance marker so re-runs and
the dual-write can't double-mint (proposal: the mirror product row is
findable by `storeId IS NULL AND json front = imageId`, enforced unique in
the write path). Inert to every reader.

**Slice 2 — read swap (sellable surfaces).** Feed, `/d` page data, admin
published list, and `order-line-identity` titles read from `product`.
`getPublishedFeed` becomes a product query (`storeId IS NULL AND status =
'listed'` ∪ organizer-listed later if we ever merge feeds — not now). Feed
cards can now be two-sided (badge, or back shown on flip/hover — small UI,
can trail). `/d` keeps its URL and layout; its buy panel reads the mirror
product.

**Slice 3 — attribution swap.** The three order-attribution sites derive
contributors from placement-image owners (§3); display rules for the
two-contributor case land in `order-attribution.ts` as a pure function with
tests. This is also the slice that unblocks #138 slice 3 and Q5 with a
defensible answer.

**Slice 4 — writer cutover.** Publish-family actions write only `product` +
the reduced visibility row; `listingSyncStatement` shrinks to
publishedAt/isHidden. Unpublish = product → `draft` + delete the visibility
row (re-publish mints fresh listedAt, matching the Model B slice-4
"fresh listing" judgment call). `buyPublishedDesign` starts writing
`order.storeProductId` for Shop purchases.

**Slice 4 status (shipped).** Writers cut over as planned. Judgment calls
worth knowing before slice 5:

- `setImageHidden` still writes both tables. Hidden is genuinely two things —
  the visibility grant the pure guards read and the composition's status — so
  it is not a leftover dual-write; the rename slice keeps it.
- `updatePublishedNaming` and `setImageFeedRank` became single product
  statements (nothing was left for them to write on the listing side), so
  they no longer run inside a `db.batch`.
- Double-publish race: the mirror insert is always batched with the listing
  insert, and `listing.imageId` is a primary key, so the racing loser's whole
  batch rolls back and a second mirror cannot be minted. No conditional
  insert was added — it would duplicate the row builder for no added
  guarantee. Slice 5 should add a real uniqueness constraint once the mirror
  marker is re-keyed off the dropped `designId`.
- `buyPublishedDesign` throws when a published image has no mirror rather
  than booking an order with no composition.
- The listing's four sellable columns are now FROZEN: correct for pre-cutover
  rows, stale afterwards. `verifyCompositionMirrors` and
  `scripts/check-composition-read-parity.ts` stopped comparing them and check
  structure only (1:1 existence, hidden-state ↔ status, listed_at =
  published_at). Run the parity script before the drops.

**Slice 5 — drops + rename.** Drop `product.designId` (guards already
collapsed in slice 1's validation rework), drop the four moved columns from
`listing`, rename `listing` → `image_publication`. Parity check script
first, `migration-smoke.ts` skipped for the drop per the standing rule, use
a check-composition-parity script instead (same pattern as
`check-model-b-parity.ts`, which gated the last drop).

Not in these slices, deliberately: any URL/route change for `/d`, a
"compose a two-sided shirt for the Shop" UI, merged organizer+PRNTD feeds,
payouts/royalties. Those are product decisions the model enables; the
migration shouldn't smuggle them in.

## 6. What it costs to NOT do it yet

- **Blocked:** #138 slice 3 (front row + swap on `/d`) — minor, the issue's
  main complaint is closed by slice 2 of #138 regardless. Two-sided Shop
  items — not asked for by any user yet. A defensible attribution answer for
  mixed-owner shirts — currently a latent wrong answer, but mixed-owner
  fronts can't happen until #138 ships pickers.
- **Not blocked:** #138 slices 1+2 (slice 1 merged; slice 2 is pure
  `/preview` work), #135 slice 2 (embedded checkout), #157 (lightbox), #139,
  #140 — all orthogonal.

So: no fire. The reason to start now is that slice 1 is small, the write
funnel is one function, and every week of new listings is more backfill.

## 7. Open questions

**ANSWERED 2026-08-17 (Nico): go with recommendations — all six.** Kept below
with the reasoning intact.

1. **Fate of `listing`: split the two roles as in §1?** Sellable fields move
   to `product`; a reduced image-visibility table remains; the permission
   system doesn't change. Recommendation: **yes** — this is the version of B
   where the guards, the source pickers, and #95's security posture are
   untouched.

2. **`blankId` nullable (null = buyer picks the garment)?** Preserves
   today's Shop buyer choice; organizers keep fixing it; invariant
   "fixed price requires fixed blank". Recommendation: **yes**. The
   alternative (every composition fixes a blank) makes migrated listings
   worse than today for buyers, for no modeling gain.

3. **Attribution display rules as in §3** ("Designed by X",
   "Designed by X & Y" front-first, seller never named, per-name
   suppression)? Recommendation: **yes**.

4. **Rename the reduced table `listing` → `image_publication` in slice 5?**
   Mechanical, one migration, ~8 files of find-replace at a moment we're
   already migrating. Recommendation: **yes** — leaving a table named
   `listing` that is not the listing is a permanent trap.

5. **#138 sequencing: ship slice 2 (the `/preview` front picker + swap +
   the two latent #102-shaped bug fixes) independently now, hold #138
   slice 3 until composition slice 3 lands?** Recommendation: **yes** —
   #138 slices 1–2 are per-purchase configuration, correct under either
   model, and slice 2 closes the issue's actual complaint.

6. **Timing: start composition slice 1 next session?** Recommendation:
   **yes, after #138 slice 2** — one running schema change at a time, and
   #138 slice 2 has no schema change.
